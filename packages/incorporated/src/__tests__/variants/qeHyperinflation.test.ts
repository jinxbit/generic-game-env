// ⚑ QE_HYPERINFLATION (RULES.md §11, [AMBIG-18]).

import { describe, expect, it } from 'vitest'
import { play } from '../../testing'
import { at } from './helpers'

describe('QE_HYPERINFLATION', () => {
  it('pushing Interest past $20 costs every player $1 per bond', () => {
    const s = at('lobbying', { qeHyperinflation: true }, (g, [fd, gs]) => {
      g.sliders.interest = 1
      g.players[fd].bonds = 3
      g.players[gs].bonds = 1
    })
    const [fd, gs, bb] = s.game.seatOrder
    const after = play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'centralBanks', slider: 'interest', direction: -1 } })
    expect(after.game.players[fd].cash).toBe(27)
    expect(after.game.players[gs].cash).toBe(29)
    expect(after.game.players[bb].cash).toBe(30)
  })

  it('pushing past $11 pays every player $1 per bond', () => {
    const s = at('lobbying', { qeHyperinflation: true }, (g, [fd]) => {
      g.sliders.interest = 9
      g.players[fd].bonds = 2
    })
    const fd = s.game.seatOrder[0]
    expect(play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'centralBanks', slider: 'interest', direction: 1 } }).game.players[fd].cash).toBe(32)
  })

  it('does nothing without the flag', () => {
    const s = at('lobbying', {}, (g, [fd]) => {
      g.sliders.interest = 0
      g.players[fd].bonds = 3
    })
    const fd = s.game.seatOrder[0]
    expect(play(s, { type: 'LOBBY', playerId: fd, event: { kind: 'centralBanks', slider: 'interest', direction: -1 } }).game.players[fd].cash).toBe(30)
  })
})
