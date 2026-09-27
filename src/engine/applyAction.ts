import type { Action, LoggedAction } from './actions.ts'
import { isFrameworkAction } from './actions.ts'
import { game } from './game.ts'
import type { ActionResult, GameState } from './types.ts'

export type { ActionResult } from './types.ts'

/**
 * Applies a single validated action to a game state, returning a new state.
 * Never mutates the input. This is the ONLY place game rules are allowed to
 * run — UI and network layers must treat GameState as opaque and always
 * route changes through here so every client (live/async/hotseat) and the
 * server enforce identical rules.
 *
 * Framework actions (concede, admin mode) are handled here; every other
 * action is handed to the game's own rules (GameDefinition.applyAction,
 * src/game/rules.ts).
 *
 * Every accepted action is appended to the returned state's `actionHistory`
 * (event sourcing). Any forced single-option follow-up the action leaves
 * behind (GameDefinition.nextForcedAction) is dispatched too, converging to
 * a fixed point, and folded into the SAME log entry — nobody "did" it, so it
 * gets no entry of its own. Replaying the one entry reproduces the whole
 * cascade, since forced follow-ups are a deterministic function of state.
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  const result = applyActionWithSteps(state, action)
  if (!result.ok) return result
  return { ok: true, state: result.state }
}

/** One dispatched step behind a single applyAction() call — either `action` itself or one of the forced follow-ups it converged to. */
export interface ActionStep {
  action: Action
  before: GameState
  after: GameState
}

/** Upper bound on forced follow-ups per dispatch — a game whose nextForcedAction never converges is a bug, and this turns it into an error instead of a hang. */
const MAX_FORCED_STEPS = 1000

/**
 * Same as applyAction above, but also returns the step-by-step breakdown —
 * `action` itself plus every forced follow-up folded into its log entry, each
 * with its own before/after pair — so gameLog.ts can narrate each step.
 */
export function applyActionWithSteps(state: GameState, action: Action): { ok: true; state: GameState; steps: ActionStep[] } | { ok: false; error: string } {
  const primary = dispatchAction(state, action)
  if (!primary.ok) return primary
  const steps: ActionStep[] = [{ action, before: state, after: primary.state }]

  for (let i = 0; ; i++) {
    const before = steps[steps.length - 1].after
    if (before.status !== 'active') break
    const forced = game.nextForcedAction(before)
    if (!forced) break
    if (i >= MAX_FORCED_STEPS) return { ok: false, error: 'Forced follow-up actions did not converge.' }
    const result = game.applyAction(before, forced)
    if (!result.ok) break // defensive only — a forced action is legal by construction
    steps.push({ action: forced, before, after: result.state })
  }

  // `state.turn` (before dispatch), not the converged state's — an action
  // that finishes a round is logged against the round it resolved, not the
  // one it advanced into.
  const finalState = steps[steps.length - 1].after
  const viaAdminMode = Boolean(state.adminModeActive) && action.type !== 'SET_ADMIN_MODE'
  const loggedAction: LoggedAction = { action, turn: state.turn, timestamp: new Date().toISOString(), ...(viaAdminMode ? { viaAdminMode: true as const } : {}) }
  return { ok: true, state: { ...finalState, actionHistory: [...finalState.actionHistory, loggedAction] }, steps }
}

function dispatchAction(state: GameState, action: Action): ActionResult {
  if (isFrameworkAction(action)) {
    switch (action.type) {
      case 'SET_ADMIN_MODE':
        return applySetAdminMode(state, action.enabled)
      case 'CONCEDE':
        return applyConcede(state, action.playerId)
      case 'UNDO_ACTION':
      case 'REDO_ACTION':
        // Undo/redo aren't a forward step from `state` — they're a
        // shorter/longer replay from genesis. Live callers submit them via
        // applyUndoAction/applyRedoAction (./undoRedo.ts), which append the
        // entry and re-derive state through replayActions().
        return { ok: false, error: `${action.type} must be submitted via applyUndoAction/applyRedoAction, not applyAction` }
      default: {
        const exhaustive: never = action
        return { ok: false, error: `Unknown action: ${JSON.stringify(exhaustive)}` }
      }
    }
  }
  if (state.status !== 'active') {
    return { ok: false, error: `Game is not active (status: ${state.status})` }
  }
  return game.applyAction(state, action)
}

/**
 * Flags the player eliminated, drops them from turn order and whoever is
 * pending, ends the game outright if only one player is left, and otherwise
 * lets the game advance whatever their pending move was blocking.
 */
function applyConcede(state: GameState, playerId: string): ActionResult {
  if (state.status !== 'active') return { ok: false, error: `Game is not active (status: ${state.status})` }
  const player = state.players.find((p) => p.id === playerId)
  if (!player) return { ok: false, error: `Unknown player: ${playerId}` }
  if (player.eliminated) return { ok: false, error: 'Player is already eliminated' }

  const next: GameState = {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? { ...p, eliminated: true, conceded: true } : p)),
    turnOrder: state.turnOrder.filter((id) => id !== playerId),
    pendingPlayerIds: state.pendingPlayerIds.filter((id) => id !== playerId),
    activePlayerId: state.activePlayerId === playerId ? null : state.activePlayerId,
  }
  const remaining = next.players.filter((p) => !p.eliminated)
  if (remaining.length <= 1) {
    return {
      ok: true,
      state: { ...next, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds: remaining.map((p) => p.id) },
    }
  }
  return { ok: true, state: game.onPlayerEliminated(next, playerId) }
}

/** See SetAdminModeAction (./actions.ts). Allowed in any status; rejects a redundant flip. */
function applySetAdminMode(state: GameState, enabled: boolean): ActionResult {
  if (Boolean(state.adminModeActive) === enabled) {
    return { ok: false, error: enabled ? 'Admin mode is already on.' : 'Admin mode is already off.' }
  }
  return { ok: true, state: { ...state, adminModeActive: enabled } }
}
