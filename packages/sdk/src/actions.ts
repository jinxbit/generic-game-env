/**
 * The shape every game-defined action shares. A game's own action union
 * (e.g. `{ type: 'PICK_NUMBER'; playerId: string; value: number }`) is
 * assignable to this. `playerId` is required: the server authorizes the
 * submitter against it. The framework's own type names (CONCEDE,
 * UNDO_ACTION, REDO_ACTION, SET_ADMIN_MODE, HIDDEN_ACTION) are reserved.
 */
export interface GameActionBase {
  type: string
  playerId: string
}

/**
 * A player gives up, at any point once the game is active — not tied to any
 * phase or to it being their turn. The framework flags them eliminated and
 * removes them from turn order, then hands off to the game's
 * `onPlayerEliminated` hook to advance whatever their pending move was
 * blocking (see applyConcede in ./applyAction.ts).
 */
export interface ConcedeAction {
  type: 'CONCEDE'
  playerId: string
}

/**
 * Rolls the game back by one logged action. Appended to `actionHistory` like
 * any other action — nothing is ever removed from the log, so every client
 * sees the same undo/redo state and reloading changes nothing. See
 * ./historyFold.ts for how the in-effect prefix is derived.
 *
 * `playerId` is null when nobody in particular is acting (e.g. after the
 * game ended) and otherwise is purely for narration — never checked for
 * legality. Who may undo is decided by the caller (GamePage.tsx client-side,
 * the undo-action Edge Function server-side).
 */
export interface UndoAction {
  type: 'UNDO_ACTION'
  playerId: string | null
}

/** Re-applies the most recently undone action — see UndoAction above. */
export interface RedoAction {
  type: 'REDO_ACTION'
  playerId: string | null
}

/**
 * Toggles `GameState.adminModeActive`. The room owner and site admins must
 * deliberately switch this on before they can discard another player's
 * undone action via a branching submission, and because it's a logged
 * action the room keeps a permanent record of when it was on. Who may
 * submit it is checked by the caller (the engine has no notion of room
 * ownership). Kept out of the undo/redo pointer walk (./historyFold.ts), so
 * a bare Undo never reverts it.
 */
export interface SetAdminModeAction {
  type: 'SET_ADMIN_MODE'
  playerId: string | null
  enabled: boolean
}

/** The actions the framework itself understands, independent of the game being played. */
export type FrameworkAction = ConcedeAction | UndoAction | RedoAction | SetAdminModeAction

export type Action = GameActionBase | FrameworkAction

export const RESERVED_ACTION_TYPES: readonly string[] = ['CONCEDE', 'UNDO_ACTION', 'REDO_ACTION', 'SET_ADMIN_MODE', 'HIDDEN_ACTION']

export function isFrameworkAction(action: Action): action is FrameworkAction {
  return action.type === 'CONCEDE' || action.type === 'UNDO_ACTION' || action.type === 'REDO_ACTION' || action.type === 'SET_ADMIN_MODE'
}

/**
 * One entry in `GameState.actionHistory`. `turn` and `timestamp` are
 * metadata only — replay never depends on either, only on `action` and the
 * order entries appear in.
 *
 * A forced single-option follow-up (GameDefinition.nextForcedAction) never
 * gets its own entry: applyAction folds it into the same entry as whatever
 * triggered it, so one submitted action always produces exactly one entry.
 */
export interface LoggedAction {
  action: Action
  turn: number
  timestamp: string
  /** True if admin mode was already on when this entry was submitted. Absent (not false) otherwise, and never set on SET_ADMIN_MODE itself. */
  viaAdminMode?: boolean
}
