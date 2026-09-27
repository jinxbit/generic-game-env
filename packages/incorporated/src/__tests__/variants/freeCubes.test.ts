// ⚑ FREE_CUBES (RULES.md §11).

import { describe, expect, it } from 'vitest'
import { play } from '../../testing'
import type { GameAction, GameState } from '../../types'
import { at } from './helpers'

const options = { threeRounds: true, freeCubes: true }
const run = (s: GameState, actions: GameAction[]) => actions.reduce((x, a) => play(x, a), s)

describe('FREE_CUBES', () => {
  it('buying in round 1 gives no free cubes', () => {
    let s = at('investment', options)
    const [fd, gs, bb, om] = s.game.seatOrder
    s = run(s, [
      { type: 'START_AUCTION', playerId: fd, country: 'RUSSIA', bid: 3 },
      { type: 'PASS_BID', playerId: gs },
      { type: 'PASS_BID', playerId: bb },
      { type: 'PASS_BID', playerId: om },
      { type: 'CHOOSE_SQUARE', playerId: fd, square: 0 },
    ])
    expect(s.game.countries.RUSSIA.loose).toEqual({})
    expect(s.game.prompt).toEqual({ kind: 'investTurn', playerId: gs })
  })

  it('buying in round 2 gives 1 free loose cube and one attack in that country', () => {
    let s = at('investment', options, (g, [, gs]) => {
      g.round = 2
      g.countries.RUSSIA.squares[0].occupant = gs
      g.countries.RUSSIA.squares[1].occupant = gs
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    s = run(s, [
      { type: 'START_AUCTION', playerId: fd, country: 'RUSSIA', bid: 3 },
      { type: 'PASS_BID', playerId: gs },
      { type: 'PASS_BID', playerId: bb },
      { type: 'PASS_BID', playerId: om },
      { type: 'CHOOSE_SQUARE', playerId: fd, square: 1 },
    ])
    expect(s.game.countries.RUSSIA.loose[fd]).toBe(1)
    expect(s.game.prompt).toEqual({ kind: 'freeAttack', playerId: fd, country: 'RUSSIA' })
    expect(() => play(s, { type: 'FREE_ATTACK', playerId: fd, attacks: [{ kind: 'grab', country: 'US', square: 3 }] })).toThrow('must be in Russia')
    s = play(s, { type: 'FREE_ATTACK', playerId: fd, attacks: [{ kind: 'kill', country: 'RUSSIA', target: { kind: 'square', square: 0 } }] })
    expect(s.game.countries.RUSSIA.squares[0].occupant).toBeNull()
  })

  it('selling in round 2 costs a cube; a seller without one may not sell', () => {
    const s = at('investment', options, (g) => {
      g.round = 2
    })
    const fd = s.game.seatOrder[0]
    // FD's only US cube can pay the cost.
    const sold = play(s, { type: 'START_PRIVATE_SALE', playerId: fd, country: 'US', minPrice: 1 })
    expect(sold.game.prompt?.kind).toBe('auction')
    const bare = at('investment', options, (g, [id]) => {
      g.round = 2
      g.countries.US.squares[0].occupant = null
      g.players[id].supply += 1
    })
    expect(() => play(bare, { type: 'START_PRIVATE_SALE', playerId: fd, country: 'US', minPrice: 1 })).toThrow("don't have them")
  })

  it('in a reverse auction the seller loses cubes before the buyer gets free cubes', () => {
    let s = at('investment', options, (g, [, gs]) => {
      g.round = 2
      g.players[gs].shares.US = 1
      g.countries.US.squares[1].occupant = gs
      g.countries.TAX_HAVENS.loose = { [gs]: 1 }
    })
    const [fd, gs, bb, om] = s.game.seatOrder
    s = run(s, [
      { type: 'START_AUCTION', playerId: fd, country: 'US', bid: 10 },
      { type: 'PASS_BID', playerId: gs },
      { type: 'PASS_BID', playerId: bb },
      { type: 'PASS_BID', playerId: om },
      { type: 'CHOOSE_SQUARE', playerId: fd, square: 3 },
      { type: 'BID', playerId: gs, amount: 9 },
    ])
    // Sale cost: 1 of GS's cubes in the US or Tax Havens — GS picks.
    expect(s.game.prompt).toMatchObject({ kind: 'removeCubes', playerId: gs, reason: 'saleCost', count: 1 })
    s = play(s, { type: 'REMOVE_CUBES', playerId: gs, cubes: [{ country: 'TAX_HAVENS', loose: true }] })
    // Then the base removal of one US cube (only one left: automatic), then the buyer's free cube.
    expect(s.game.countries.US.squares[1].occupant).toBeNull()
    expect(s.game.countries.TAX_HAVENS.loose).toEqual({})
    expect(s.game.prompt).toEqual({ kind: 'freeAttack', playerId: fd, country: 'US' })
    expect(s.game.countries.US.loose[fd]).toBe(1)
  })
})
