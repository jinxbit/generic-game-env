import { supabase } from './supabase'
import { decompressGameStateFromStorage, type StoredGameState } from './gameStateCompression'
import type { GameStateSummary } from './gameCardView'
import { buildGenesisState } from './gameGenesis'
import { canStartGame } from './roomReadiness'
import { nextSeatIndex } from './seatIndex'
import { remapGameStatePlayerIds } from './duplicateGameState'
import { decodeGameStateExport } from './gameStateExport'
import type {
  GameRow,
  GameSettings,
  GameStateMetaRow,
  PlayerListRow,
  PlayerRow,
  ProfilePreferences,
  PushSubscriptionRow,
} from './dbTypes'
import type { MyGameEntry } from './myGamesView'
import type { PublicRoomEntry } from './publicRoomsView'
import { resolveChatNotificationsEnabled } from './chatNotificationPreference'
import type { GameState as EngineGameState, GameStatus, PlayMode } from '../engine/types'
import type { GameOptions } from '../game/types'
import type { Action } from '../engine/actions'
import { applyRedactedGameStateDelta, toClientGameState, type RedactedGameState, type RedactedGameStateDelta, type RedactedLoggedAction } from '../engine/redaction'
import type { InFlightOverlay } from '../engine/inFlightOverlay'
import type { DeltaReplayContext } from './deltaReplayContext'
import { applyReplayDelta, deriveBaseFromView, type ReplayDeltaFailure, type ReplayDeltaResponse } from './replayDelta'

/**
 * Reads a user's Discord webhook URL (`profiles.discord_webhook_url`, see
 * the baseline migration's profiles section). Used by a player loading their
 * own settings — the row is own-row readable only; notifications are sent
 * server-side by the notify-discord-* Edge Functions under the service role.
 * `null` covers both "no profile row yet" and "profile row with no webhook set".
 */
export async function getDiscordWebhookUrl(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('discord_webhook_url').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.discord_webhook_url ?? null
}

export async function saveDiscordWebhookUrl(userId: string, webhookUrl: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, discord_webhook_url: webhookUrl })
  if (error) throw error
}

/**
 * Web Push subscriptions saved for this user (`push_subscriptions`) —
 * used by src/lib/pushNotify.ts to know whether the *current* browser
 * already has one, so PushNotificationSettings.tsx can show on/off state.
 */
export async function getPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

export async function savePushSubscription(userId: string, subscription: PushSubscriptionJSON): Promise<void> {
  if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
    throw new Error('Incomplete push subscription')
  }
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}

/**
 * Reads a user's custom display name (`profiles.display_name`), if
 * they've set one — `null` covers both "no profile row yet" and "profile
 * row with no custom name set", both of which mean "fall back to the
 * Discord name" (see resolveDisplayName in lib/displayName.ts).
 */
export async function getProfileDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('display_name').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.display_name ?? null
}

export async function saveProfileDisplayName(userId: string, displayName: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, display_name: displayName })
  if (error) throw error
}

/**
 * Reads the generic `preferences` JSONB blob (profiles.preferences,
 * ProfilePreferences) — a missing profile row (never having been written to)
 * collapses to `{}`, same as every individual key inside it being absent.
 */
async function getProfilePreferences(userId: string): Promise<ProfilePreferences> {
  const { data, error } = await supabase.from('profiles').select('preferences').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.preferences ?? {}
}

/**
 * Merges `patch` into the user's existing `preferences` blob and writes it
 * back — read-modify-write so setting one preference never clobbers others
 * saved independently. Every simple profile preference (see
 * ProfilePreferences in dbTypes.ts) should go through this instead of its
 * own column, so adding one doesn't need a migration.
 */
async function saveProfilePreferences(userId: string, patch: Partial<ProfilePreferences>): Promise<void> {
  const current = await getProfilePreferences(userId)
  const { error } = await supabase.from('profiles').upsert({ user_id: userId, preferences: { ...current, ...patch } })
  if (error) throw error
}

/**
 * Reads a user's "notify me on chat messages" preference (stored under
 * `preferences.chatNotificationsEnabled`) — absent (including "no profile
 * row yet") resolves to the default (on), same null-collapsing pattern as
 * getProfileDisplayName. Read
 * server-side too, by the notify-discord-chat / notify-web-push-chat Edge
 * Functions, via their service-role client.
 */
export async function getProfileChatNotificationsEnabled(userId: string): Promise<boolean> {
  const preferences = await getProfilePreferences(userId)
  return resolveChatNotificationsEnabled(preferences.chatNotificationsEnabled)
}

export async function saveProfileChatNotificationsEnabled(userId: string, value: boolean): Promise<void> {
  await saveProfilePreferences(userId, { chatNotificationsEnabled: value })
}

/**
 * Whether this user is a site admin (`profiles.is_admin`) — `false` covers both "no profile row
 * yet" and "profile row with the flag unset", same null-collapsing pattern
 * as getProfileDisplayName. There's no UI to set this; it's assigned
 * directly via SQL, so this is read-only.
 */
export async function getIsAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('is_admin').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.is_admin ?? false
}

const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899']
/** One color per seat (PLAYER_COLORS above), so this is also the hard ceiling on max_players — used by LobbyPage.tsx's config editor to bound the input. */
export const MAX_PLAYERS = PLAYER_COLORS.length
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I

export function generateRoomCode(length = 5): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]
  }
  return code
}

