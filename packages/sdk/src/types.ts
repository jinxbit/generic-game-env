// Core data types for the rules framework.
//
// This module is pure TypeScript: no React, no Supabase, no I/O. The engine
// operates purely on these types via applyAction() in ./applyAction.ts.
//
// `GameState` is an envelope: the fields every game shares (players, whose
// turn it is, status, the action log) live here, and everything specific to
// the game being played lives under `game` and `options`, typed by the game
// package's own `TData`/`TOptions`. The framework never reads inside either;
// it calls the game's rules through the GameDefinition contract
// (./gameDefinition.ts), found by `gameType`/`rulesVersion` in the registry
// (./registry.ts).

import type { LoggedAction } from './actions.ts'

export type PlayMode = 'live' | 'async' | 'hotseat'

/**
 * `lobby` only exists inside createNewGame (./createGame.ts), which
 * immediately hands the game to the game's own `setup`, which moves it to
 * `active`. `completed` once `winnerPlayerIds` is decided.
 */
export type GameStatus = 'lobby' | 'active' | 'completed'

export interface Player {
  id: string
  /** Supabase auth user id, when known. */
  authUserId: string | null
  displayName: string
  color: string
  /**
   * True once this player has left the game (CONCEDE). Eliminated players
   * are removed from `turnOrder`/`pendingPlayerIds` and excluded from
   * winning; the game's own `onPlayerEliminated` hook decides what else
   * that means.
   */
  eliminated: boolean
  /** True if `eliminated` came from CONCEDE — purely presentational ("conceded" vs "eliminated"). */
  conceded?: boolean
}

/**
 * A displayable narration entry — "Alice picked 3", "Round 2 begins", etc.
 * Not stored on GameState: derived on demand from actionHistory by
 * ./gameLog.ts's buildGameLog.
 */
export interface GameEvent {
  id: string
  turn: number
  playerId: string | null
  message: string
  timestamp: string
  /**
   * Index into `actionHistory` of the entry this line narrates. Lets
   * redactGameLog (./redaction.ts) re-check, against the *current* state,
   * whether the entry is still secret from a given viewer.
   */
  entryIndex: number
  /** What to show instead of `message` while the entry is secret from the viewer — see GameDefinition.describeAction. */
  redactedMessage?: string
  /** Mirrors LoggedAction.viaAdminMode — rendered as an "(admin mode)" tag. */
  adminMode?: boolean
}

export interface GameState<TData = unknown, TOptions = unknown> {
  gameId: string
  /** Which registered game this is — GameDefinition.id. Fixed at genesis. */
  gameType: string
  /**
   * Which version of that game's rules the game was started under —
   * GameDefinition.rulesVersion. Fixed at genesis; replay always uses exactly
   * this version, so a rules change that isn't replay-compatible ships as a
   * new version registered alongside the old one.
   */
  rulesVersion: number
  playMode: PlayMode
  status: GameStatus
  /**
   * Opt-in switch for the redacted read path — a creation-time choice
   * (games.settings.hiddenInformationEnabled), immutable for the whole game.
   * Only meaningful alongside ruleEnforcementEnabled and never for hotseat
   * (src/lib/hiddenInformationEligibility.ts). The engine itself never reads
   * it; get-game-state and the write-path Edge Functions decide whether to
   * run redactStateForPlayer at all.
   */
  hiddenInformationEnabled: boolean
  /** Game-defined turn/round counter. Stamped onto each LoggedAction and projected into game_state_meta. */
  turn: number
  /** Game-defined phase label (e.g. 'pick'), or null. Projected into game_state_meta.phase for listing screens. */
  phase: string | null
  /** The single player whose turn it is in a sequential phase; null in a simultaneous one. */
  activePlayerId: string | null
  /**
   * Every player who may act right now — `[activePlayerId]` in a sequential
   * phase, several ids in a simultaneous one, `[]` once nobody is owed a
   * move (lobby/completed). Drives turn notifications, the "your turn"
   * badges on listing screens and hotseat hand-off, so the game must keep
   * it accurate.
   */
  pendingPlayerIds: string[]
  /** Seating/turn order of players still in the game. */
  turnOrder: string[]
  /** Every seated player, in seat order. Never shrinks — elimination flags a player instead. */
  players: Player[]
  /** The winner(s) once the game ends. Can hold several ids on a tie. Empty until then. */
  winnerPlayerIds: string[]
  /**
   * The game's creation-time options (games.settings.gameOptions), as
   * normalized by GameDefinition.normalizeOptions — carried here so a running game and
   * its export stay self-contained. Read these, not the `games` row.
   */
  options: TOptions
  /**
   * The game's random seed (games.settings.randomSeed), rolled once when the
   * room was created — carried here, like `options`, so a running game and
   * its export stay self-contained. Rules draw from it only through
   * `gameRandom` (./random.ts), never `Math.random()`. Absent for a game
   * created before seeds existed; `gameRandom` treats that as a fixed seed.
   * Not secret: every player can read it.
   */
  randomSeed?: string
  /** The game-specific state — owned entirely by the game package. */
  game: TData
  /**
   * Event sourcing: every action applyAction() has accepted, in order.
   * Empty at genesis (buildGenesisState, src/lib/gameGenesis.ts), which is
   * itself deterministic from the `games` row and seated players. Replaying
   * this through applyAction() from that genesis always reconstructs this
   * exact GameState (./replay.ts). Append-only: undo/redo are themselves
   * logged entries (./historyFold.ts).
   */
  actionHistory: LoggedAction[]
  /**
   * Whether "room admin mode" is on — toggled only by SET_ADMIN_MODE
   * (./actions.ts). Absent is equivalent to false. While on, the room owner
   * or a site admin may discard another player's undone action by branching
   * (supabase/functions/_shared/gameEnforcement.ts's requiresOwnerOverride),
   * and every other action logged is stamped `viaAdminMode`.
   */
  adminModeActive?: boolean
}

/** The framework envelope before the game's own setup has run — what GameDefinition.setup receives. */
export type LobbyState<TOptions = unknown> = Omit<GameState<unknown, TOptions>, 'game'>

/** The result of applying a single action. */
export type ActionResult<TState = GameState> = { ok: true; state: TState } | { ok: false; error: string }
