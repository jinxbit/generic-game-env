// ⚑ R3_SALES_MODE (RULES.md §11).

import { describe, expect, it } from 'vitest'
import { play } from '../../testing'
import { at } from './helpers'

describe('R3_SALES_MODE', () => {
  it('banned: no private sale and no reverse auction in the final round', () => {
    let s = at('investment', { threeRounds: true, r3SalesMode: 'banned' }, (g, [, gs]) => {
      g.round = 3
      g.players[gs].shares.US = 1
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    expect(() => play(s, { type: 'START_PRIVATE_SALE', playerId: fd, country: 'US', minPrice: 1 })).toThrow('not allowed')
    for (const a of [
      { type: 'START_AUCTION', playerId: fd, country: 'US', bid: 5 },
      { type: 'PASS_BID', playerId: gs },
      { type: 'PASS_BID', playerId: bb },
      { type: 'PASS_BID', playerId: om },
      { type: 'CHOOSE_SQUARE', playerId: fd, square: 3 },
    ] as const)
      s = play(s, a)
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: gs })
  })

  it('reverseOnly: no private sale, and Investment ends once the bank is sold out', () => {
    let s = at('investment', { threeRounds: true, r3SalesMode: 'reverseOnly' }, (g) => {
      g.round = 3
      for (const c of Object.keys(g.bank)) g.bank[c] = 0
      g.bank.BRAZIL = 1
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    expect(() => play(s, { type: 'START_PRIVATE_SALE', playerId: fd, country: 'US', minPrice: 1 })).toThrow('not allowed')
    for (const a of [
      { type: 'START_AUCTION', playerId: fd, country: 'BRAZIL', bid: 3 },
      { type: 'PASS_BID', playerId: gs },
      { type: 'PASS_BID', playerId: bb },
      { type: 'PASS_BID', playerId: om },
      { type: 'CHOOSE_SQUARE', playerId: fd, square: 0 },
    ] as const)
      s = play(s, a)
    expect(s.game.phase).toBe('competition')
  })

  it('normal before the final round', () => {
    const s = at('investment', { threeRounds: true, r3SalesMode: 'banned' })
    expect(play(s, { type: 'START_PRIVATE_SALE', playerId: s.game.seatOrder[0], country: 'US', minPrice: 1 }).game.prompt?.kind).toBe('auction')
  })
})
