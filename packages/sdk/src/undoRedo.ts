import { resolveHistory } from './historyFold.ts'
import { replayActions } from './replay.ts'
import type { ActionResult, GameState } from './types.ts'

/** Same `viaAdminMode` stamp applyActionWithSteps gives every other entry logged while admin mode is on. */
function adminModeStamp(state: GameState): { viaAdminMode?: true } {
  return state.adminModeActive ? { viaAdminMode: true } : {}
}

export type { ResolvedHistory } from './historyFold.ts'
export { resolveHistory } from './historyFold.ts'

/**
 * Submits one UNDO_ACTION entry against `state`: appends the entry, then
 * re-derives the whole GameState via replayActions, which folds it in (see
 * resolveHistory, ./historyFold.ts). `genesis` — rebuilt by the caller with
 * buildGenesisState (src/lib/gameGenesis.ts) — is needed because undoing
 * isn't a step forward from `state`; it's a shorter replay from the start.
 *
 * One call always reverts exactly one log entry, including any forced
 * follow-ups folded into it (see applyAction's doc comment).
 */
export function applyUndoAction(genesis: GameState, state: GameState, playerId: string | null): ActionResult {
  if (!resolveHistory(state.actionHistory).canUndo) {
    return { ok: false, error: 'Nothing left to undo.' }
  }
  const history = [...state.actionHistory, { action: { type: 'UNDO_ACTION' as const, playerId }, turn: state.turn, timestamp: new Date().toISOString(), ...adminModeStamp(state) }]
  return { ok: true, state: replayActions(genesis, history) }
}

/** Submits one REDO_ACTION against `state` — the mirror of applyUndoAction above. */
export function applyRedoAction(genesis: GameState, state: GameState, playerId: string | null): ActionResult {
  if (!resolveHistory(state.actionHistory).canRedo) {
    return { ok: false, error: 'Nothing left to redo.' }
  }
  const history = [...state.actionHistory, { action: { type: 'REDO_ACTION' as const, playerId }, turn: state.turn, timestamp: new Date().toISOString(), ...adminModeStamp(state) }]
  return { ok: true, state: replayActions(genesis, history) }
}
