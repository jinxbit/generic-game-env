// Row shapes for the Supabase tables (see supabase/migrations/0001_baseline.sql).
// Deliberately separate from src/engine/types.ts: these describe how a game
// is stored/queried, not the rules-engine's in-memory GameState shape. The
// game_state.state column holds a serialized engine GameState.

import type { PlayMode, GameState as EngineGameState } from '@game-platform/sdk'

/**
 * Per-game, creation-time configuration — a single JSONB column
 * (games.settings) instead of one column per setting, so a new pregame
 * toggle doesn't need its own migration. Only meaningful up through the
 * lobby: set at creation (CreateGamePage.tsx), editable in the lobby, read
 * by buildGenesisState. Once a game is running, read the equivalent values
 * off GameState instead (GameState.options/hiddenInformationEnabled), not
 * this column.
 *
 * A stored row may predate a key, so treat every key as possibly absent in
 * practice even where the type says otherwise — each one below documents
 * the value an absent key means.
 */
export interface GameSettings {
  /** Hotseat only: skip GamePage.tsx's "pass the device" confirmation gate between local players' turns. Irrelevant for live/async. Absent = false. */
  skipHotseatPassGate: boolean
  /**
   * Server-side rule enforcement: when true, `game_state` writes are
   * rejected by RLS for anyone but the service role, and gameApi.ts routes
   * start/moves/undo/redo through the `start-game`/`apply-action`/
   * `undo-action`/`redo-action` Edge Functions instead of writing the table
   * directly. Absent = false (the client-trusted path). CreateGamePage.tsx
   * always sets it, so every game created through the UI is enforced; the
   * client-trusted path remains for other callers (tests, imports). Never
   * changed after creation.
   */
  ruleEnforcementEnabled: boolean
  /**
   * The redacted read path: when true (only meaningful alongside
   * `ruleEnforcementEnabled` — a client-trusted game has no server authority
   * to redact from), gameApi.ts reads this game's state through the
   * `get-game-state` Edge Function instead of the raw `game_state` row, so
   * whatever the game keeps secret (GameDefinition.redactGame) never reaches
   * an opponent's browser. Never for hotseat (see
   * hiddenInformationEligibility.ts). Absent = false.
   */
  hiddenInformationEnabled: boolean
  /** The game's own creation-time options, opaque here — GameDefinition.normalizeOptions makes sense of them. Absent = the game's defaults. */
  gameOptions?: unknown
  /**
   * The game's `rulesVersion` when the room was created, so genesis is always
   * rebuilt under the rules the game was started with. Absent = the newest
   * registered version.
   */
  rulesVersion?: number
}

/**
 * `status` only ever tracks the transitions this DB row can actually see (see
 * the baseline migration's `enforce_game_status_transition` trigger): 'lobby'
 * -> 'active' -> 'canceled' or 'lobby' -> 'canceled'. It never becomes
 * 'completed' — a finished game still reads 'active' here; that's tracked
 * separately in `game_state.state.status` instead (see GameStateRow,
 * myGamesView.ts). 'completed' is kept as an allowed DB value for forward
 * compatibility only. Only the room's Owner (`created_by`) may update or
 * delete this row.
 */
export interface GameRow {
  id: string
  room_code: string
  /** Owner-chosen at creation (CreateGamePage.tsx); immutable afterward — enforced server-side by a trigger. */
  name: string
  /** Which game the room plays — a registered GameDefinition.id (src/games/registry.ts). Immutable, enforced by the same trigger as `name`. */
  game_type: string
  play_mode: PlayMode
  status: 'lobby' | 'active' | 'completed' | 'canceled'
  min_players: number
  max_players: number
  created_by: string
  created_at: string
  updated_at: string
  settings: GameSettings
  /** Bumped by a trigger every time `settings` changes while the room is still in the lobby. Compare against a PlayerRow's `ready_for_version` to know if that player has acknowledged the current config (see roomReadiness.ts). */
  config_version: number
  /**
   * 'private' (default) rooms are reachable only via room code/link.
   * 'public' rooms additionally show up on the Public Rooms screen (see
   * publicRoomsView.ts). Owner-only to change.
   */
  visibility: 'public' | 'private'
}

export interface PlayerRow {
  id: string
  game_id: string
  user_id: string
  display_name: string
  avatar_url: string | null
  seat_index: number
  color: string
  is_active: boolean
  joined_at: string
  /** The GameRow.config_version this player last confirmed Ready for. Set automatically to the game's current config_version on insert; only changes afterward via markReady in gameApi.ts. */
  ready_for_version: number
}

