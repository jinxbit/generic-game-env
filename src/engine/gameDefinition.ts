import type { LoggedAction } from './actions.ts'
import type { ActionResult, GameState, LobbyState } from './types.ts'
import type { GameAction, GameData, GameOptions } from '../game/types.ts'

/**
 * Narration for one dispatched game action — see GameDefinition.describeAction.
 * `{player}` in either string is replaced with the acting player's name by
 * the UI (gameLog.ts's PLAYER_PLACEHOLDER).
 */
export interface ActionDescription {
  message: string
  /**
   * Shown instead of `message` to a viewer the entry is still secret from
   * (GameDefinition.isActionSecret). Omit for an action that's never secret.
   */
  redactedMessage?: string
}

/**
 * The contract between the framework (src/engine/) and the pluggable game
 * slot (src/game/). The framework owns everything every game shares — the
 * action log, undo/redo, concede, admin mode, forced-move folding,
 * redaction plumbing — and calls these hooks for everything game-specific.
 *
 * Every hook must be pure and deterministic: the same inputs always give the
 * same output, with no randomness, clock reads or ambient state, since the
 * whole game is replayed from genesis on every undo, on every server-side
 * submission, and in every client. Randomness a game needs must be resolved
 * before genesis and stored in `games.settings` (see src/lib/gameGenesis.ts).
 */
export interface GameDefinition {
  /** Fallback options for any game whose settings omit them. */
  defaultOptions: GameOptions
  minPlayers: number
  maxPlayers: number

  /**
   * Builds the genesis state for a new game from the framework's lobby
   * envelope (players seated, `turnOrder` in seat order, `status: 'lobby'`,
   * no `game` yet). Must return it `status: 'active'` with `options` (normalized),
   * `game`, `turn`,
   * `phase`, `activePlayerId` and `pendingPlayerIds` set for the first move.
   */
  setup(lobby: LobbyState, options: GameOptions): GameState

  /**
   * Applies one game action to an `active` game. Must reject (ok: false) an
   * illegal action — including one from a player who may not act right now —
   * and never mutate its input. Framework-level fields (`pendingPlayerIds`,
   * `activePlayerId`, `turn`, `phase`, `status`, `winnerPlayerIds`) are the
   * game's to keep up to date. Do not touch `actionHistory`: the framework
   * appends the log entry.
   */
  applyAction(state: GameState, action: GameAction): ActionResult

  /**
   * Called after the framework has flagged `playerId` eliminated (CONCEDE) and
   * removed them from `turnOrder`/`pendingPlayerIds`. Advance whatever their
   * move was blocking (e.g. resolve a simultaneous round everyone else has
   * already finished). The framework ends the game itself when only one
   * player remains, before calling this.
   */
  onPlayerEliminated(state: GameState, playerId: string): GameState

  /**
   * A move with only one legal option that nobody really needs to make, or
   * null. applyAction keeps dispatching these until none is left, folding
   * them all into the triggering action's single log entry. Return null if
   * your game has no such thing.
   */
  nextForcedAction(state: GameState): GameAction | null

  /**
   * The game-specific state as `viewerId` may see it (a player id, or null for
   * a non-player). Only called for games with hidden information enabled.
   * Mask whatever is still secret, keeping the same type so the client can
   * render it like any other state.
   */
  redactGame(state: GameState, viewerId: string | null): GameData

  /**
   * Whether this log entry would reveal something still secret from
   * `viewerId` right now. Secret entries are withheld from that viewer's copy
   * of the log (redaction.ts) and narrated with `redactedMessage`. Must agree
   * with `redactGame`: anything masked there must also be masked here.
   */
  isActionSecret(entry: LoggedAction, state: GameState, viewerId: string | null): boolean

  /** Narration for one game action, given the state just before and after it. */
  describeAction(action: GameAction, before: GameState, after: GameState): ActionDescription

  /** Short human-readable label for a phase (GameState.phase) on listing screens, e.g. "Picking". */
  describePhase(phase: string | null): string
}
