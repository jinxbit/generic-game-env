import { expect } from 'vitest'
import { applyAction } from '@game-platform/sdk'
import { CITY_COUNT, COLORS, GOODS_COUNTS, MARKER_COUNTS } from '../data'
import type { GameState } from '../engine'
import { testRandom } from '../testing'
import type { GameAction, GameData } from '../types'

/** R-BRD-02: every good and route marker is somewhere, exactly once. */
export function expectConserved(state: GameState): void {
  const g: GameData = state.game
  for (const c of COLORS) {
    let n = g.supply[c]
    for (const city of g.cities) {
      n += city.goods[c]
      for (const house of city.houses) n += house.goods[c]
    }
    for (const p of Object.values(g.players)) n += p.goods[c]
    expect(n, `${c} goods`).toBe(GOODS_COUNTS[c])
    expect(g.supply[c]).toBeGreaterThanOrEqual(0)
  }
  for (let v = 0; v < CITY_COUNT; v++) {
    let n = g.reserve[v]
    for (const city of g.cities) for (const slot of city.routes) if (slot.value === v) n++
    for (const p of Object.values(g.players)) n += p.markers[v]
    for (const lot of g.market) n += lot.filter((m) => m === v).length
    for (const bid of g.bids) n += (bid.markers ?? []).filter((m) => m === v).length
    expect(n, `markers ${v}`).toBe(MARKER_COUNTS[v])
  }
  for (const city of g.cities) expect(city.houses.length).toBeLessThanOrEqual(2)
}

/** Applies an action with test randomness and returns the result (rejections included). */
export function attempt(state: GameState, action: GameAction) {
  return applyAction(state, action, { random: testRandom() })
}