/**
 * The columns every game-listing screen actually needs (MyGamesPage.tsx,
 * PublicRoomsPage.tsx, HomePage.tsx, AdminRoomsPage.tsx, via
 * MyGameEntry.players/PublicRoomEntry.players): `display_name` and
 * `seat_index` for GameOverviewCard's player list, `user_id` for
 * myPlayerIds/isMine/isMyTurn (gameApi.ts/myGamesView.ts/publicRoomsView.ts).
 * `avatar_url`/`color`/`is_active`/`joined_at`/`ready_for_version` are only
 * read once a specific game is open, off `listPlayers(gameId)`'s full rows
 * (LobbyPage.tsx/GamePage.tsx), so the listing queries leave them out.
 */
export type PlayerListRow = Pick<PlayerRow, 'id' | 'game_id' | 'user_id' | 'display_name' | 'seat_index'>

export interface GameStateRow {
  game_id: string
  state: EngineGameState
  turn: number
  active_player_id: string | null
  version: number
  updated_at: string
}

/**
 * Slim public projection of `GameStateRow`: status/phase/turn/version/
 * pendingPlayerIds/activePlayerId only, kept in sync with `game_state` by a
 * `security definer` trigger (`game_state_sync_meta`) on every insert/update —
 * clients never write this table directly. The cheap source listing screens
 * read (gameApi.ts's `fetchGameStateSummaries`) so they never download the
 * full `state` blob, and what GamePage.tsx subscribes to over Realtime.
 */
export interface GameStateMetaRow {
  game_id: string
  status: string
  phase: string | null
  turn: number
  version: number
  /** `state.pendingPlayerIds` while the game is active, `[]` otherwise. */
  pending_player_ids: string[]
  /** Mirrors `game_state.active_player_id`. Never hidden information. */
  active_player_id: string | null
  updated_at: string
}

/** A browser/device's Web Push subscription — see src/lib/pushNotify.ts. */
export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

/**
 * Simple per-account preferences that don't warrant their own column — a
 * single JSONB column (profiles.preferences), mirroring GameSettings above:
 * add a key here (and thread it through gameApi.ts's getProfilePreferences/
 * saveProfilePreferences) instead of a migration + dedicated column whenever
 * a new simple profile preference is needed.
 */
export interface ProfilePreferences {
  /**
   * Whether posting a message in a game's chat should trigger this player's
   * Discord webhook / Web Push notification for that game's other seated
   * players — see src/lib/chatNotificationPreference.ts and
   * supabase/functions/notify-discord-chat|notify-web-push-chat. Absent
   * means "use the default" (on).
   */
  chatNotificationsEnabled?: boolean
}

/**
 * Site-wide config singleton (`app_config`) — currently just the
 * chat kill switch. `id` is always `true`; there is exactly one row.
 */
export interface AppConfigRow {
  id: true
  /** Gates chat_messages' RLS policies. No client can write this column. */
  chat_enabled: boolean
}

/**
 * One chat message (CHAT_PLAN.md §3) — site-wide
 * (`game_id` null) or scoped to one game. Append-only: no edit/soft-delete
 * support yet. Sender identity is looked up via `profiles`/`useDisplayName`
 * like everywhere else in the app, not denormalized onto this row.
 */
export interface ChatMessageRow {
  id: number
  game_id: string | null
  sender_id: string
  body: string
  created_at: string
}

/**
 * How far one user has read one game's chat (CHAT_PLAN.md §13) — a cursor into `chat_messages.id`, not a timestamp.
 * In-game chat only; the site-wide channel has no read cursor. One row per
 * (user, game); RLS restricts every row to its own `user_id`.
 */
export interface ChatReadStatusRow {
  id: string
  user_id: string
  game_id: string
  last_read_id: number
  updated_at: string
}

/** Per-account settings (`profiles`). */
export interface ProfileRow {
  user_id: string
  discord_webhook_url: string | null
  /** Custom display name, overriding the OAuth-derived one. Null means "use the provider name" (src/lib/displayName.ts). */
  display_name: string | null
  /** Site admin: may delete any game and read any game's unredacted state. Nothing in the UI sets this — it's assigned directly via SQL. */
  is_admin: boolean
  /** Simple per-account preferences — see ProfilePreferences above. */
  preferences: ProfilePreferences
  updated_at: string
}
