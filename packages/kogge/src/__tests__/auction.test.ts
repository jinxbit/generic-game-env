import { describe, expect, it } from 'vitest'
import { bidStrength, canBid, compareBids } from '../bids'
import { arrange, goods, newGame, play, startAll } from '../testing'
import { attempt, expectConserved } from './helpers'

describe('bid strength (R-AUC-03)', () => {
  it('a: a set beats any non-set — two 0s beat 7+8', () => {
    expect(compareBids([0, 0], [7, 8])).toBeGreaterThan(0)
  })
  it('b: a larger set beats a smaller one — three 2s beat two 6s; equal sets by number', () => {
    expect(compareBids([2, 2, 2], [6, 6])).toBeGreaterThan(0)
    expect(compareBids([6, 6], [5, 5])).toBeGreaterThan(0)
  })
  it('c: non-sets by sum; [AMBIG-2] a single marker is not a set', () => {
    expect(compareBids([7, 8], [3, 4])).toBeGreaterThan(0)
    expect(compareBids([8], [3, 4])).toBeGreaterThan(0)
    expect(compareBids([8], [0, 0])).toBeLessThan(0)
    expect(compareBids([1, 4], [5])).toBe(0)
    expect(bidStrength([4])).toEqual([0, 4, 0])
  })
  it('R-AUC-05: a hand can bid unless every sub-bid is taken', () => {
    const hand = [1, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(canBid(hand, [])).toBe(true)
    expect(canBid(hand, [[0]])).toBe(false)
    expect(canBid(Array(9).fill(0), [])).toBe(false)
    expect(canBid([1, 1, 0, 0, 0, 0, 0, 0, 0], [[0], [1]])).toBe(true)
    expect(canBid([1, 1, 0, 0, 0, 0, 0, 0, 0], [[0], [1], [0, 1]])).toBe(false)
  })
})

describe('the auction (R-AUC)', () => {
  const started = () => startAll(newGame({ players: 3 }), [0, 4, 7])

  it('R-AUC-02/06: once around in turn order; the strongest bid starts', () => {
    let s = started()
    expect(s.game.order).toEqual(['p1', 'p2', 'p3'])
    s = play(s, { type: 'BID', playerId: 'p1', markers: [8] })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'BID', playerId: 'p2', markers: [1, 6] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [3, 4] })
    expect(s.game.lastAuction?.order).toEqual(['p1', 'p2', 'p3'])
    expect(s.phase).toBe('guildmaster')
    expect(s.pendingPlayerIds).toEqual(['p1'])
  })

  it('R-AUC-03d: equal bids rank the earlier bidder higher', () => {
    let s = started()
    s = play(s, { type: 'BID', playerId: 'p1', markers: [5] })
    s = play(s, { type: 'BID', playerId: 'p2', markers: [1, 4] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [6] })
    expect(s.game.order).toEqual(['p3', 'p1', 'p2'])
  })

  it('R-AUC-04: an exact duplicate is refused', () => {
    let s = started()
    s = play(s, { type: 'BID', playerId: 'p1', markers: [3, 5] })
    expect(attempt(s, { type: 'BID', playerId: 'p2', markers: [5, 3] })).toMatchObject({ ok: false })
    expect(attempt(s, { type: 'BID', playerId: 'p2', markers: [] })).toMatchObject({ ok: false })
    expect(attempt(s, { type: 'BID', playerId: 'p2', markers: [5, 5] })).toMatchObject({ ok: false })
    expect(attempt(s, { type: 'BID', playerId: 'p3', markers: [1] })).toMatchObject({ ok: false })
  })

  it('R-AUC-05: a player with no markers is skipped and ranks last', () => {
    let s = newGame({ players: 3 })
    s = play(s, { type: 'START_PICK', playerId: 'p1', attempt: 1, value: 0 })
    s = arrange(s, (g) => {
      g.reserve = g.reserve.map((n, v) => n + g.players.p1.markers[v])
      g.players.p1.markers = Array(9).fill(0)
    })
    s = play(s, { type: 'START_PICK', playerId: 'p2', attempt: 1, value: 4 })
    s = play(s, { type: 'START_PICK', playerId: 'p3', attempt: 1, value: 7 })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'BID', playerId: 'p2', markers: [0] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [1] })
    expect(s.game.order).toEqual(['p3', 'p2', 'p1'])
    expect(s.game.lastAuction?.bids[0]).toEqual({ playerId: 'p1', markers: null })
  })

  it('R-AUC-07/08: two goods per bid marker, to the houses first if there are enough', () => {
    let s = started()
    const before = s.game
    // Houses: p1 in 0, p2 in 4, p3 in 7.
    s = play(s, { type: 'BID', playerId: 'p1', markers: [4] })
    s = play(s, { type: 'BID', playerId: 'p2', markers: [7] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [2] })
    const g = s.game
    expect(g.cities[4].houses[0].goods).toEqual(goods({ orange: 1 }))
    expect(g.cities[4].goods.orange).toBe(before.cities[4].goods.orange + 1)
    expect(g.cities[7].houses[0].goods).toEqual(goods({ white: 1 }))
    expect(g.cities[2].goods.grey).toBe(before.cities[2].goods.grey + 2)
    // Bid markers went back to the reserve.
    expect(g.reserve[4]).toBe(before.reserve[4] + 1)
    expectConserved(s)
  })

  it('R-AUC-07: a short supply shorts the lowest-numbered city; R-AUC-08 then gives the houses nothing', () => {
    let s = started()
    s = arrange(s, (g) => {
      // Only 3 white goods left: Kopenhagen (8) takes 2, Lübeck (7, two houses) gets 1 — too few for its houses.
      const spare = g.supply.white - 3
      g.supply.white = 3
      g.players.p1.goods.white += spare
      g.cities[7].houses.push({ owner: 'p1', goods: goods() })
    })
    s = play(s, { type: 'BID', playerId: 'p1', markers: [8] })
    s = play(s, { type: 'BID', playerId: 'p2', markers: [7] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [0] })
    expect(s.game.supply.white).toBe(0)
    expect(s.game.cities[7].houses[0].goods.white).toBe(0)
    expect(s.game.cities[7].goods.white).toBe(4)
    expect(s.game.cities[8].goods.white).toBe(5)
    expectConserved(s)
  })

  it('R-AUC-01: leftover lots go back and four new ones are drawn each round', () => {
    const s = started()
    expect(s.game.market).toHaveLength(4)
    expectConserved(s)
  })
})
