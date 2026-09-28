// Reaches into the engine for values the tests check but the rules don't export.

import { randomFrom } from '@game-platform/sdk'
import type { Ctx } from '../context'
import { repaymentCost } from '../earnings'
import { testRandom } from '../testing'
import type { GameState } from '../types'

export function repaymentCostFor(state: GameState, playerId: string): number {
  const ctx: Ctx = { state, options: state.options, random: randomFrom(testRandom()), g: state.game }
  return repaymentCost(ctx, playerId)
}
