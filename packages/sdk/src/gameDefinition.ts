import type { GameActionBase, LoggedAction } from './actions.ts'
import type { Random } from './random.ts'
import type { ActionResult, GameState, LobbyState } from './types.ts'

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
 * The contract between the framework (this package) and a game package.
 * The framework owns everything every game shares — the action log,
 * undo/redo, concede, admin mode, forced-move folding, redaction plumbing —
 * and calls these hooks for everything game-specific. A game package exports
 * one of these from its `rules` entry point; the app registers it
 * (registerGame, ./registry.ts).
 *
 * Everything here must be pure, deterministic and free of React, Supabase
 * and I/O: the same definition runs in the browser and in the Supabase Edge
 * Functions, and the whole game is replayed from genesis on every undo,
 * every server-side submission and in every client. Randomness comes only
 * from the `random` argument `setup`, `applyAction` and `onPlayerEliminated`
 * receive — never `Math.random()`. Every number drawn from it is recorded and
 * fed back on replay (./random.ts).
 */
export interface GameDefinition<TData = unknown, TOptions = unknown, TAction extends GameActionBase = GameActionBase> {
  /** Stable id, stored on every room (`games.game_type`) and game state. Never change it once games exist. */
  id: string
  /**
   * Bump when a rules change would make an existing game's history replay
   * differently (or not at all). A game always replays under the version it
   * started with, so keep the old definition registered until no game uses
   * it. A change that can't affect existing histories (new UI strings, a fix
   * to an unreachable branch) needn't bump it.
   */
  rulesVersion: number
  /** Display name — listing cards, lobby, notifications. */
  title: string
  /** What `GameState.turn` counts, for labels like "Round 3". */
  turnLabel: string
  minPlayers: number
  maxPlayers: number

  /** Options for a game whose settings omit them. */
  defaultOptions: TOptions
  /** Fills in and clamps possibly-missing/out-of-range options from a stored settings row. Must accept anything. */
  normalizeOptions(raw: unknown): TOptions
  /** One-line summary of a game's options for listing cards and the lobby. */
  describeOptions(options: TOptions): string

  /**
   * Builds the genesis state from the framework's lobby envelope (players
   * seated, `turnOrder` in seat order, `status: 'lobby'`, `options` already
   * normalized, no `game` yet). Must return it `status: 'active'` with
   * `game`, `turn`, `phase`, `activePlayerId` and `pendingPlayerIds` set for
   * the first move.
   *
   * Anything drawn from `random` here is recorded on the state
   * (`GameState.setupRandom`) so genesis can be rebuilt. A redacted viewer
   * never receives those numbers — they get genesis as a view — so setup may
   * deal secrets, as long as `redactGame` masks them.
   */
  setup(lobby: LobbyState<TOptions>, random: Random): GameState<TData, TOptions>

  /**
   * Applies one game action to an `active` game. Must reject (ok: false) an
   * illegal action — including one from a player who may not act right now —
   * and never mutate its input. The envelope's `pendingPlayerIds`,
   * `activePlayerId`, `turn`, `phase`, `status` and `winnerPlayerIds` are the
   * game's to keep up to date. Don't touch `actionHistory`: the framework
   * appends the log entry.
   *
   * `random` is shared by this call and every forced follow-up folded into
   * the same entry; what's drawn is recorded on that entry
   * (`LoggedAction.random`). If a draw decides something still secret from
   * some player, `isActionSecret` must say the entry is secret from them, or
   * the recorded numbers reveal it.
   */
  applyAction(state: GameState<TData, TOptions>, action: TAction, random: Random): ActionResult<GameState<TData, TOptions>>

  /**
   * Called after the framework has flagged `playerId` eliminated (CONCEDE) and
   * removed them from `turnOrder`/`pendingPlayerIds`. Advance whatever their
   * move was blocking. The framework ends the game itself when only one
   * player remains, before calling this.
   */
  onPlayerEliminated(state: GameState<TData, TOptions>, playerId: string, random: Random): GameState<TData, TOptions>

  /**
   * A move with only one legal option that nobody really needs to make, or
   * null. applyAction keeps dispatching these until none is left, folding
   * them into the triggering action's single log entry.
   */
  nextForcedAction(state: GameState<TData, TOptions>): TAction | null

  /**
   * The game-specific state as `viewerId` may see it (a player id, or null for
   * a non-player). Only called for games with hidden information enabled.
   * Mask whatever is still secret, keeping the same type.
   */
  redactGame(state: GameState<TData, TOptions>, viewerId: string | null): TData

  /**
   * Whether this log entry would reveal something still secret from
   * `viewerId` right now — through its action or its narration. While true,
   * the viewer gets a HIDDEN_ACTION placeholder and the `redactedMessage`
   * narration instead (./viewLog.ts). Must agree with `redactGame`: anything
   * masked there must also be masked here, or the log leaks it straight back
   * out.
   */
  isActionSecret(entry: LoggedAction, state: GameState<TData, TOptions>, viewerId: string | null): boolean

  /**
   * Narration for one game action, given the (true) state just before and
   * after it. For a hidden-information game the server calls this when it
   * writes the entry and stores both wordings (./viewLog.ts); `redactedMessage`
   * is what a viewer reads while the entry is secret from them.
   */
  describeAction(action: TAction, before: GameState<TData, TOptions>, after: GameState<TData, TOptions>): ActionDescription

  /** Short human-readable label for a phase (GameState.phase), e.g. "Picking". */
  describePhase(phase: string | null): string
}

/** A definition of any game — what the registry holds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDefinition = GameDefinition<any, any, any>