export async function createGame(params: {
  /** Owner-chosen room name, immutable after creation (see dbTypes.ts's GameRow.name). Trimmed and length-checked here to match the DB's constraint; the DB is the source of truth. */
  name: string
  playMode: PlayMode
  userId: string
  displayName: string
  avatarUrl: string | null
  minPlayers?: number
  maxPlayers?: number
  /** Game-specific creation-time options (GameSettings.gameOptions); the game's defaults when omitted. */
  gameOptions?: GameOptions
  /** Hotseat only: skip the "pass the device" confirmation gate between local players' turns (see GamePage.tsx). Ignored for live/async. Defaults to false (gate shown) when omitted; CreateGamePage.tsx's checkbox defaults to checked (true). */
  skipHotseatPassGate?: boolean
  /** Opt in to server-side rule enforcement for this game (see GameSettings.ruleEnforcementEnabled). Defaults to false when omitted, so a caller that doesn't care gets the client-trusted path; CreateGamePage.tsx always passes true — every game created through the UI is enforced. */
  ruleEnforcementEnabled?: boolean
  /** Opt in to the redacted read path (see GameSettings.hiddenInformationEnabled) — only meaningful alongside ruleEnforcementEnabled. Defaults to false when omitted; CreateGamePage.tsx passes `hiddenInformationAvailable` (src/lib/hiddenInformationEligibility.ts). */
  hiddenInformationEnabled?: boolean
  /** Whether the room is listed on the Public Rooms screen. Defaults to 'private' when omitted; CreateGamePage.tsx's checkbox defaults to checked ('public'). */
  visibility?: GameRow['visibility']
}): Promise<{ game: GameRow; player: PlayerRow }> {
  const roomCode = generateRoomCode()
  const name = params.name.trim()
  if (name.length === 0 || name.length > 60) {
    throw new Error('Room name must be between 1 and 60 characters')
  }

  const settings: GameSettings = {
    skipHotseatPassGate: params.skipHotseatPassGate ?? false,
    ruleEnforcementEnabled: params.ruleEnforcementEnabled ?? false,
    hiddenInformationEnabled: params.hiddenInformationEnabled ?? false,
    ...(params.gameOptions ? { gameOptions: params.gameOptions } : {}),
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      room_code: roomCode,
      name,
      play_mode: params.playMode,
      created_by: params.userId,
      min_players: params.minPlayers ?? 2,
      max_players: params.maxPlayers ?? 8,
      settings,
      visibility: params.visibility ?? 'private',
    })
    .select()
    .single()

  if (gameError) throw gameError

  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      game_id: game.id,
      user_id: params.userId,
      display_name: params.displayName,
      avatar_url: params.avatarUrl,
      seat_index: 0,
      color: PLAYER_COLORS[0],
    })
    .select()
    .single()

  if (playerError) throw playerError

  return { game: game as GameRow, player: player as PlayerRow }
}

export async function getGameByRoomCode(roomCode: string): Promise<GameRow | null> {
  const { data, error } = await supabase
    .from('games')
    .select()
    .eq('room_code', roomCode.toUpperCase())
    .maybeSingle()

  if (error) throw error
  return data as GameRow | null
}

export async function listPlayers(gameId: string): Promise<PlayerRow[]> {
  const { data, error } = await supabase
    .from('players')
    .select()
    .eq('game_id', gameId)
    .order('seat_index', { ascending: true })

  if (error) throw error
  return data as PlayerRow[]
}

/**
 * Every `game_state_meta` column a `GameStateSummary` is built from — shared
 * by `fetchGameStateSummaries` (below) and `listMyGames`'s own bounded
 * queries, which need the same columns but split across two
 * separate status-filtered requests rather than one unfiltered one.
 */
const GAME_STATE_SUMMARY_COLUMNS = 'game_id, status, phase, turn, pending_player_ids, active_player_id, updated_at'

type GameStateSummaryRow = Pick<
  GameStateMetaRow,
  'game_id' | 'status' | 'phase' | 'turn' | 'pending_player_ids' | 'active_player_id' | 'updated_at'
>

function summariesFromMetaRows(rows: GameStateSummaryRow[]): {
  summaryByGame: Map<string, GameStateSummary>
  updatedAtByGame: Map<string, string>
} {
  const summaryByGame = new Map<string, GameStateSummary>()
  const updatedAtByGame = new Map<string, string>()
  for (const row of rows) {
    summaryByGame.set(row.game_id, {
      status: row.status as GameStatus,
      phase: row.phase,
      turn: row.turn,
      activePlayerId: row.active_player_id,
      pendingPlayerIds: row.pending_player_ids,
    })
    updatedAtByGame.set(row.game_id, row.updated_at)
  }
  return { summaryByGame, updatedAtByGame }
}

/**
 * Fetches the cheap `game_state_meta` columns for a batch of games and
 * assembles a `GameStateSummary` per game — the shared plumbing behind
 * `roomEntriesForGames` (`listMyGames` below runs its own bounded variant of
 * this same query instead). Deliberately never touches `game_state` itself:
 * that table denies direct SELECT outright for a `hiddenInformationEnabled`
 * game (the baseline migration's hidden-information lockdown), including to a
 * viewer with no seat — exactly the case `listPublicRooms`/`listAllRooms` hit
 * — and even where it's still readable, `state` is the compressed full
 * GameState blob, and downloading+decompressing one per game on every
 * listing-screen visit is a real bandwidth cost. `game_state_meta` is kept in
 * sync with `game_state` by a DB trigger (`game_state_sync_meta`) on every
 * insert/update, so it's always as fresh as `state` would be, and its own RLS
 * is not narrowed by the hidden-information lockdown since none of this is
 * hidden information. See GameStateSummary's doc comment (gameCardView.ts)
 * for what this can't tell you compared to the full state.
 */
async function fetchGameStateSummaries(
  gameIds: string[],
): Promise<{ summaryByGame: Map<string, GameStateSummary>; updatedAtByGame: Map<string, string> }> {
  const { data: metas, error } = await supabase.from('game_state_meta').select(GAME_STATE_SUMMARY_COLUMNS).in('game_id', gameIds)
  if (error) throw error

  return summariesFromMetaRows(metas as GameStateSummaryRow[])
}

/**
 * Every `games` column used wherever a list of rooms is fetched
 * (listMyGames/listPublicRooms/listAllRooms below) rather than a single
 * room — everything GameOverviewCard's `buildGameCardSummary`
 * (gameCardView.ts) reads. Keep `settings` small: it goes out for every room
 * on every listing screen.
 */
const GAME_LIST_COLUMNS = 'id, room_code, name, play_mode, status, min_players, max_players, created_by, created_at, updated_at, config_version, visibility, settings'

/**
 * Every `players` column a listing screen's player chips need (see
 * PlayerListRow in dbTypes.ts) — `id, game_id, user_id, display_name,
 * seat_index`. Dropping `avatar_url`/`color`/`is_active`/`joined_at`/
 * `ready_for_version` here is deliberate: those five columns would go out
 * for every seat of every game on screen (My games/Public Rooms/Home/Admin
 * Rooms) despite nothing in the listing views reading them. A single game's
 * full roster (LobbyPage.tsx/GamePage.tsx, via listPlayers below) still
 * needs every column and keeps plain `select()`.
 */
