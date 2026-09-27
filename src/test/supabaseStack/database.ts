// The Postgres half of the production-simulating Supabase stack (see
// ./index.ts for the whole picture): the tables the game write path and chat
// actually touch, plus the parts of their server-side behavior that a test
// replaying a real game would otherwise silently lose — Row Level Security,
// the triggers that police room lifecycle and readiness, the
// `game_state_sync_meta` projection trigger, and `game_state.version`'s
// compare-and-swap contract.
//
// Everything here is transcribed from supabase/migrations/0001_baseline.sql
// rather than invented, and each rule below cites the section of that
// migration (and the policy/trigger/function by name) it comes from. That's
// the whole point: these tests exist to catch the class of bug that only
// shows up once a real client, a real Edge Function and a real database
// policy are all in play, so a test double that quietly permits what
// production forbids would be worse than no test at all. Where a behavior is
// deliberately NOT modeled (Realtime, storage, push_subscriptions, Postgres
// types/constraints beyond the few modeled below) the request path throws
// loudly instead of guessing — see ./httpServer.ts.

import type { AppConfigRow, GameRow, GameStateMetaRow, PlayerRow } from '../../lib/dbTypes.ts'
import type { StoredGameState } from '../../lib/gameStateCompression.ts'

export type Row = Record<string, unknown>

/** Only the tables the game write path touches, plus chat (0001_baseline.sql section 10) — anything else is a loud 404 from ./httpServer.ts. */
export type TableName = 'profiles' | 'games' | 'players' | 'game_state' | 'game_state_meta' | 'app_config' | 'chat_messages' | 'chat_read_status' | 'game_secrets'

/**
 * Who a request runs as. `service_role` bypasses RLS entirely (Supabase's
 * usual behavior, and the reason the Edge Functions can write a
 * `ruleEnforcementEnabled` game's state at all — 0001_baseline.sql section
 * 7); `authenticated` is a signed-in user whose id is `auth.uid()` in every
 * policy below.
 */
export interface Actor {
  role: 'service_role' | 'authenticated' | 'anon'
  userId: string | null
}

export interface ProfileRow {
  user_id: string
  display_name: string | null
  is_admin: boolean
}

export interface GameStateRow {
  game_id: string
  state: StoredGameState
  turn: number
  active_player_id: string | null
  version: number
  updated_at: string
}

export type { GameStateMetaRow }

/** Thrown for anything the double deliberately doesn't model, so a test fails loudly instead of passing against a fiction. */
export class UnsupportedQueryError extends Error {}

/** A Postgres error the way PostgREST surfaces it — `code` is what gameApi.ts's insertGameState checks for (23505). */
export class DatabaseError extends Error {
  readonly status: number
  readonly code: string
  readonly details: string | null
  readonly hint: string | null

  constructor(status: number, code: string, message: string, details: string | null = null, hint: string | null = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
    this.hint = hint
  }
}

/** What a plpgsql `raise exception` in a trigger surfaces as through PostgREST: a 400 with SQLSTATE P0001. */
function raiseException(message: string): DatabaseError {
  return new DatabaseError(400, 'P0001', message)
}

const PRIMARY_KEY: Record<TableName, string> = {
  profiles: 'user_id',
  games: 'id',
  players: 'id',
  game_state: 'game_id',
  game_state_meta: 'game_id',
  app_config: 'id',
  chat_messages: 'id',
  chat_read_status: 'id',
  game_secrets: 'game_id',
}

/** Tables that carry a `set_updated_at` BEFORE UPDATE trigger (0001_baseline.sql section 1). */
const SETS_UPDATED_AT = new Set<TableName>(['profiles', 'games', 'game_state'])

export type SqlCommand = 'select' | 'insert' | 'update' | 'delete'

