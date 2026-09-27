// Replays a whole game's logged action history against the stack, submitting
// each entry the way production submits that kind of entry: a game action,
// CONCEDE or SET_ADMIN_MODE to apply-action, an UNDO_ACTION/REDO_ACTION
// marker to undo-action/redo-action (those move a pointer, they aren't a step
// forward — see UndoAction's doc comment in packages/sdk/src/actions.ts), each as
// the signed-in user who holds the seat that made it.
//
// Shared by ../__tests__/productionGames.test.ts, which points it at the
// checked-in game exports, by ../__tests__/supabaseStack.test.ts, which points
// it at a game it just played, and by ../productionSmoke/ and ../previewSeed/,
// which point it at a live project.

import type { GameState } from '@game-platform/sdk'
import type { ProductionGameFixture } from '../fixtures/productionGames/loadFixtures.ts'
import { normalizeStateForComparison } from '../fixtures/productionGames/loadFixtures.ts'
import type { EnforcedCallResult, ProductionStack } from './index.ts'

/**
 * The whole surface a replay needs, so the same routine can drive the
 * in-process stack (./index.ts) and a real deployed Supabase project
 * (../productionSmoke/liveProject.ts) without either knowing about the
 * other. ProductionStack satisfies it; a live project satisfies only the
 * enforced trio, since replaying a client-trusted game against production
 * would mean writing `game_state` from a script, which is exactly the thing
 * the enforced path exists to stop.
 */
export interface ReplayTarget {
  applyAction: ProductionStack['applyAction']
  undoAction: ProductionStack['undoAction']
  redoAction: ProductionStack['redoAction']
  applyActionClientTrusted?: ProductionStack['applyActionClientTrusted']
  undoActionClientTrusted?: ProductionStack['undoActionClientTrusted']
  redoActionClientTrusted?: ProductionStack['redoActionClientTrusted']
}

export type LoggedEntry = GameState['actionHistory'][number]

export function submitLoggedEntry(stack: ReplayTarget, fixture: ProductionGameFixture, entry: LoggedEntry): Promise<EnforcedCallResult> {
  // UNDO_ACTION/REDO_ACTION/SET_ADMIN_MODE carry a nullable, narration-only
  // playerId (see their doc comments in packages/sdk/src/actions.ts) — a null one
  // means nobody in particular was "acting", so the room owner stands in,
  // which is also the only caller SET_ADMIN_MODE would have accepted.
  const playerId = entry.action.playerId
  const userId = playerId === null ? fixture.game.created_by : fixture.userIdForPlayer(playerId)
  const gameId = fixture.game.id

  // Which of the app's two write paths this game actually ran on — the same
  // branch GamePage.tsx's submitAction/handleUndo/handleRedo take. Replaying a
  // client-trusted game through the Edge Functions would be testing it against
  // rules it was never played under; replaying an enforced one directly would
  // skip the only thing worth testing about it.
  if (!fixture.game.settings.ruleEnforcementEnabled) {
    if (!stack.applyActionClientTrusted || !stack.undoActionClientTrusted || !stack.redoActionClientTrusted) {
      throw new Error(
        `[${fixture.name}] was played client-trusted, and this replay target only supports the rule-enforced write path. ` +
          `Replay it against the in-process stack, or give the fixture a sidecar leaving enforcement on.`,
      )
    }
    if (entry.action.type === 'UNDO_ACTION') return stack.undoActionClientTrusted(userId, gameId, playerId, fixture.genesis)
    if (entry.action.type === 'REDO_ACTION') return stack.redoActionClientTrusted(userId, gameId, playerId, fixture.genesis)
    return stack.applyActionClientTrusted(userId, gameId, entry.action)
  }

  if (entry.action.type === 'UNDO_ACTION') return stack.undoAction(userId, gameId)
  if (entry.action.type === 'REDO_ACTION') return stack.redoAction(userId, gameId)
  return stack.applyAction(userId, gameId, entry.action)
}

export interface ReplayOutcome {
  /** The `game_state.version` the row is on once the whole history has been submitted — one per entry. */
  version: number
  /**
   * Wall-clock time of each `submitLoggedEntry` call, in submission order.
   * Consumed by ../productionSmoke/runSmoke.ts to catch a round-trip
   * regression as a clear failure rather than as the whole run eventually
   * hitting its timeout.
   */
  actionDurationsMs: number[]
}

/**
 * Submits every entry in order, failing with the action's position and the
 * server's own message the moment one is rejected — which is the useful half
 * of a failure here: "action 14/40, PICK_NUMBER by seat-2, 400: ..."
 * localizes a rules or enforcement regression to one move of one real game.
 *
 * Needs nothing back from each write but its status and version, so it works
 * the same whether or not the target's responses are redacted for the acting
 * seat (a hidden-information game) or come back as protocol-2 deltas.
 */
export async function replayFixtureThroughStack(stack: ReplayTarget, fixture: ProductionGameFixture): Promise<ReplayOutcome> {
  const history = fixture.finalState.actionHistory
  const actionDurationsMs: number[] = []
  let version = 0

  for (const [index, entry] of history.entries()) {
    const startedAt = Date.now()
    const result = await submitLoggedEntry(stack, fixture, entry)
    actionDurationsMs.push(Date.now() - startedAt)
    if (!result.ok) {
      throw new Error(
        `[${fixture.name}] action ${index + 1}/${history.length} (${entry.action.type} by ${entry.action.playerId}) was rejected with ${result.status}: ${result.error}`,
      )
    }
    version += 1
    if (result.version !== version) {
      throw new Error(`[${fixture.name}] action ${index + 1}/${history.length} left game_state at version ${result.version}, expected ${version}.`)
    }
  }
  return { version, actionDurationsMs }
}

/**
 * Two states compared as *games*, not as bytes — normalizeStateForComparison's
 * timestamp and absent-optional handling, plus one thing only a replay through
 * the server hits.
 *
 * An UNDO_ACTION/REDO_ACTION entry's `playerId` is narration only: the server
 * stamps it from whoever called, and in a hotseat game several seats share one
 * auth user, so a replay can legitimately attribute a marker to a different
 * seat than the original did (see UndoAction's doc comment). Everything else,
 * including every other entry and its order, has to match exactly.
 */
export function normalizeForComparison(state: GameState): GameState {
  return normalizeStateForComparison({
    ...state,
    actionHistory: state.actionHistory.map((entry) =>
      entry.action.type === 'UNDO_ACTION' || entry.action.type === 'REDO_ACTION'
        ? { ...entry, action: { ...entry.action, playerId: '(caller)' } }
        : entry,
    ),
  })
}
