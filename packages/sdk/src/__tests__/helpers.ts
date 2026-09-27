// The framework's tests play the example game as their fixture — see
// @game-platform/unique-pick/testing. Not a test file itself.

import type { GameState as UniquePickState, PickNumberAction } from '@game-platform/unique-pick/rules'
import type { GameState as PlatformGameState } from '../types'

export { act, newGame, pick, pickAll, withoutTimestamps } from '@game-platform/unique-pick/testing'
/** The registered Unique Pick definition — the same object the registry hands the engine, so `vi.spyOn` on it intercepts real dispatch. */
export { gameDefinition as game } from '@game-platform/unique-pick/rules'
export type { GameState, PickNumberAction } from '@game-platform/unique-pick/rules'

/** Narrows a framework-typed state (e.g. applyAction's result) back to Unique Pick's, for tests that read `.game`. */
export function asGame(state: PlatformGameState): UniquePickState {
  return state as UniquePickState
}

/** A PICK_NUMBER action, typed so it can be passed where the framework's `Action` is expected. */
export function pickAction(playerId: string, value: number): PickNumberAction {
  return { type: 'PICK_NUMBER', playerId, value }
}

/** The Unique Pick game slice of any framework-typed state or redacted view. */
export function gameData(state: { game: unknown }): UniquePickState['game'] {
  return state.game as UniquePickState['game']
}