const PLAYER_LIST_COLUMNS = 'id, game_id, user_id, display_name, seat_index'

/**
 * Every game the given user is seated in — for the "My games" screen
 * (MyGamesPage.tsx). Includes each game's cheap GameStateSummary (see
 * fetchGameStateSummaries/gameCardView.ts's GameStateSummary) so
 * myGamesView.ts can classify turn/finished status without downloading and
 * decompressing every game's full GameState; games.status alone can't tell
 * 'completed' apart from 'active' (see dbTypes.ts's GameRow
 * comment). `stateSummary` is left null for games still in the lobby, which
 * have no game_state row yet. RLS already scopes game_state/game_state_meta
 * reads to seated players.
 *
 * `excludeGameId` skips one game entirely (games/players/game_state alike)
 * — for GamePage.tsx's "other games" nudge, which already has the room it's
 * currently showing loaded via getGameState and only ever reads *other*
 * games out of this list (see nextGameNeedingInput).
 *
 * The `players.game_id` list above is every game the user has *ever* been
 * seated in — it grows without bound for the life of the account, since a
 * finished game never leaves it. Active/lobby/canceled games are each
 * naturally bounded (how many a person plausibly has in flight, or has
 * opened and abandoned), so only the completed bucket needs capping:
 * `FINISHED_GAMES_LIMIT` below, applied by Postgres itself via
 * `.eq('status', 'completed').order('updated_at', { ascending: false }).limit(...)`
 * rather than fetched-then-discarded client-side, so the row count actually
 * on the wire stops growing with the account's history instead of merely
 * being trimmed after the fact. `games`/`players` are then fetched only for
 * the resulting bounded id set. Older finished games aren't deleted — they
 * just don't round-trip on every visit; MyGamesPage.tsx notes the cap so a
 * long-time player doesn't read it as games disappearing.
 */
export const FINISHED_GAMES_LIMIT = 30

export async function listMyGames(userId: string, excludeGameId?: string): Promise<MyGameEntry[]> {
  const { data: myRows, error: myRowsError } = await supabase.from('players').select('game_id').eq('user_id', userId)
  if (myRowsError) throw myRowsError

  const gameIds = [...new Set((myRows as Pick<PlayerRow, 'game_id'>[]).map((p) => p.game_id))].filter(
    (id) => id !== excludeGameId,
  )
  if (gameIds.length === 0) return []

  const [
    { data: neverStartedGames, error: neverStartedError },
    { data: activeMetas, error: activeMetasError },
    { data: finishedMetas, error: finishedMetasError },
  ] = await Promise.all([
    // games.status never reaches 'completed' (see GameRow's doc comment) —
    // 'lobby'/'canceled' here means exactly "no game_state_meta row exists yet".
    supabase.from('games').select(GAME_LIST_COLUMNS).in('id', gameIds).in('status', ['lobby', 'canceled']),
    supabase.from('game_state_meta').select(GAME_STATE_SUMMARY_COLUMNS).in('game_id', gameIds).neq('status', 'completed'),
    supabase
      .from('game_state_meta')
      .select(GAME_STATE_SUMMARY_COLUMNS)
      .in('game_id', gameIds)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(FINISHED_GAMES_LIMIT),
  ])
  if (neverStartedError) throw neverStartedError
  if (activeMetasError) throw activeMetasError
  if (finishedMetasError) throw finishedMetasError

  const metaRows = [...(activeMetas as GameStateSummaryRow[]), ...(finishedMetas as GameStateSummaryRow[])]
  const { summaryByGame, updatedAtByGame } = summariesFromMetaRows(metaRows)
  const startedGameIds = metaRows.map((row) => row.game_id)
  const consideredGameIds = [...startedGameIds, ...(neverStartedGames as GameRow[]).map((g) => g.id)]

  const [{ data: startedGames, error: startedGamesError }, { data: allPlayers, error: allPlayersError }] = await Promise.all([
    startedGameIds.length === 0
      ? Promise.resolve({ data: [] as GameRow[], error: null })
      : supabase.from('games').select(GAME_LIST_COLUMNS).in('id', startedGameIds),
    consideredGameIds.length === 0
      ? Promise.resolve({ data: [] as PlayerListRow[], error: null })
      : supabase.from('players').select(PLAYER_LIST_COLUMNS).in('game_id', consideredGameIds),
  ])
  if (startedGamesError) throw startedGamesError
  if (allPlayersError) throw allPlayersError

  const games = [...(neverStartedGames as GameRow[]), ...(startedGames as GameRow[])]

  const playersByGame = new Map<string, PlayerListRow[]>()
  for (const p of allPlayers as PlayerListRow[]) {
    const list = playersByGame.get(p.game_id) ?? []
    list.push(p)
    playersByGame.set(p.game_id, list)
  }

  return games.map((game) => {
    const gamePlayers = (playersByGame.get(game.id) ?? []).sort((a, b) => a.seat_index - b.seat_index)
    return {
      game,
      players: gamePlayers,
      stateSummary: summaryByGame.get(game.id) ?? null,
      gameStateUpdatedAt: updatedAtByGame.get(game.id) ?? null,
      myPlayerIds: gamePlayers.filter((p) => p.user_id === userId).map((p) => p.id),
    }
  })
}

/**
 * Every room currently listed on the Public Rooms screen: visibility
 * 'public', excluding 'canceled' (canceled and deleted rooms never appear in
 * the listing — deleted rows don't exist to query at all). Shaped like
 * listMyGames's MyGameEntry (game/players/stateSummary) minus the
 * caller-specific `myPlayerIds`, since this list isn't scoped to any one user
 * — see publicRoomsView.ts for the grouping/status logic built on top of it.
 */
export async function listPublicRooms(): Promise<PublicRoomEntry[]> {
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select(GAME_LIST_COLUMNS)
    .eq('visibility', 'public')
    .neq('status', 'canceled')
    .order('updated_at', { ascending: false })
  if (gamesError) throw gamesError

  return roomEntriesForGames(games as GameRow[])
}

