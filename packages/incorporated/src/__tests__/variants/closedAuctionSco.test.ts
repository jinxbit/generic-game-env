// ⚑ CLOSED_AUCTION_SCO (RULES.md §11). Sealed-bid secrecy is covered in c10-hidden-info.test.ts.

import { describe, expect, it } from 'vitest'
import { play } from '../../testing'
import type { GameState } from '../../types'
import { at } from './helpers'

function sealed(s: GameState, bids: Record<string, number>): GameState {
  const prompt = s.game.prompt
  if (prompt?.kind !== 'sealedAuction') throw new Error('expected a sealed auction')
  return Object.entries(bids).reduce((x, [playerId, amount]) => play(x, { type: 'SEALED_BID', playerId, auctionId: prompt.auctionId, amount }), s)
}

describe('CLOSED_AUCTION_SCO', () => {
  it('an SCO country is sold by sealed bid; a tie goes to the initiator’s pick', () => {
    let s = at('investment', { closedAuctionSco: true })
    const [fd, gs, bb, om] = s.game.seatOrder
    s = play(s, { type: 'START_AUCTION', playerId: fd, country: 'RUSSIA' })
    s = sealed(s, { [fd]: 3, [gs]: 8, [bb]: 8, [om]: 0 })
    expect(s.game.prompt).toEqual({ kind: 'sealedTie', playerId: fd, country: 'RUSSIA', tied: [gs, bb], amount: 8 })
    s = play(s, { type: 'PICK_WINNER', playerId: fd, winnerId: bb })
    expect(s.game.players[bb].shares.RUSSIA).toBe(1)
    expect(s.game.players[bb].cash).toBe(22)
  })

  it('only the initiator may sell back, at the buying price', () => {
    let s = at('investment', { closedAuctionSco: true }, (g, [fd]) => {
      g.players[fd].shares.CHINA = 1
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    s = play(s, { type: 'START_AUCTION', playerId: fd, country: 'CHINA' })
    s = sealed(s, { [fd]: 0, [gs]: 6, [bb]: 0, [om]: 0 })
    s = play(s, { type: 'CHOOSE_SQUARE', playerId: gs, square: 0 })
    expect(s.game.prompt).toEqual({ kind: 'closedSell', playerId: fd, country: 'CHINA', price: 6 })
    s = play(s, { type: 'CLOSED_SELL', playerId: fd, sell: true })
    expect(s.game.players[fd].cash).toBe(36)
    expect(s.game.players[fd].shares.CHINA).toBe(0)
  })

  it('a NATO country keeps the open auction, and the initiator gets $1 for buying', () => {
    let s = at('investment', { closedAuctionSco: true })
    const [fd, gs, bb, om] = s.game.seatOrder
    for (const a of [
      { type: 'START_AUCTION', playerId: fd, country: 'JAPAN', bid: 4 },
      { type: 'PASS_BID', playerId: gs },
      { type: 'PASS_BID', playerId: bb },
      { type: 'PASS_BID', playerId: om },
    ] as const)
      s = play(s, a)
    expect(s.game.players[fd].cash).toBe(27)
  })
})