/** jsonb's `is distinct from`: structural, key order irrelevant. */
function jsonbDistinct(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
    const entries = Object.entries(value as Row)
      .filter(([, nested]) => nested !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`
  }
  return canonical(left) !== canonical(right)
}

export class Database {
  private rows: Record<TableName, Row[]> = {
    profiles: [],
    games: [],
    players: [],
    game_state: [],
    game_state_meta: [],
    // 0001_baseline.sql section 10 seeds exactly one app_config row, chat
    // off; every fresh stack starts post-migration, same as a real project.
    app_config: [{ id: true, chat_enabled: false }],
    chat_messages: [],
    chat_read_status: [],
    game_secrets: [],
  }

  /** `generated always as identity` on chat_messages.id (0001_baseline.sql section 10). */
  private nextChatMessageId = 1

  /** Direct, RLS-free, trigger-free access for arranging a test's starting fixture — the equivalent of seeding a known end state, not going through the API. */
  seed(table: TableName, row: Row): void {
    this.rows[table].push(structuredClone(row))
  }

  /** Direct, RLS-free read for asserting on what actually landed in the table. */
  table<T = Row>(table: TableName): T[] {
    return structuredClone(this.rows[table]) as T[]
  }

  /** Direct, RLS-free, trigger-free write of a whole row, matched on its primary key — for arranging a state the API itself cannot reach (a room moved back to the lobby, say). */
  replaceRow(table: TableName, row: Row): void {
    const key = PRIMARY_KEY[table]
    const existing = this.rows[table].find((candidate) => candidate[key] === row[key])
    if (!existing) throw new Error(`No ${table} row with ${key}=${String(row[key])} to replace.`)
    Object.assign(existing, structuredClone(row))
  }

  // ---------------------------------------------------------------------------
  // Row Level Security, transcribed from 0001_baseline.sql.
  //
  // Every policy there is *permissive* (Postgres OR's multiple permissive
  // policies for the same command together), and every one is `to
  // authenticated`, so `anon` is denied everything. A command with no policy
  // at all is denied for `authenticated` too, exactly like a real
  // RLS-enabled table. For UPDATE, a policy with no WITH CHECK reuses its
  // USING expression against the new row — `update()` below applies this to
  // both the old and the new row.
  // ---------------------------------------------------------------------------
  private visible(actor: Actor, table: TableName, command: SqlCommand, row: Row): boolean {
    if (actor.role === 'service_role') return true
    if (actor.role !== 'authenticated' || !actor.userId) return false
    const uid = actor.userId

    switch (table) {
      // Section 2: own row only — "users can read/insert/update their own
      // profile". No delete policy (rows go with auth.users' cascade), and
      // deliberately no admin read: other users' names are only exposed
      // through chat_sender_display_names() below.
      case 'profiles':
        return command !== 'delete' && row.user_id === uid

      // Section 3: "games are readable by any signed-in user" (that's how
      // join-by-code works); "signed-in users can create a game" and "room
      // owner can update their game" both key on created_by = auth.uid();
      // "room owner can delete their room in a deletable state" (lobby or
      // canceled only) plus the additive "admins can delete any game".
      case 'games':
        if (command === 'select') return true
        if (command === 'delete') return (row.created_by === uid && (row.status === 'lobby' || row.status === 'canceled')) || this.isAdmin(uid)
        return row.created_by === uid

      // Section 4: readable by any signed-in user; "users can seat
      // themselves", and update/delete only their own row.
      case 'players':
        return command === 'select' || row.user_id === uid

      case 'game_state': {
        const gameId = row.game_id as string
        const seated = this.isSeated(uid, gameId)
        if (command === 'select') {
          // Section 8: "read game state when hidden information is off" —
          // seated, or any signed-in user once the game has left the lobby —
          // and a hiddenInformationEnabled game denies direct SELECT
          // outright, to a seated player and a stranger alike (RLS can't
          // redact within a row, so get-game-state, service role and
          // unaffected here, is the only read path). "admins can read any
          // game state" is a separate, additive policy.
          if (this.isAdmin(uid)) return true
          if (this.hiddenInformationEnabled(gameId)) return false
          const game = this.game(gameId)
          return seated || (game !== undefined && game.status !== 'lobby')
        }
        // Section 7: "seated players can insert/update game state when
        // enforcement is off". A rule-enforced game's state (genesis
        // included — start-game/index.ts) is service-role-write-only, i.e.
        // only the Edge Functions may write it. No delete policy.
        if (command === 'insert' || command === 'update') return seated && !this.ruleEnforcementEnabled(gameId)
        return false
      }

      // Section 6: "seated players and viewers of started games can read
      // meta" plus "admins can read any game state meta". Deliberately not
      // narrowed by hiddenInformationEnabled; never writable by
      // `authenticated` — only the security definer trigger writes it (see
      // syncGameStateMeta below).
      case 'game_state_meta': {
        if (command !== 'select') return false
        const gameId = row.game_id as string
        const game = this.game(gameId)
        return this.isSeated(uid, gameId) || (game !== undefined && game.status !== 'lobby') || this.isAdmin(uid)
      }

      // Section 10: "anyone can read app_config"; no insert/update/delete
      // policy at all, so nothing `authenticated` does can flip the kill
      // switch.
      case 'app_config':
        return command === 'select'

      // Section 10: "read site-wide chat" / "read game chat" (seated, or any
      // visitor of a public room) and "post chat" (site-wide needs only a
      // session, in-game needs a seat) — every one gated on chat_enabled().
      // Append-only: no update/delete policy.
      case 'chat_messages': {
        const gameId = row.game_id as string | null
        if (!this.chatEnabled()) return false
        if (command === 'select') return this.canReadChatChannel(uid, gameId)
        if (command === 'insert') {
          if (row.sender_id !== uid) return false
          return gameId === null || this.isSeated(uid, gameId)
        }
        return false
      }

      // Section 10: a user's own read cursor, one row per (user, game) — in-
      // game chat only. "read own"/"update own chat read status" key only on
      // user_id (update deliberately not chat_enabled()-gated: advancing an
      // existing cursor after the switch flips off is harmless); "insert own
      // chat read status" additionally requires chat_enabled() and the same
      // read audience chat_messages itself uses for that game. No delete
      // policy — rows go with their game via on delete cascade.
      case 'chat_read_status': {
        if (row.user_id !== uid) return false
        if (command === 'select') return true
        if (command === 'update') return true
        if (command === 'insert') {
          return this.chatEnabled() && this.canReadChatChannel(uid, row.game_id as string | null)
        }
        return false
      }

      // 0002_game_secrets.sql: RLS on, no policy at all, grants revoked —
      // only the service role (the early return above) ever sees a row.
      case 'game_secrets':
        return false
    }
  }

  /** Shared by `chat_messages`' "read game chat" policy and `chat_read_status`' insert policy — same audience, same rule. */
  private canReadChatChannel(userId: string, gameId: string | null): boolean {
    if (gameId === null) return true
    const game = this.game(gameId)
    return this.isSeated(userId, gameId) || game?.visibility === 'public'
  }

  private isSeated(userId: string, gameId: string): boolean {
    return (this.rows.players as unknown as PlayerRow[]).some((p) => p.game_id === gameId && p.user_id === userId)
  }

  private isAdmin(userId: string): boolean {
    return (this.rows.profiles as unknown as ProfileRow[]).some((p) => p.user_id === userId && p.is_admin)
  }

  private game(gameId: string): GameRow | undefined {
    return (this.rows.games as unknown as GameRow[]).find((g) => g.id === gameId)
  }

  private ruleEnforcementEnabled(gameId: string): boolean {
    return Boolean(this.game(gameId)?.settings?.ruleEnforcementEnabled)
  }

  private hiddenInformationEnabled(gameId: string): boolean {
    return Boolean(this.game(gameId)?.settings?.hiddenInformationEnabled)
  }

  /** `public.chat_enabled()` (0001_baseline.sql section 10) — the chat kill switch. */
  private chatEnabled(): boolean {
    return Boolean((this.rows.app_config as unknown as AppConfigRow[])[0]?.chat_enabled)
  }

  // ---------------------------------------------------------------------------
  // BEFORE triggers, transcribed from 0001_baseline.sql. Each either rewrites
  // the new row or raises, exactly as the plpgsql does. They fire for every
  // role, service role included — only `seed`/`replaceRow` (the test's own
  // direct access) skip them.
  // ---------------------------------------------------------------------------

  /**
   * The BEFORE UPDATE triggers on `games` (section 3), in the order Postgres
   * fires them (alphabetical by trigger name):
   *
   * - `games_bump_config_version`: a change to settings or the player-count
   *   bounds is only allowed while the room is in the lobby, and bumps
   *   config_version.
   * - `games_enforce_name_immutable`: neither the name nor `game_type`
   *   ever changes — `enforce_game_name_immutable()` checks `game_type`
   *   first, so a write changing both raises the game-type message.
   * - `games_enforce_status_transition`: only lobby -> active, lobby ->
   *   canceled and active -> canceled are legal; and for a rule-enforced game
   *   lobby -> active may only be made by the service role (the start-game
   *   Edge Function). That last rule is a trigger rather than a policy
   *   because it needs the old and new status in one check — a settings or
   *   visibility update the owner makes while an enforced game is already
   *   'active' has to keep working.
   */
  private beforeUpdateGames(actor: Actor, old: GameRow, next: Row): void {
    if (
      jsonbDistinct(old.settings, next.settings) ||
      old.min_players !== next.min_players ||
      old.max_players !== next.max_players
    ) {
      if (old.status !== 'lobby') throw raiseException('Configuration can only change while the room is Active - Not Started')
      next.config_version = old.config_version + 1
    }
    if (old.game_type !== next.game_type) throw raiseException("A room's game cannot be changed after creation")
    if (old.name !== next.name) throw raiseException('Room name cannot be changed after creation')
    if (old.status !== next.status) {
      const legal = [
        ['lobby', 'active'],
        ['lobby', 'canceled'],
        ['active', 'canceled'],
      ].some(([from, to]) => old.status === from && next.status === to)
      if (!legal) throw raiseException(`Invalid room status transition: ${old.status} -> ${String(next.status)}`)
      const enforced = Boolean((next.settings as GameRow['settings'] | undefined)?.ruleEnforcementEnabled)
      if (old.status === 'lobby' && next.status === 'active' && enforced && actor.role !== 'service_role') {
        throw raiseException('An enforced game can only be started via the start-game Edge Function.')
      }
    }
  }

  /**
   * `profiles_enforce_is_admin_unchanged` (section 2), BEFORE INSERT OR
   * UPDATE: the own-row insert/update policies would otherwise let any user
   * grant themselves is_admin, so a signed-in PostgREST session (role
   * 'authenticated' or 'anon') may never set it on insert or change it on
   * update. The service role is unaffected.
   */
  private enforceProfilesIsAdminUnchanged(actor: Actor, old: ProfileRow | null, next: Row): void {
    if (actor.role !== 'authenticated' && actor.role !== 'anon') return
    if (old === null && next.is_admin === true) throw raiseException('is_admin can only be granted by an administrator')
    if (old !== null && Boolean(next.is_admin) !== Boolean(old.is_admin)) throw raiseException('is_admin can only be changed by an administrator')
  }

  /** `players_set_initial_ready_for_version` (section 4): a new seat is implicitly ready for the config as it stands, whatever the insert said. */
  private beforeInsertPlayers(row: Row): void {
    const game = this.game(row.game_id as string)
    row.ready_for_version = game?.config_version ?? null
  }

  /** `players_enforce_ready_for_version` (section 4): a player may only mark themselves ready for the room's *current* config_version. */
  private beforeUpdatePlayers(old: PlayerRow, next: Row): void {
    if (old.ready_for_version === next.ready_for_version) return
    const current = this.game(old.game_id)?.config_version
    if (next.ready_for_version !== current) {
      throw raiseException(`ready_for_version must match the room's current config_version (${String(current)}), got ${String(next.ready_for_version)}`)
    }
  }

  /**
   * `public.chat_sender_display_names` (section 10): a `security definer`
   * function granted to `authenticated` only (execute is revoked from
   * public), deliberately narrower than `profiles`' own RLS — it returns
   * `(user_id, display_name)` for any signed-in caller (not just the row's
   * owner), and never `discord_webhook_url` no matter what's asked for,
   * since the query itself only ever selects those two columns.
   */
  rpc(actor: Actor, name: string, args: Row): Row[] {
    switch (name) {
      case 'chat_sender_display_names': {
        if (actor.role === 'anon') {
          throw new DatabaseError(403, '42501', 'permission denied for function chat_sender_display_names')
        }
        const senderIds = new Set((args.sender_ids as string[] | undefined) ?? [])
        return (this.rows.profiles as unknown as ProfileRow[])
          .filter((profile) => senderIds.has(profile.user_id) && profile.display_name !== null)
          .map((profile) => ({ user_id: profile.user_id, display_name: profile.display_name }))
      }
      default:
        throw new UnsupportedQueryError(`No RPC function named "${name}" is modeled by the test stack.`)
    }
  }

  // ---------------------------------------------------------------------------
  // The statements PostgREST turns a request into.
  // ---------------------------------------------------------------------------

  select(actor: Actor, table: TableName, match: (row: Row) => boolean): Row[] {
    return this.rows[table].filter((row) => match(row) && this.visible(actor, table, 'select', row)).map((row) => structuredClone(row))
  }

  insert(actor: Actor, table: TableName, values: Row[]): Row[] {
    const inserted: Row[] = []
    for (const values_ of values) {
      const row = { ...this.defaults(table), ...structuredClone(values_) }
      if (table === 'players') this.beforeInsertPlayers(row)
      if (table === 'profiles') this.enforceProfilesIsAdminUnchanged(actor, null, row)
      const key = PRIMARY_KEY[table]
      if (this.rows[table].some((existing) => existing[key] === row[key])) {
        throw new DatabaseError(409, '23505', `duplicate key value violates unique constraint "${table}_pkey"`)
      }
      // `games.game_type text not null` and the `games_game_type_format`
      // check constraint (section 3): every room names the game it plays,
      // as a lowercase slug — the same format registerGame() accepts.
      if (table === 'games') {
        const gameType = row.game_type
        if (gameType === undefined || gameType === null) {
          throw new DatabaseError(400, '23502', 'null value in column "game_type" of relation "games" violates not-null constraint')
        }
        if (typeof gameType !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(gameType)) {
          throw new DatabaseError(400, '23514', 'new row for relation "games" violates check constraint "games_game_type_format"')
        }
      }
      // chat_messages' `check (char_length(body) between 1 and 2000)`
      // (section 10) — the other column CHECK constraint a test in this repo
      // actually needs modeled.
      if (table === 'chat_messages') {
        const body = row.body as string | undefined
        if (body === undefined || body.length < 1 || body.length > 2000) {
          throw new DatabaseError(400, '23514', 'new row for relation "chat_messages" violates check constraint "chat_messages_body_check"')
        }
      }
      // `chat_messages_rate_limit_trigger` (section 10): a sender who already
      // has 10+ rows in the trailing 10 seconds (site-wide and in-game
      // combined) is rejected.
      if (table === 'chat_messages') {
        const senderId = row.sender_id as string | undefined
        const createdAt = row.created_at as string
        const windowStart = new Date(createdAt).getTime() - 10_000
        const recentCount = (this.rows.chat_messages as unknown as { sender_id: string; created_at: string }[]).filter(
          (existing) => existing.sender_id === senderId && new Date(existing.created_at).getTime() > windowStart,
        ).length
        if (recentCount >= 10) {
          throw raiseException('You are sending messages too fast. Wait a few seconds and try again.')
        }
      }
      // `chat_read_status_game_uidx`, the unique (user_id, game_id) index
      // (section 10): at most one row per (user, game). chatApi.ts's
      // markChatRead updates an existing row rather than inserting a second
      // one in the normal case; this only fires if two writers race past
      // that check at once.
      if (table === 'chat_read_status') {
        const clash = this.rows.chat_read_status.some((existing) => existing.user_id === row.user_id && existing.game_id === row.game_id)
        if (clash) {
          throw new DatabaseError(409, '23505', 'duplicate key value violates unique constraint "chat_read_status_game_uidx"')
        }
      }
      // `unique (game_id, seat_index)` on players (section 4) — the only
      // thing keeping hotseat's several seats per user_id distinct.
      if (table === 'players') {
        const clash = this.rows.players.some((existing) => existing.game_id === row.game_id && existing.seat_index === row.seat_index)
        if (clash) {
          throw new DatabaseError(409, '23505', 'duplicate key value violates unique constraint "players_game_id_seat_index_key"')
        }
      }
      // A row RLS rejects is `new row violates row-level security policy`, a
      // 42501 — not a silent no-op the way a filtered-out UPDATE is.
      if (!this.visible(actor, table, 'insert', row)) {
        throw new DatabaseError(403, '42501', `new row violates row-level security policy for table "${table}"`)
      }
      this.rows[table].push(row)
      inserted.push(structuredClone(row))
      this.afterWrite(table, row)
    }
    return inserted
  }

  /**
   * PostgREST's UPDATE: rows the filter doesn't select, and rows RLS hides,
   * are simply not updated — no error, an empty result set. That silence is
   * exactly what `writeGameStateCAS` (and gameApi.ts's `writeGameState`)
   * read as "someone else got there first", so it has to stay silent here
   * too. A new row the policy's WITH CHECK (or, absent one, its USING)
   * rejects is an error, though, as is anything a BEFORE trigger raises.
   */
  update(actor: Actor, table: TableName, match: (row: Row) => boolean, patch: Row): Row[] {
    const updated: Row[] = []
    for (const row of this.rows[table]) {
      if (!match(row)) continue
      if (!this.visible(actor, table, 'update', row)) continue
      const next: Row = { ...structuredClone(row), ...structuredClone(patch) }
      if (table === 'games') this.beforeUpdateGames(actor, row as unknown as GameRow, next)
      if (table === 'players') this.beforeUpdatePlayers(row as unknown as PlayerRow, next)
      if (table === 'profiles') this.enforceProfilesIsAdminUnchanged(actor, row as unknown as ProfileRow, next)
      if (SETS_UPDATED_AT.has(table)) next.updated_at = new Date().toISOString()
      if (!this.visible(actor, table, 'update', next)) {
        throw new DatabaseError(403, '42501', `new row violates row-level security policy for table "${table}"`)
      }
      Object.assign(row, next)
      updated.push(structuredClone(row))
      this.afterWrite(table, row)
    }
    return updated
  }

  delete(actor: Actor, table: TableName, match: (row: Row) => boolean): Row[] {
    const deleted: Row[] = []
    for (let i = this.rows[table].length - 1; i >= 0; i--) {
      const row = this.rows[table][i]
      if (!match(row) || !this.visible(actor, table, 'delete', row)) continue
      this.rows[table].splice(i, 1)
      deleted.push(structuredClone(row))
      if (table === 'games') this.cascadeFromGame(row.id as string)
    }
    return deleted
  }

  /**
   * `on delete cascade` from `games` — players, game_state, game_state_meta,
   * chat_messages and chat_read_status all reference `games (id)` with it
   * (0001_baseline.sql sections 4, 5, 6 and 10), as does game_secrets
   * (0002_game_secrets.sql). Deleting a room really does
   * take its rows with it — without this, anything that cleans up after
   * itself by deleting the room (the production smoke runner,
   * ../productionSmoke/) would look like it worked while leaving orphans.
   */
  private cascadeFromGame(gameId: string): void {
    for (const table of ['players', 'game_state', 'game_state_meta', 'chat_messages', 'chat_read_status', 'game_secrets'] as const) {
      this.rows[table] = this.rows[table].filter((row) => row.game_id !== gameId)
    }
  }

  /** `on delete cascade` from `auth.users` to `profiles` (0001_baseline.sql section 2). */
  deleteProfileFor(userId: string): void {
    this.rows.profiles = this.rows.profiles.filter((row) => row.user_id !== userId)
  }

  /** Column defaults, from each table's `create table` in 0001_baseline.sql. */
  private defaults(table: TableName): Row {
    const now = new Date().toISOString()
    switch (table) {
      case 'game_state':
        return { turn: 0, active_player_id: null, version: 0, updated_at: now }
      case 'game_state_meta':
        return { phase: null, turn: 0, version: 0, pending_player_ids: [], active_player_id: null, updated_at: now }
      // `gen_random_uuid()` on the primary key — a row inserted through the
      // API supplies no id, only a seeded fixture does.
      case 'games':
        return {
          id: globalThis.crypto.randomUUID(),
          created_at: now,
          updated_at: now,
          config_version: 0,
          visibility: 'private',
          status: 'lobby',
          min_players: 2,
          max_players: 4,
          settings: {},
        }
      case 'players':
        return { id: globalThis.crypto.randomUUID(), avatar_url: null, is_active: true, ready_for_version: 0, joined_at: now }
      case 'profiles':
        return { discord_webhook_url: null, display_name: null, is_admin: false, preferences: {}, updated_at: now }
      case 'chat_messages':
        return { id: this.nextChatMessageId++, game_id: null, created_at: now }
      case 'chat_read_status':
        return { id: globalThis.crypto.randomUUID(), last_read_id: 0, updated_at: now }
      case 'game_secrets':
        return { created_at: now }
      default:
        return {}
    }
  }

  private afterWrite(table: TableName, row: Row): void {
    if (table === 'game_state') this.syncGameStateMeta(row as unknown as GameStateRow)
  }

  /**
   * `game_state_sync_meta`, the security-definer after-insert-or-update
   * trigger on `game_state` (0001_baseline.sql section 6), transcribed field
   * for field.
   *
   * What makes it worth modeling at all: it reads `status`/`phase`/`turn`/
   * `pendingPlayerIds` straight off the stored JSON with `->>`/`->`, so it
   * can only see them if they're in plaintext. A rule-enforced game's state
   * column is gzipped (gameStateCompression.ts), which is why that encoding
   * duplicates exactly these keys alongside the blob. Reading the stored row
   * here rather than a decompressed GameState is what lets a test notice if
   * that duplication ever regresses (status would read 'unknown').
   *
   * `pending_player_ids` is `state.pendingPlayerIds` while the game is
   * active (and only if it's a JSON array), `[]` otherwise;
   * `active_player_id` mirrors the `game_state` column, not the JSON.
   */
  private syncGameStateMeta(row: GameStateRow): void {
    const state = row.state as unknown as Record<string, unknown>
    const status = typeof state.status === 'string' ? state.status : 'unknown'
    const pendingPlayerIds = state.pendingPlayerIds
    const pending = status === 'active' && Array.isArray(pendingPlayerIds) ? (structuredClone(pendingPlayerIds) as string[]) : []
    const phase = state.phase === undefined || state.phase === null ? null : String(state.phase)

    const meta: GameStateMetaRow = {
      game_id: row.game_id,
      status,
      phase,
      turn: Number(state.turn ?? 0),
      version: row.version,
      pending_player_ids: pending,
      active_player_id: row.active_player_id,
      updated_at: new Date().toISOString(),
    }
    const existing = this.rows.game_state_meta.find((m) => m.game_id === row.game_id)
    if (existing) Object.assign(existing, meta)
    else this.rows.game_state_meta.push(meta as unknown as Row)
  }
}