/**
 * Every room in the system, public or private, excluding 'canceled' for the
 * same reason listPublicRooms excludes it (canceled rooms have no
 * stateSummary to distinguish "in progress" from "finished" — see
 * publicRoomBucket). Used by AdminRoomsPage.tsx (gated by useIsAdmin) for
 * its "Joinable" bucket too, and by HomePage.tsx for its
 * in-progress/finished sections only — a private room's not-started/lobby
 * state must still never be surfaced as joinable outside "Your games" or the
 * room's own link, so HomePage filters this list down before rendering. Not
 * an RLS boundary either way, since the "games are readable by any
 * signed-in user" policy already lets any authenticated user select any game
 * row, and game_state_meta's read policy already lets any signed-in user
 * read a non-lobby game's meta regardless of visibility — so a private
 * room's phase/finished status resolves here the same way it does for public
 * rooms. No per-game full-state read happens here — see GameStateSummary's
 * doc comment (gameCardView.ts).
 */
export async function listAllRooms(): Promise<PublicRoomEntry[]> {
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select(GAME_LIST_COLUMNS)
    .neq('status', 'canceled')
    .order('updated_at', { ascending: false })
  if (gamesError) throw gamesError

  return roomEntriesForGames(games as GameRow[])
}

async function roomEntriesForGames(gameRows: GameRow[]): Promise<PublicRoomEntry[]> {
  if (gameRows.length === 0) return []
  const gameIds = gameRows.map((g) => g.id)

  const [
    { data: allPlayers, error: allPlayersError },
    { summaryByGame, updatedAtByGame },
  ] = await Promise.all([
    supabase.from('players').select(PLAYER_LIST_COLUMNS).in('game_id', gameIds),
    fetchGameStateSummaries(gameIds),
  ])
  if (allPlayersError) throw allPlayersError

  const playersByGame = new Map<string, PlayerListRow[]>()
  for (const p of allPlayers as PlayerListRow[]) {
    const list = playersByGame.get(p.game_id) ?? []
    list.push(p)
    playersByGame.set(p.game_id, list)
  }

  return gameRows.map((game) => ({
    game,
    players: (playersByGame.get(game.id) ?? []).sort((a, b) => a.seat_index - b.seat_index),
    stateSummary: summaryByGame.get(game.id) ?? null,
    gameStateUpdatedAt: updatedAtByGame.get(game.id) ?? null,
  }))
}

export async function joinGame(params: {
  game: GameRow
  userId: string
  displayName: string
  avatarUrl: string | null
}): Promise<PlayerRow> {
  const existingPlayers = await listPlayers(params.game.id)

  const already = existingPlayers.find((p) => p.user_id === params.userId)
  if (already) return already

  if (params.game.status !== 'lobby') {
    throw new Error('This game has already started.')
  }
  if (existingPlayers.length >= params.game.max_players) {
    throw new Error('This game is full.')
  }

  const seatIndex = nextSeatIndex(existingPlayers)
  const { data, error } = await supabase
    .from('players')
    .insert({
      game_id: params.game.id,
      user_id: params.userId,
      display_name: params.displayName,
      avatar_url: params.avatarUrl,
      seat_index: seatIndex,
      color: PLAYER_COLORS[seatIndex % PLAYER_COLORS.length],
    })
    .select()
    .single()

  if (error) throw error
  return data as PlayerRow
}

/**
 * Hotseat's answer to joinGame(): the one signed-in host seats another
 * *local* player under their own user_id — the baseline migration's players
 * section deliberately has no `unique (game_id, user_id)`, so that doesn't
 * collide. No separate auth identity needed per seat, which is the whole
 * point of pass-and-play on a single device.
 */
export async function addLocalPlayer(params: { game: GameRow; hostUserId: string; displayName: string }): Promise<PlayerRow> {
  if (params.game.play_mode !== 'hotseat') {
    throw new Error('Local players can only be added to a hotseat game.')
  }
  if (params.game.status !== 'lobby') {
    throw new Error('This game has already started.')
  }

  const existingPlayers = await listPlayers(params.game.id)
  if (existingPlayers.length >= params.game.max_players) {
    throw new Error('This game is full.')
  }

  const seatIndex = nextSeatIndex(existingPlayers)
  const { data, error } = await supabase
    .from('players')
    .insert({
      game_id: params.game.id,
      user_id: params.hostUserId,
      display_name: params.displayName,
      avatar_url: null,
      seat_index: seatIndex,
      color: PLAYER_COLORS[seatIndex % PLAYER_COLORS.length],
    })
    .select()
    .single()

  if (error) throw error
  return data as PlayerRow
}

/**
 * "Duplicate as hot seat" (GamePage.tsx's hamburger menu):
 * snapshots a game's CURRENT state — mid-turn, mid-phase, or
 * even finished — into a brand-new hotseat room owned by the clicking
 * player, with every seat converted to a local pass-and-play player under
 * their own account (mirrors addLocalPlayer, just for a whole roster at
 * once and against a room seeded straight into 'active' rather than a
 * lobby someone starts). The source room and its players/state are never
 * touched — this only ever inserts new rows. Player ids are generated
 * client-side (rather than left to the DB's default) so the new roster is
 * known up front and the source GameState/GameSettings can be rewritten
 * onto it (see duplicateGameState.ts) before anything is written.
 *
 * The copy keeps the source's settings verbatim — including
 * `ruleEnforcementEnabled` — so undo/redo in the copy rebuild the same
 * genesis the source's history was recorded against.
 */
export async function duplicateGameAsHotseat(params: {
  sourceGame: GameRow
  sourcePlayers: PlayerRow[]
  sourceState: EngineGameState
  hostUserId: string
}): Promise<GameRow> {
  const playerIdMap: Record<string, string> = {}
  for (const p of params.sourcePlayers) {
    playerIdMap[p.id] = crypto.randomUUID()
  }

  const suffix = ' (copy)'
  const name = `${params.sourceGame.name.slice(0, 60 - suffix.length)}${suffix}`
  const settings = params.sourceGame.settings

  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      room_code: generateRoomCode(),
      name,
      play_mode: 'hotseat',
      status: 'active',
      created_by: params.hostUserId,
      min_players: params.sourcePlayers.length,
      max_players: params.sourcePlayers.length,
      settings,
      visibility: 'private',
    })
    .select()
    .single()
  if (gameError) throw gameError

  const { error: playersError } = await supabase.from('players').insert(
    params.sourcePlayers.map((p) => ({
      id: playerIdMap[p.id],
      game_id: game.id,
      user_id: params.hostUserId,
      display_name: p.display_name,
      avatar_url: null,
      seat_index: p.seat_index,
      color: p.color,
    })),
  )
  if (playersError) throw playersError

  const state = remapGameStatePlayerIds(params.sourceState, { newGameId: game.id, playerIdMap, hostUserId: params.hostUserId })
  await insertGameState(game.id, state)

  return game as GameRow
}

