// ⚑ LESS_CRUEL_LOANS (RULES.md §11).

import { describe, expect, it } from 'vitest'
import { play } from '../../testing'
import { at } from './helpers'

describe('LESS_CRUEL_LOANS', () => {
  it('new loans carry no penalty for existing bonds', () => {
    const s = at('investment', { lessCruelLoans: true }, (g, [fd]) => {
      g.players[fd].bonds = 4
    })
    const fd = s.game.seatOrder[0]
    expect(play(s, { type: 'TAKE_LOAN', playerId: fd }).game.players[fd].cash).toBe(50)
  })

  it('base rules: each existing bond costs $1 of proceeds', () => {
    const s = at('investment', {}, (g, [fd]) => {
      g.players[fd].bonds = 4
    })
    const fd = s.game.seatOrder[0]
    expect(play(s, { type: 'TAKE_LOAN', playerId: fd }).game.players[fd].cash).toBe(46)
  })
})
