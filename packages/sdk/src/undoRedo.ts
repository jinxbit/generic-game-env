import { resolveHistory, undoTarget } from './historyFold.ts'
import { definitionFor } from './registry.ts'
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

/**
 * Whether a bare Undo right now would take back information some player has
 * already seen — only ever true for a game created with
 * `lockRevealedInformationEnabled` on. Such an undo needs the room owner or
 * an admin with room admin mode on (the undo-action Edge Function enforces
 * it; GamePage.tsx disables the button to match); everyone else is refused.
 * Two ways an undo can do that, both judged by the game's own
 * `isActionSecret`, so the framework needs to know nothing about the game:
 *
 * 1. **Hidden information would be re-hidden.** The move being undone
 *    revealed something — some earlier entry that isn't secret from a player
 *    now becomes secret from them again in the state the undo lands on (in
 *    Unique Pick: the last pick of a round, which revealed everyone's picks).
 *    Undoing it would let players choose again knowing what they saw.
 * 2. **Random information would be taken back.** The move being undone drew
 *    random numbers (`LoggedAction.random`) and some player can see it — they
 *    have seen how the dice fell. The server would draw the same numbers again
 *    for a move at the same position (seededSource, ./random.ts), but a
 *    player could still make a different move knowing the outcome.
 *
 * Only players count as viewers: a spectator seeing something re-hidden gives
 * no one at the table an edge they didn't already have.
 */
export function isUndoLockedByReveal(genesis: GameState, state: GameState): boolean {
  if (!state.lockRevealedInformationEnabled) return false
  const target = undoTarget(state.actionHistory)
  if (!target) return false
  const game = definitionFor(state)
  const viewers = state.players.map((p) => p.id)

  if (target.random && target.random.length > 0 && viewers.some((viewer) => !game.isActionSecret(target, state, viewer))) return true

  const undone = applyUndoAction(genesis, state, null)
  if (!undone.ok) return false
  const after = undone.state
  return resolveHistory(after.actionHistory).effective.some((entry) =>
    viewers.some((viewer) => !game.isActionSecret(entry, state, viewer) && game.isActionSecret(entry, after, viewer)),
  )
}