/**
 * Site-admin-only "Import game export": takes a pasted game
 * state export (GamePage.tsx's "Copy game export", `gameStateExport.ts`) —
 * typically one attached to a bug report — and creates a brand-new hotseat
 * room from it, owned by the importing admin, every seat turned into a
 * local pass-and-play player under their own account. This lets an admin
 * reproduce/inspect a reported game without needing direct Supabase access
 * or the reporter's account.
 *
 * Shares its player-remapping approach with duplicateGameAsHotseat above,
 * but there's no source GameRow/PlayerRow/GameSettings to read here — an
 * export only ever contains a bare GameState (see GameStateExportEnvelope).
 * The new room's settings are seeded with defaults — enforcement and hidden
 * information both off, which hotseat requires anyway and which this plain
 * client insert needs to be allowed by RLS at all — except `gameOptions`,
 * recovered from the export's own `GameState.options`, which
 * buildGenesisState (gameGenesis.ts) needs to rebuild the exact genesis the
 * export's actionHistory was recorded against.
 */
export async function importGameExportAsHotseat(params: { exportText: string; hostUserId: string }): Promise<GameRow> {
  const { gameState: sourceState } = await decodeGameStateExport(params.exportText)

  const playerIdMap: Record<string, string> = {}
  for (const p of sourceState.players) {
    playerIdMap[p.id] = crypto.randomUUID()
  }

  const settings: GameSettings = {
    skipHotseatPassGate: false,
    ruleEnforcementEnabled: false,
    hiddenInformationEnabled: false,
    gameOptions: sourceState.options,
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      room_code: generateRoomCode(),
      name: `Imported game (${new Date().toISOString().slice(0, 10)})`,
      play_mode: 'hotseat',
      status: 'active',
      created_by: params.hostUserId,
      min_players: sourceState.players.length,
      max_players: sourceState.players.length,
      settings,
      visibility: 'private',
    })
    .select()
    .single()
  if (gameError) throw gameError

  const { error: playersError } = await supabase.from('players').insert(
    sourceState.players.map((p, index) => ({
      id: playerIdMap[p.id],
      game_id: game.id,
      user_id: params.hostUserId,
      display_name: p.displayName,
      avatar_url: null,
      seat_index: index,
      color: p.color,
    })),
  )
  if (playersError) throw playersError

  const state = remapGameStatePlayerIds(sourceState, { newGameId: game.id, playerIdMap, hostUserId: params.hostUserId })
  await insertGameState(game.id, state)

  return game as GameRow
}

/** Removes a seated player — used pre-start to undo a mis-added hotseat local player (LobbyPage.tsx). RLS only allows deleting your own row ("users can delete their own player row"), which for hotseat covers every local player the host added. */
export async function removePlayer(playerId: string): Promise<void> {
  const { error } = await supabase.from('players').delete().eq('id', playerId)
  if (error) throw error
}

export async function setGameStatus(gameId: string, status: GameRow['status']): Promise<void> {
  const { error } = await supabase.from('games').update({ status }).eq('id', gameId)
  if (error) throw error
}

/**
 * Owner-only (RLS's "room owner can update their game" policy): toggles
 * whether the room is listed on the Public Rooms screen. Deliberately
 * separate from updateGameSettings — visibility isn't part of the game's
 * rules configuration, so changing it does not bump `config_version` or reset
 * player readiness.
 */
export async function setGameVisibility(gameId: string, visibility: GameRow['visibility']): Promise<void> {
  const { error } = await supabase.from('games').update({ visibility }).eq('id', gameId)
  if (error) throw error
}

/**
 * Owner-only (RLS's "room owner can update their game" policy), and only
 * while the room is still in the lobby (the `games_bump_config_version`
 * trigger rejects it otherwise). Bumps `config_version` server-side, which
 * is what makes every non-Owner seated player Not Ready again — player count
 * is configuration too; see roomReadiness.ts.
 */
export async function updateGameSettings(
  gameId: string,
  params: { settings: GameSettings; minPlayers: number; maxPlayers: number },
): Promise<void> {
  const { error } = await supabase
    .from('games')
    .update({ settings: params.settings, min_players: params.minPlayers, max_players: params.maxPlayers })
    .eq('id', gameId)
  if (error) throw error
}

/**
 * A seated player confirms they've seen the room's current configuration.
 * `configVersion` must be the room's *current* config_version — the
 * `players_enforce_ready_for_version` trigger rejects any other value, so a
 * stale client can't mark itself ready for a version that's since moved on.
 */
export async function markReady(playerId: string, configVersion: number): Promise<void> {
  const { error } = await supabase.from('players').update({ ready_for_version: configVersion }).eq('id', playerId)
  if (error) throw error
}

/**
 * Owner-only (the "room owner can update their game" RLS policy silently
 * drops the write for anyone else): moves a room from 'lobby' or 'active' to
 * 'canceled'. Disables further `game_state` writes and blocks new joins
 * (joinGame already rejects any `status !== 'lobby'`).
 */
export async function cancelGame(gameId: string): Promise<void> {
  const { error } = await supabase.from('games').update({ status: 'canceled' }).eq('id', gameId)
  if (error) throw error
}

/**
 * Owner-only, and only from a deletable state ('lobby' or 'canceled' — the
 * "room owner can delete their room in a deletable state" policy enforces
 * both). Cascades remove the room's `players`/`game_state` rows via their
 * existing FKs.
 */
export async function deleteGame(gameId: string): Promise<void> {
  const { error } = await supabase.from('games').delete().eq('id', gameId)
  if (error) throw error
}

