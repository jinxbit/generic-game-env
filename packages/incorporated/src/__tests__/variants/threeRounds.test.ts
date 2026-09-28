// ⚑ THREE_ROUNDS (RULES.md §11).

import { describe, expect, it } from 'vitest'
import { DESIGNERS_RECOMMENDED, normalizeGameOptions } from '../../rules'
import { autoplay, newGame } from '../../testing'

describe('THREE_ROUNDS', () => {
  it('deals 3 Outlook cards and ends after turn 3', () => {
    const s = autoplay(newGame({ options: { threeRounds: true } }))
    expect(s.game.totalRounds).toBe(3)
    expect(s.game.outlookPlayed).toHaveLength(3)
    expect(s.status).toBe('completed')
  })

  it("is on in the Designer's Recommended preset, with FREE_CUBES", () => {
    expect(DESIGNERS_RECOMMENDED).toMatchObject({ threeRounds: true, freeCubes: true })
    expect(normalizeGameOptions(DESIGNERS_RECOMMENDED)).toEqual(DESIGNERS_RECOMMENDED)
  })

  it('is off by default, and FREE_CUBES needs it ([AMBIG-16])', () => {
    expect(normalizeGameOptions(undefined).threeRounds).toBe(false)
    expect(normalizeGameOptions({ freeCubes: true }).freeCubes).toBe(false)
  })
})
