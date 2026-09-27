import type { Action, LoggedAction } from './actions.ts'
import { isFrameworkAction } from './actions.ts'
import { definitionFor } from './registry.ts'
import { noRandomness, randomFrom, RandomnessUnavailableError, recordingSource, replayingSource, type Random, type Uint32Source } from './random.ts'
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
 * action is handed to the rules of the game the state belongs to
 * (GameDefinition.applyAction, found by `state.gameType`/`rulesVersion` in
 * ./registry.ts).
 *
 * Every accepted action is appended to the returned state's `actionHistory`
 * (event sourcing). Any forced single-option follow-up the action leaves
 * behind (GameDefinition.nextForcedAction) is dispatched too, converging to
 * a fixed point, and folded into the SAME log entry — nobody "did" it, so it
 * gets no entry of its own. Replaying the one entry reproduces the whole
 * cascade, since forced follow-ups are a deterministic function of state.
 *
 * `options.random` is where a first application's random numbers come from
 * (./random.ts); whatever the game draws is recorded on the new entry. With
 * no source, an action whose rules draw is rejected — the enforced path's
 * client never has one, only the server does.
 */
export function applyAction(state: GameState, action: Action, options: ApplyActionOptions = {}): ActionResult {
  const result = applyActionWithSteps(state, action, options)
  if (!result.ok) return result
  return { ok: true, state: result.state }
}

export interface ApplyActionOptions {
  /** Fresh random numbers for this action, if its rules draw any. */
  random?: Uint32Source
}

/**
 * Re-applies one entry already in a log, feeding the game the random numbers
 * recorded on it rather than rolling new ones — what every replay uses. The
 * replay must draw exactly the recorded numbers: fewer or more means the
 * rules took a different path than they did originally.
 */
export function applyLoggedAction(state: GameState, entry: LoggedAction): ReturnType<typeof applyActionWithSteps> {
  const replaying = replayingSource(entry.random ?? [])
  const result = applyActionWithSteps(state, entry.action, { random: replaying.source })
  if (result.ok && !replaying.exhausted()) {
    return { ok: false, error: 'Replay drew fewer random numbers than were recorded for this move.' }
  }
  return result
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
export function applyActionWithSteps(
  state: GameState,
  action: Action,
  options: ApplyActionOptions = {},
): { ok: true; state: GameState; steps: ActionStep[] } | { ok: false; error: string } {
  const recording = recordingSource(options.random ?? noRandomness)
  const random = randomFrom(recording.source)
  try {
    return dispatchWithFollowUps(state, action, random, recording.drawn)
  } catch (error) {
    if (error instanceof RandomnessUnavailableError) return { ok: false, error: error.message }
    throw error
  }
}

function dispatchWithFollowUps(state: GameState, action: Action, random: Random, drawn: number[]): { ok: true; state: GameState; steps: ActionStep[] } | { ok: false; error: string } {
  const primary = dispatchAction(state, action, random)
  if (!primary.ok) return primary
  const steps: ActionStep[] = [{ action, before: state, after: primary.state }]

  for (let i = 0; ; i++) {
    const before = steps[steps.length - 1].after
    if (before.status !== 'active') break
    const game = definitionFor(before)
    const forced = game.nextForcedAction(before)
    if (!forced) break
    if (i >= MAX_FORCED_STEPS) return { ok: false, error: 'Forced follow-up actions did not converge.' }
    const result = game.applyAction(before, forced, random)
    if (!result.ok) break // defensive only — a forced action is legal by construction
    steps.push({ action: forced, before, after: result.state })
  }

  // `state.turn` (before dispatch), not the converged state's — an action
  // that finishes a round is logged against the round it resolved, not the
  // one it advanced into.
  const finalState = steps[steps.length - 1].after
  const viaAdminMode = Boolean(state.adminModeActive) && action.type !== 'SET_ADMIN_MODE'
  const loggedAction: LoggedAction = {
    action,
    turn: state.turn,
    timestamp: new Date().toISOString(),
    ...(viaAdminMode ? { viaAdminMode: true as const } : {}),
    ...(drawn.length > 0 ? { random: [...drawn] } : {}),
  }
  return { ok: true, state: { ...finalState, actionHistory: [...finalState.actionHistory, loggedAction] }, steps }
}

function dispatchAction(state: GameState, action: Action, random: Random): ActionResult {
  if (isFrameworkAction(action)) {
    switch (action.type) {
      case 'SET_ADMIN_MODE':
        return applySetAdminMode(state, action.enabled)
      case 'CONCEDE':
        return applyConcede(state, action.playerId, random)
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
  return definitionFor(state).applyAction(state, action, random)
}

/**
 * Flags the player eliminated, drops them from turn order and whoever is
 * pending, ends the game outright if only one player is left, and otherwise
 * lets the game advance whatever their pending move was blocking.
 */
function applyConcede(state: GameState, playerId: string, random: Random): ActionResult {
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
  return { ok: true, state: definitionFor(next).onPlayerEliminated(next, playerId, random) }
}

/** See SetAdminModeAction (./actions.ts). Allowed in any status; rejects a redundant flip. */
function applySetAdminMode(state: GameState, enabled: boolean): ActionResult {
  if (Boolean(state.adminModeActive) === enabled) {
    return { ok: false, error: enabled ? 'Admin mode is already on.' : 'Admin mode is already off.' }
  }
  return { ok: true, state: { ...state, adminModeActive: enabled } }
}