export function subscribeToPlayers(gameId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`players:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, onChange)
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

/**
 * Fires with `payload.new` on every `games` row UPDATE.
 * That's Postgres's logical-replication view of the new row, not a fresh
 * `select()` — a column that's unchanged by this particular UPDATE *and*
 * stored out-of-line (TOASTed — a large `settings` can qualify) is omitted from it entirely rather than sent
 * as its last value. Callers must merge this onto their last known full row
 * (`{ ...prev, ...updated }`), never replace it outright, or an unrelated
 * status/visibility update can silently null out `settings` for the rest of
 * the session.
 */
export function subscribeToGame(gameId: string, onChange: (game: GameRow) => void): () => void {
  const channel = supabase
    .channel(`games:${gameId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => onChange(payload.new as GameRow),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export type { DeltaReplayContext } from './deltaReplayContext'
// Moved to ./replayDelta (see its header) so it can be imported without the
// Supabase client; re-exported here because this module is where the app, and
// the tests that drive the app's own call sites, have always imported it from.
export { applyReplayDelta, deriveBaseFromView, type ReplayDeltaFailure, type ReplayDeltaResponse } from './replayDelta'

export interface GameStateSnapshot {
  /** What to render: the viewer's full current view. */
  state: EngineGameState
  /**
   * What to cache and send back as the next delta's starting point: the state
   * replayed up to the viewer's safe `actionHistory` prefix, *before* the
   * in-flight overlay is laid over it (../engine/inFlightOverlay.ts).
   *
   * Never the same object as `state` when anything is masked, and that
   * distinction is load-bearing: caching the rendered view instead would
   * double-apply the overlay's effects the moment those actions became
   * visible and entered the replay for real. Absent when this response could
   * not produce one (no replay context, or a local replay that disagreed with
   * the server), in which case the caller should not cache.
   */
  base?: EngineGameState
  version: number
}


/**
 * Writes the game's very first GameState row (see createNewGame/startGame in
 * ../engine/createGame.ts). A no-op if a row already exists — startGameFromLobby
 * checks first via getGameState, but this stays defensive in case "start
 * game" is ever clicked twice in a race.
 */
export async function insertGameState(gameId: string, state: EngineGameState): Promise<void> {
  const { error } = await supabase
    .from('game_state')
    .insert({ game_id: gameId, state, turn: state.turn, active_player_id: state.activePlayerId })
  if (error && error.code !== '23505') throw error
}

/**
 * LobbyPage's Start Game button.
 *
 * A `ruleEnforcementEnabled` game routes through the start-game Edge Function
 * instead (see its own doc comment), making the server authoritative for
 * genesis too, not just every action after it; the baseline migration's
 * start-game lockdown (the `enforce_game_status_transition` trigger plus the
 * enforcement-off-only `game_state` INSERT policy) blocks this function's own
 * direct `game_state` INSERT / `games` UPDATE for such a game, so calling it
 * here would just fail RLS instead of silently doing the wrong thing.
 *
 * For every other game, deliberately re-fetches the seated roster here
 * rather than trusting whatever `players` list the caller already had in
 * React state: that state is only as fresh as the last `listPlayers()` call
 * or Realtime event the host's browser happened to receive, and that can
 * go stale — a 2-player GameState can get built for a room
 * with 3 people seated if the host clicks Start in the gap before
 * their client's copy of `players` has picked up the third join. Re-running
 * `canStartGame` against the freshly-fetched roster closes that gap: if the
 * room's shape changed since the caller last saw it (someone joined, left,
 * or went un-ready), this throws instead of silently building genesis from
 * the wrong roster. A residual window remains between this fetch and
 * `insertGameState` below — there's no DB-level CAS tying genesis's player
 * count to the `players` table — but that's a DB round-trip, not however
 * long a browser tab happened to sit open.
 *
 * A no-op past the roster check once a `game_state` row already exists (a
 * retry after a prior call inserted genesis but failed before flipping
 * `games.status`) — same idempotency `insertGameState` itself defends, one
 * layer up.
 */
export async function startGameFromLobby(game: GameRow): Promise<void> {
  if (game.settings.ruleEnforcementEnabled) {
    const result = await invokeStartGame(game.id)
    if (!result.ok) throw new Error(result.error)
    return
  }

  const existingState = await getGameState(game.id)
  if (!existingState) {
    const players = await listPlayers(game.id)
    if (!canStartGame(game, players)) {
      throw new Error('This room changed since you loaded it — refresh and try again.')
    }

    await insertGameState(game.id, buildGenesisState(game, players))
  }
  // The `games` row's own status stays the coarse lobby/active/canceled
  // (see dbTypes.ts) — whether the game has finished lives only in the
  // game_state row's GameState.status. So starting a game means: build the
  // genesis GameState (above), persist it, then flip `games.status` to
  // 'active' to move everyone out of the lobby screen.
  await setGameStatus(game.id, 'active')
}

export async function getGameState(gameId: string): Promise<GameStateSnapshot | null> {
  const { data, error } = await supabase.from('game_state').select('state, version').eq('game_id', gameId).maybeSingle()
  if (error) throw error
  if (!data) return null
  return { state: await decompressGameStateFromStorage(data.state as StoredGameState), version: data.version }
}

/**
 * The redacted read path for hidden-information games: reads via the
 * `get-game-state` Edge Function instead of the raw `game_state` row, so a
 * still-secret pick never reaches this browser's network stack in the first
 * place — see that function's own doc comment for exactly which callers get
 * masked. Only ever called for a game with both
 * GameSettings.ruleEnforcementEnabled and hiddenInformationEnabled true (see
 * GamePage.tsx's callers below); every other game keeps calling getGameState
 * above, completely unaffected by this function's existence. `null` covers
 * both "no game_state row yet" (404) and any other non-2xx response, mirroring
 * getGameState's own "no row" contract rather than surfacing transient errors
 * differently from that path.
 *
 * `previous`, when given, is a state this caller already applied (GamePage.tsx
 * threads through the last `gameState` it rendered) — its `actionHistory.length`
 * is sent as `sinceActionIndex`, and get-game-state/index.ts responds with just
 * the entries logged since then instead of the whole array (that array
 * dominates a full GameState's bytes, and every move only ever adds one
 * entry to it). `applyRedactedGameStateDelta`
 * (redaction.ts) does the actual splice-and-verify against `previous.actionHistory`
 * and is the pure, testable half of this; a `null` from it (a stale/foreign
 * `previous`, or any other inconsistency) falls back to an ordinary full fetch
 * rather than risk assembling a wrong `actionHistory`.
 */
export async function getGameStateRedacted(
  gameId: string,
  previous?: EngineGameState | null,
  replay?: DeltaReplayContext,
  fallbackReason?: ReplayDeltaFailure,
): Promise<GameStateSnapshot | null> {
  const sinceActionIndex = previous ? previous.actionHistory.length : undefined
  const protocol = replay ? 2 : undefined
  const { data, error } = await supabase.functions.invoke('get-game-state', {
    body: {
      gameId,
      ...(sinceActionIndex === undefined ? {} : { sinceActionIndex }),
      ...(protocol ? { protocol } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
    },
  })
  if (error) return null
  const result = data as
    | { ok: true; state: RedactedGameState; stateHash?: string; version: number }
    | ({ ok: true; version: number } & RedactedGameStateDelta)
    | { ok: true; version: number; actionHistoryFrom: number; actionHistoryAppend: RedactedLoggedAction[]; actionHistoryLength: number; overlay?: InFlightOverlay; stateHash: string }
    | { ok: false; error: string }
  if (!result.ok) return null

  // Protocol 2: no materialised state on the wire at all. Rebuild
  // it from the actions and verify — any failure is a cache miss, answered by
  // one full fetch.
  if ('stateHash' in result && 'actionHistoryAppend' in result && replay && previous) {
    const rebuilt = applyReplayDelta(previous, replay, result)
    if (!rebuilt.ok) return getGameStateRedacted(gameId, null, replay, rebuilt.reason)
    return { state: rebuilt.state, base: rebuilt.base, version: result.version }
  }

  if (!('actionHistoryAppend' in result)) {
    const state = toClientGameState(result.state)
    return { state, base: replay ? deriveBaseFromView(state, replay) : undefined, version: result.version }
  }
  // A protocol-2 delta that reached here has no replay context to apply it
  // with (only possible if `replay`/`previous` went missing between request
  // and response) — there is no materialised state in it to fall back on, so
  // ask for a full one.
  if (!('state' in result)) return getGameStateRedacted(gameId, null, replay, 'cursor-mismatch')
  const merged = applyRedactedGameStateDelta(previous!.actionHistory, result)
  if (!merged) return getGameStateRedacted(gameId)
  return { state: toClientGameState(merged), version: result.version }
}

/**
 * Writes a new GameState produced by applyAction(), guarded by the row's
 * `version` (see the baseline migration's game_state section) so two clients
 * racing to submit an action can't silently clobber each other — returns
 * false (no rows updated) when `expectedVersion` is stale, in which case the
 * caller should refetch via getGameState and let the player retry.
 */
export async function writeGameState(gameId: string, state: EngineGameState, expectedVersion: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('game_state')
    .update({ state, turn: state.turn, active_player_id: state.activePlayerId, version: expectedVersion + 1 })
    .eq('game_id', gameId)
    .eq('version', expectedVersion)
    .select('version')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/** Either arm of an Edge Function response body (see supabase/functions/apply-action|undo-action|redo-action/index.ts) — {ok:true} carries the resulting state/version, {ok:false} carries a player-facing error message. */
export type GameEnforcementResult = { ok: true; state: EngineGameState; base?: EngineGameState; version: number } | { ok: false; error: string }

/**
 * Invokes one of the rule-enforcement write Edge Functions and
 * normalizes its response into GameEnforcementResult either way. Used only
 * for games with GameSettings.ruleEnforcementEnabled on — see gameApi.ts
 * callers below and GamePage.tsx's branch in submitAction/handleUndo/
 * handleRedo. supabase-js reports a non-2xx response as `error` with `data:
 * null` rather than surfacing the function's own JSON body, so this reaches
 * into `error.context` (the raw Response) to recover the `{ok:false, error}`
 * message the function actually sent, falling back to the generic
 * FunctionsError message if that response body isn't there or isn't JSON.
 *
 * A success response's `state` is `RedactedGameState`-shaped, same as
 * `getGameStateRedacted` below (the write endpoints redact their response
 * the same way `get-game-state` redacts a read) — `toClientGameState`
 * collapses it back to a plain `GameState` here, at the network boundary, so
 * `GamePage.tsx`'s submitAction/handleUndo/handleRedo keep consuming
 * `GameEnforcementResult.state` exactly as before. This is a lossless round
 * trip whenever nothing was actually masked (see `toClientGameState`'s own
 * doc comment), so a game without `hiddenInformationEnabled` sees no
 * behavior change.
 */
async function invokeGameFunction(
  name: 'apply-action' | 'undo-action' | 'redo-action',
  body: Record<string, unknown>,
  previous?: EngineGameState | null,
  replay?: DeltaReplayContext,
): Promise<GameEnforcementResult> {
  // A move's own response would otherwise carry the whole state back, and
  // for the player actually playing that is the most frequent read there is.
  // Same protocol-2 contract as the read path (respondWithState builds both).
  const useDelta = Boolean(previous && replay)
  const { data, error } = await supabase.functions.invoke(name, {
    body: useDelta ? { ...body, sinceActionIndex: previous!.actionHistory.length, protocol: 2 } : body,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context) {
      try {
        const parsed = (await context.json()) as { error?: string }
        if (parsed.error) return { ok: false, error: parsed.error }
      } catch {
        // Response body wasn't JSON (or already consumed) — fall through to error.message below.
      }
    }
    return { ok: false, error: error.message }
  }
  const result = data as
    | { ok: true; state: RedactedGameState; stateHash?: string; version: number }
    | ({ ok: true } & ReplayDeltaResponse)
    | { ok: false; error: string }
  if (!result.ok) return result

  if (useDelta && 'stateHash' in result && 'actionHistoryAppend' in result) {
    const rebuilt = applyReplayDelta(previous!, replay!, result)
    // A miss here is not an error the player should see — the write itself
    // succeeded, only our local rebuild of the result didn't. Read the state
    // back in full and carry on, exactly as the read path does, reporting why
    // so the retry is counted as a rebuild failure rather than a cold start.
    if (rebuilt.ok) return { ok: true, state: rebuilt.state, base: rebuilt.base, version: result.version }
    const fresh = await getGameStateRedacted(body.gameId as string, null, replay, rebuilt.reason)
    if (!fresh) return { ok: false, error: 'The move was applied, but its result could not be read back. Refresh to continue.' }
    return { ok: true, state: fresh.state, base: fresh.base, version: fresh.version }
  }

  if (!('state' in result)) {
    const fresh = await getGameStateRedacted(body.gameId as string, null, replay, 'cursor-mismatch')
    if (!fresh) return { ok: false, error: 'The move was applied, but its result could not be read back. Refresh to continue.' }
    return { ok: true, state: fresh.state, base: fresh.base, version: fresh.version }
  }
  return { ok: true, state: toClientGameState(result.state), version: result.version }
}

/**
 * Same response-unwrapping as invokeGameFunction above, but for start-game
 * (supabase/functions/start-game/index.ts), whose success response carries
 * no state/version to redact or collapse — just `{ok:true}` — so it isn't
 * one more case of invokeGameFunction's own union.
 */
async function invokeStartGame(gameId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.functions.invoke('start-game', { body: { gameId } })
  if (!error) return { ok: true }
  const context = (error as { context?: Response }).context
  if (context) {
    try {
      const parsed = (await context.json()) as { error?: string }
      if (parsed.error) return { ok: false, error: parsed.error }
    } catch {
      // Response body wasn't JSON (or already consumed) — fall through to error.message below.
    }
  }
  return { ok: false, error: error.message }
}

/** Server-enforced action submission for a ruleEnforcementEnabled game — see supabase/functions/apply-action/index.ts. */
export async function applyActionEnforced(gameId: string, action: Action, previous?: EngineGameState | null, replay?: DeltaReplayContext): Promise<GameEnforcementResult> {
  return invokeGameFunction('apply-action', { gameId, action }, previous, replay)
}

/** Server-enforced undo (a logged pointer move, see historyFold.ts) for a ruleEnforcementEnabled game — see supabase/functions/undo-action/index.ts. */
export async function undoActionEnforced(gameId: string, previous?: EngineGameState | null, replay?: DeltaReplayContext): Promise<GameEnforcementResult> {
  return invokeGameFunction('undo-action', { gameId }, previous, replay)
}

/** Server-enforced redo (a logged pointer move, see historyFold.ts) for a ruleEnforcementEnabled game — see supabase/functions/redo-action/index.ts. */
export async function redoActionEnforced(gameId: string, previous?: EngineGameState | null, replay?: DeltaReplayContext): Promise<GameEnforcementResult> {
  return invokeGameFunction('redo-action', { gameId }, previous, replay)
}

/**
 * Subscribes to `game_state_meta` rather than `game_state` itself:
 * Realtime's `postgres_changes` broadcasts
 * the entire new row over the websocket on every event, so subscribing
 * directly to `game_state` meant every move pushed the full `GameState` JSON
 * (including the whole `actionHistory`) uncompressed to every client on
 * every turn. `game_state_meta` is kept in sync with `game_state` by a DB
 * trigger on every write and carries only `status`/`phase`/`turn`/`version`
 * — a few bytes — so all that
 * travels over the socket now is "something changed"; the actual state comes
 * from the `getGameState` REST call below, which (unlike the websocket) goes
 * over plain HTTP and gets normal gzip transport compression.
 *
 * This is deliberately just a read-side subscription swap (see the baseline
 * migration's game_state_meta section) — it doesn't touch `game_state`'s
 * RLS or writes.
 *
 * `redacted` (default false) swaps the refetch onto getGameStateRedacted
 * instead of getGameState — pass true for a game with both
 * ruleEnforcementEnabled and hiddenInformationEnabled on (GamePage.tsx),
 * same condition as every other read-path choice in this file.
 *
 * `getAppliedVersion`, when given, is consulted before paying for that HTTP
 * round trip: `game_state_meta`'s row (kept in sync with `game_state` by the
 * same `game_state_sync_meta` trigger that projects it) carries the new
 * `version` in the realtime payload itself, so if it's `<=` whatever the
 * caller already has applied — same comparison GamePage.tsx's
 * applyGameStateSnapshot uses, so this can never skip a fetch that guard
 * would have accepted — the fetch can only come back with what's already
 * showing and is skipped outright. This is the common case
 * right after this client's own write: it already applied the result
 * locally, then the trigger's own `game_state_meta` update echoes back over
 * the socket. Any other client on the same game still has a lower applied
 * version and still fetches. Omit `getAppliedVersion` (as the two
 * unconditional-refetch callers in GamePage.tsx do — initial load and
 * `useRefetchOnVisible`, whose entire point is recovering from events this
 * subscription missed) to always fetch, same as before this parameter
 * existed.
 *
 * `getAppliedState`, when given and `redacted` is true, is handed to
 * getGameStateRedacted as its `previous` — the per-move refetch this
 * subscription drives is exactly the hot path the incremental
 * actionHistory delta targets, so the same last-applied state
 * `getAppliedVersion` reads the version off of is reused here to also avoid
 * re-downloading the whole log on every move. Ignored when `redacted` is
 * false: getGameState has no equivalent parameter.
 */
export function subscribeToGameState(
  gameId: string,
  onChange: (snapshot: GameStateSnapshot) => void,
  redacted = false,
  getAppliedVersion?: () => number | null,
  getAppliedState?: () => EngineGameState | null,
  getReplayContext?: () => DeltaReplayContext | null,
): () => void {
  const fetchState = () => (redacted ? getGameStateRedacted(gameId, getAppliedState?.(), getReplayContext?.() ?? undefined) : getGameState(gameId))
  const channel = supabase
    .channel(`game_state:${gameId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'game_state_meta', filter: `game_id=eq.${gameId}` },
      (payload) => {
        const newVersion = (payload.new as Partial<GameStateMetaRow>).version
        const appliedVersion = getAppliedVersion?.() ?? null
        if (appliedVersion !== null && typeof newVersion === 'number' && newVersion <= appliedVersion) return
        void fetchState().then((snapshot) => {
          if (snapshot) onChange(snapshot)
        })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
