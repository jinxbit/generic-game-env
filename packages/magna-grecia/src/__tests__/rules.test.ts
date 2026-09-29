// Rules tests, one describe per RULES.md section. Scenarios are built on a
// known start (helpers.ts `fresh`) and pin the rulebook's worked examples
// where it has them (C, D, E, H, J, M–O).

import { describe, expect, it } from 'vitest'
import { applyAction, type GameState as PlatformState } from '@game-platform/sdk'
import {
  analyse,
  CARDS,
  COLS,
  connectionCount,
  gameDefinition,
  isMarketActive,
  legalCityCells,
  marketValue,
  normalizeGameOptions,
  planCity,
  scoreOf,
  VILLAGES,
  withinAllowance,
  type GameState,
} from '../rules'
import { newGame, play } from '../testing'
import type { GameAction } from '../types'
import { at, fresh, putCity, putRoad } from './helpers'

function reject(state: GameState, action: GameAction): string {
  const result = applyAction(state as PlatformState, action)
  if (result.ok) throw new Error(`${action.type} was accepted`)
  return result.error
}

const road = (playerId: string, cell: number, ends: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3]): GameAction => ({ type: 'PLACE_ROAD', playerId, cell, ends })
const city = (playerId: string, cell: number): GameAction => ({ type: 'PLACE_CITY', playerId, cell })
const endTurn = (playerId: string): GameAction => ({ type: 'END_TURN', playerId })

/** Ends every turn until the game is over. */
function passToEnd(state: GameState): GameState {
  let s = state
  for (let i = 0; i < 100 && s.status === 'active'; i++) s = play(s, endTurn(s.game.turnPlayerId!), i)
  return s
}

describe('§2 board and cards', () => {
  it('has 23 villages, 10 of them green-bordered on the edge, none touching another (R-BOARD-02)', () => {
    expect(VILLAGES).toHaveLength(23)
    const green = VILLAGES.filter((v) => v.green)
    expect(green).toHaveLength(10)
    for (const v of green) {
      const row = Math.floor(v.cell / COLS)
      const col = v.cell % COLS
      expect(row === 0 || row === 12 || col === 0 || col === 12).toBe(true)
    }
    for (const a of VILLAGES) {
      for (const b of VILLAGES) {
        if (a === b) continue
        const far = Math.max(Math.abs(Math.floor(a.cell / COLS) - Math.floor(b.cell / COLS)), Math.abs((a.cell % COLS) - (b.cell % COLS)))
        expect(far).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('has three cards per border colour, each ordering all four colours from its border (R-CARD-03)', () => {
    expect(CARDS).toHaveLength(12)
    for (const border of [0, 1, 2, 3]) expect(CARDS.filter((c) => c.border === border)).toHaveLength(3)
    for (const card of CARDS) {
      expect(card.order[0]).toBe(card.border)
      expect([...card.order].sort()).toEqual([0, 1, 2, 3])
    }
  })
})

describe('§3 setup', () => {
  it('gives 4 players 15 points, 4 + 16 tiles of each kind, 20 markets and 9 oracles on inland villages', () => {
    const s = newGame({ players: 4 })
    for (const id of s.game.seatOrder) {
      expect(s.game.players[id]).toMatchObject({ points: 15, supply: { roads: 4, cities: 4 }, staging: { roads: 16, cities: 16 }, markets: 20 })
    }
    expect(s.game.oracles).toHaveLength(9)
    const inland = new Set(VILLAGES.filter((v) => !v.green).map((v) => v.cell))
    for (const o of s.game.oracles) {
      expect(inland.has(o.cell)).toBe(true)
      expect(o.attention).toBeNull()
    }
    expect(new Set(s.game.oracles.map((o) => o.cell)).size).toBe(9)
  })

  it('uses 12 points and 7 oracles with 3 players, 10 points with 2 (R-SETUP-02/03)', () => {
    const three = newGame({ players: 3 })
    expect(three.game.players.p1.points).toBe(12)
    expect(three.game.oracles).toHaveLength(7)
    const two = newGame({ players: 2 })
    expect(two.game.players.p1.points).toBe(10)
    expect(two.game.oracles).toHaveLength(7)
  })

  it('starts round 1 with the first card, in its colour order, skipping colours nobody plays (R-ROUND-02)', () => {
    for (const players of [2, 3, 4]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const s = newGame({ players, seed })
        const card = CARDS[s.game.card]
        expect(s.turn).toBe(1)
        expect(s.game.round).toBe(1)
        expect(s.game.usedCards).toEqual([s.game.card])
        expect(s.game.roundOrder).toEqual(card.order.filter((slot) => slot < players).map((slot) => `p${slot + 1}`))
        expect(s.pendingPlayerIds).toEqual([s.game.roundOrder[0]])
        expect(s.activePlayerId).toBe(s.game.roundOrder[0])
      }
    }
  })

  it('deals every block of four rounds one card of each border colour (R-SETUP-05)', () => {
    for (const seed of [1, 2, 3]) {
      const end = passToEnd(newGame({ seed }))
      const used = end.game.usedCards
      expect(new Set(used).size).toBe(12)
      for (const block of [0, 4, 8]) expect(new Set(used.slice(block, block + 4).map((id) => CARDS[id].border)).size).toBe(4)
    }
  })

  it('normalizes options to 12 or 8 rounds', () => {
    expect(normalizeGameOptions(undefined)).toEqual({ rounds: 12 })
    expect(normalizeGameOptions({ rounds: 8 })).toEqual({ rounds: 8 })
    expect(normalizeGameOptions({ rounds: 9 })).toEqual({ rounds: 12 })
    expect(gameDefinition.describeOptions({ rounds: 8 })).toMatch(/8 rounds/)
  })
})

describe('§6 basic actions', () => {
  // Card 0: roads 3, cities 2, resupply 5 — enhanced 4, 3, 7.
  const card = CARDS[0]

  it('allows two actions at card value, or one enhanced (R-ACT-04, example A)', () => {
    expect(withinAllowance(card, 3, 2, 0)).toBe(true)
    expect(withinAllowance(card, 3, 0, 5)).toBe(true)
    expect(withinAllowance(card, 0, 2, 5)).toBe(true)
    expect(withinAllowance(card, 4, 0, 0)).toBe(true)
    expect(withinAllowance(card, 0, 3, 0)).toBe(true)
    expect(withinAllowance(card, 0, 0, 7)).toBe(true)
    expect(withinAllowance(card, 5, 0, 0)).toBe(false)
    expect(withinAllowance(card, 4, 1, 0)).toBe(false)
    expect(withinAllowance(card, 0, 3, 1)).toBe(false)
    expect(withinAllowance(card, 1, 1, 1)).toBe(false)
  })

  it('lets a lone road action place 4 tiles but not 5, and then no city tile', () => {
    let s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      g.players.p1.supply.roads = 6
    })
    s = play(s, road('p1', at(0, 8), [1, 3]))
    s = play(s, road('p1', at(0, 9), [1, 3]))
    s = play(s, road('p1', at(0, 10), [2, 3]))
    s = play(s, road('p1', at(1, 10), [0, 3]))
    expect(reject(s, road('p1', at(1, 9), [1, 2]))).toMatch(/no more road tiles/)
    expect(reject(s, city('p1', at(0, 6)))).toMatch(/No city tiles left/)
  })

  it('makes resupply last and caps it by the card and the staging area (R-ACT-02/05)', () => {
    let s = fresh((g) => putCity(g, 'p1', at(0, 7)))
    s = play(s, road('p1', at(0, 8), [1, 3]))
    expect(reject(s, { type: 'RESUPPLY', playerId: 'p1', roads: 3, cities: 3 })).toMatch(/at most 5/)
    s = play(s, { type: 'RESUPPLY', playerId: 'p1', roads: 1, cities: 4 })
    expect(s.game.players.p1).toMatchObject({ supply: { roads: 4, cities: 8 }, staging: { roads: 15, cities: 12 } })
    expect(reject(s, road('p1', at(0, 9), [1, 3]))).toMatch(/resupply comes last/)
    expect(reject(s, { type: 'RESUPPLY', playerId: 'p1', roads: 0, cities: 1 })).toMatch(/already resupplied/)
    const lone = fresh((g) => (g.players.p1.staging = { roads: 2, cities: 16 }))
    expect(reject(lone, { type: 'RESUPPLY', playerId: 'p1', roads: 3, cities: 0 })).toMatch(/Only 2 road tiles/)
    expect(play(lone, { type: 'RESUPPLY', playerId: 'p1', roads: 2, cities: 5 }).game.players.p1.supply).toEqual({ roads: 6, cities: 9 })
  })

  it('refuses moves out of turn', () => {
    const s = fresh()
    expect(reject(s, endTurn('p2'))).toMatch(/isn't your turn/)
    expect(reject(s, city('p2', at(0, 7)))).toMatch(/isn't your turn/)
  })
})

describe('§7 roads', () => {
  it('needs an end pointing at a city, a reached village or oracle, or one of your own road ends (R-ROAD-03)', () => {
    const s = fresh((g) => putCity(g, 'p1', at(0, 7)))
    expect(reject(s, road('p1', at(6, 1), [1, 3]))).toMatch(/must lead from/)
    // Beside the city but not pointing at it.
    expect(reject(s, road('p1', at(1, 7), [1, 3]))).toMatch(/must lead from/)
    const next = play(s, road('p1', at(1, 7), [0, 2]))
    expect(next.game.roads[at(1, 7)]).toEqual({ owner: 'p1', ends: [0, 2] })
    expect(play(next, road('p1', at(2, 7), [0, 1])).game.roads[at(2, 7)]).not.toBeNull()
  })

  it('may lead from an opponent’s city (R-ROAD-03)', () => {
    const s = fresh((g) => putCity(g, 'p2', at(0, 7)))
    expect(play(s, road('p1', at(0, 8), [1, 3])).game.roads[at(0, 8)]?.owner).toBe('p1')
  })

  it('may lead from a village only once your own road reaches it (R-ROAD-03, example F)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      putRoad(g, 'p2', at(0, 8), [1, 3])
      putRoad(g, 'p2', at(0, 9), [1, 3])
      putRoad(g, 'p2', at(0, 10), [1, 3])
    })
    expect(reject(s, road('p1', at(1, 11), [0, 2]))).toMatch(/must lead from/)
    const p2 = fresh((g) => {
      Object.assign(g, { cityTiles: s.game.cityTiles, roads: s.game.roads, cities: s.game.cities })
      g.turnPlayerId = 'p2'
    })
    expect(play(p2, road('p2', at(1, 11), [0, 2])).game.roads[at(1, 11)]?.owner).toBe('p2')
  })

  it('never points off the board or lengthens an opponent’s road, but may cut one off (R-ROAD-01/04, example G)', () => {
    const s = fresh((g) => {
      putCity(g, 'p2', at(0, 7))
      putRoad(g, 'p2', at(0, 8), [1, 3])
      putRoad(g, 'p1', at(1, 9), [0, 2])
      putCity(g, 'p1', at(4, 9))
      putRoad(g, 'p1', at(2, 9), [0, 2])
      putRoad(g, 'p1', at(3, 9), [0, 2])
    })
    expect(reject(s, road('p1', at(0, 6), [0, 1]))).toMatch(/off the board/)
    expect(reject(s, road('p1', at(0, 9), [2, 3]))).toMatch(/another player's road/)
    const cut = play(s, road('p1', at(0, 9), [1, 2]))
    expect(cut.game.roads[at(0, 9)]).toEqual({ owner: 'p1', ends: [1, 2] })
  })

  it('connects the places at a road’s two ends, each place once however many roads (R-ROAD-02)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      for (const col of [8, 9, 10]) putRoad(g, 'p1', at(0, col), [1, 3])
      // A second road between the same two places.
      putRoad(g, 'p1', at(1, 7), [0, 1])
      for (const col of [8, 9, 10]) putRoad(g, 'p2', at(1, col), [1, 3])
      putRoad(g, 'p2', at(1, 11), [0, 3])
      // A dead end.
      putRoad(g, 'p3', at(1, 6), [1, 3])
    })
    const a = analyse(s.game)
    expect(connectionCount(a, `c${at(0, 7)}`)).toBe(1)
    expect(connectionCount(a, `v${at(0, 11)}`)).toBe(1)
    expect([...a.links.get(`c${at(0, 7)}`)!]).toEqual([`v${at(0, 11)}`])
  })
})

describe('§7 cities', () => {
  it('founds a city on a green village for 1 point, with a free market, one founding per turn (R-CITY-01/06/07/08)', () => {
    let s = fresh()
    s = play(s, city('p1', at(0, 7)))
    expect(s.game.cities).toEqual([{ id: at(0, 7), owner: 'p1' }])
    expect(s.game.markets).toEqual([{ owner: 'p1', cell: at(0, 7), sold: false }])
    expect(s.game.players.p1).toMatchObject({ points: 14, markets: 19, supply: { cities: 3 } })
    expect(reject(s, city('p1', at(0, 2)))).toMatch(/one city may be founded/)
    expect(play(s, city('p1', at(0, 6))).game.cityTiles[at(0, 6)]).toBe('p1')
  })

  it('founds on an inland village only where your road reaches (R-CITY-01, example B)', () => {
    expect(reject(fresh(), city('p1', at(3, 7)))).toMatch(/green-bordered village or one your roads reach/)
    const reached = fresh((g) => putRoad(g, 'p1', at(3, 8), [1, 3]))
    expect(play(reached, city('p1', at(3, 7))).game.cities).toEqual([{ id: at(3, 7), owner: 'p1' }])
    const theirs = fresh((g) => putRoad(g, 'p2', at(3, 8), [1, 3]))
    expect(reject(theirs, city('p1', at(3, 7)))).toMatch(/one your roads reach/)
  })

  it('never goes next to another player’s city or an oracle, nor joins two of your cities (R-CITY-03/05, example C)', () => {
    const s = fresh((g) => {
      putCity(g, 'p2', at(0, 7), [at(0, 8)])
      putCity(g, 'p1', at(0, 11), [at(0, 10)])
      g.oracles = [{ cell: at(3, 7), attention: null }]
    })
    expect(reject(s, city('p1', at(0, 9)))).toMatch(/another player's city/)
    const oracle = fresh((g) => {
      putCity(g, 'p1', at(0, 7), [at(1, 7)])
      g.oracles = [{ cell: at(3, 7), attention: null }]
    })
    expect(reject(oracle, city('p1', at(2, 7)))).toMatch(/next to an oracle/)
    const two = fresh((g) => {
      putCity(g, 'p1', at(0, 7), [at(0, 8), at(0, 9)])
      putCity(g, 'p1', at(0, 11))
    })
    expect(reject(two, city('p1', at(0, 10)))).toMatch(/join two of your cities/)
    expect(reject(fresh(), city('p1', at(6, 1)))).toMatch(/must be founded on a village/)
  })

  it('bridges onto a village with two tiles to expand a city (R-CITY-04, example D)', () => {
    const s = fresh((g) => putCity(g, 'p1', at(0, 7), [at(1, 7)]))
    const plan = planCity(s.game, analyse(s.game), 'p1', at(2, 7))
    expect(plan).toMatchObject({ ok: true, tiles: [at(2, 7), at(3, 7)], founds: false, city: at(0, 7) })
    const next = play(s, city('p1', at(2, 7)))
    expect(next.game.cityTiles[at(2, 7)]).toBe('p1')
    expect(next.game.cityTiles[at(3, 7)]).toBe('p1')
    expect(next.game.cities).toHaveLength(1)
    expect(next.game.players.p1.points).toBe(13)
    expect(next.game.progress.cities).toBe(2)
    expect(analyse(next.game).tilesOf.get(at(0, 7))).toHaveLength(4)
  })

  it('bridges onto a reached village to found a city (R-CITY-04, example E)', () => {
    const s = fresh((g) => putRoad(g, 'p1', at(3, 8), [1, 3]))
    const next = play(s, city('p1', at(2, 7)))
    expect(next.game.cities).toEqual([{ id: at(3, 7), owner: 'p1' }])
    expect(next.game.markets).toEqual([{ owner: 'p1', cell: at(3, 7), sold: false }])
    expect(next.game.progress).toMatchObject({ cities: 2, founded: true })
  })

  it('refuses a bridge without two tiles left, in supply, or two points', () => {
    const base = (edit: (g: GameState['game']) => void) =>
      fresh((g) => {
        putCity(g, 'p1', at(0, 7), [at(1, 7)])
        edit(g)
      })
    expect(reject(base((g) => (g.progress = { roads: 1, cities: 1, founded: false, resupplied: null })), city('p1', at(2, 7)))).toMatch(/needs two city tiles this turn/)
    expect(reject(base((g) => (g.players.p1.supply.cities = 1)), city('p1', at(2, 7)))).toMatch(/two city tiles in your supply/)
    expect(reject(base((g) => (g.players.p1.points = 1)), city('p1', at(2, 7)))).toMatch(/costs 2 points/)
    expect(reject(base((g) => (g.players.p1.points = 0)), city('p1', at(0, 6)))).toMatch(/costs 1 point/)
  })

  it('keeps other players’ markets when founding over a village, and adds none if the founder has one (R-CITY-08)', () => {
    const s = fresh((g) => {
      g.markets = [
        { owner: 'p2', cell: at(0, 7), sold: false },
        { owner: 'p1', cell: at(0, 7), sold: true },
      ]
    })
    const next = play(s, city('p1', at(0, 7)))
    expect(next.game.markets).toEqual(s.game.markets)
    expect(next.game.players.p1.markets).toBe(20)
  })

  it('takes a duplicate market off an absorbed village (R-CITY-09, AMBIG-8)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7), [at(1, 7)])
      g.markets = [
        { owner: 'p1', cell: at(0, 7), sold: false },
        { owner: 'p1', cell: at(3, 7), sold: false },
        { owner: 'p2', cell: at(3, 7), sold: false },
      ]
      g.players.p1.markets = 18
    })
    const next = play(s, city('p1', at(2, 7)))
    expect(next.game.markets).toEqual([
      { owner: 'p1', cell: at(0, 7), sold: false },
      { owner: 'p2', cell: at(3, 7), sold: false },
    ])
    expect(next.game.players.p1.markets).toBe(19)
    expect(next.game.events).toContainEqual({ kind: 'marketRemoved', owner: 'p1', cell: at(3, 7), sold: false })
  })

  it('offers the green villages as first cities — directly, or by bridging from a neighbouring space', () => {
    const g = fresh().game
    const cells = legalCityCells(g)
    const green = VILLAGES.filter((v) => v.green).map((v) => v.cell)
    expect(cells).toEqual(expect.arrayContaining(green))
    for (const cell of cells) {
      const plan = planCity(g, analyse(g), 'p1', cell)
      expect(plan).toMatchObject({ ok: true, founds: true })
      if (plan.ok) expect(green).toContain(plan.city)
    }
  })
})

describe('§8 markets', () => {
  it('costs 1 per city tile plus 1 per opponent market, and ends the turn (R-MKT-02, example H)', () => {
    const s = fresh((g) => {
      putCity(g, 'p2', at(0, 7), [at(0, 6), at(0, 8)])
      g.markets = [{ owner: 'p2', cell: at(0, 7), sold: false }]
    })
    const next = play(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at(0, 8) })
    expect(next.game.players.p1).toMatchObject({ points: 11, markets: 19 })
    expect(next.game.markets).toContainEqual({ owner: 'p1', cell: at(0, 7), sold: false })
    expect(next.game.turnPlayerId).toBe('p2')
  })

  it('costs 1 plus opponents’ markets in a village, and ignores sold markets (R-MKT-02, example J)', () => {
    const village = fresh((g) => (g.markets = [{ owner: 'p2', cell: at(2, 4), sold: false }]))
    expect(play(village, { type: 'BUILD_MARKET', playerId: 'p1', cell: at(2, 4) }).game.players.p1.points).toBe(13)
    const j = fresh((g) => {
      putCity(g, 'p4', at(0, 7), [at(0, 8)])
      g.markets = [
        { owner: 'p4', cell: at(0, 7), sold: false },
        { owner: 'p1', cell: at(0, 7), sold: true },
        { owner: 'p2', cell: at(0, 7), sold: true },
      ]
      g.turnPlayerId = 'p3'
    })
    expect(play(j, { type: 'BUILD_MARKET', playerId: 'p3', cell: at(0, 7) }).game.players.p3.points).toBe(12)
  })

  it('allows one market per place, never in your own city, and never on credit (R-MKT-01/02)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      g.markets = [
        { owner: 'p1', cell: at(0, 7), sold: false },
        { owner: 'p1', cell: at(2, 4), sold: true },
      ]
    })
    expect(reject(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at(0, 7) })).toMatch(/other players’ cities/)
    expect(reject(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at(2, 4) })).toMatch(/already have a market/)
    expect(reject(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at(6, 1) })).toMatch(/villages and cities/)
    const broke = fresh((g) => (g.players.p1.points = 0))
    expect(reject(broke, { type: 'BUILD_MARKET', playerId: 'p1', cell: at(2, 4) })).toMatch(/costs 1 points; you have 0/)
  })

  it('is active in its owner’s city, or connected by any road to one of their cities, and worth the connections (R-MKT-03/04, example I)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      putCity(g, 'p2', at(0, 11))
      for (const col of [8, 9, 10]) putRoad(g, 'p3', at(0, col), [1, 3])
      putCity(g, 'p3', at(3, 0))
      g.markets = [
        { owner: 'p1', cell: at(0, 11), sold: false },
        { owner: 'p3', cell: at(0, 11), sold: false },
        { owner: 'p3', cell: at(3, 0), sold: false },
        { owner: 'p4', cell: at(2, 4), sold: false },
      ]
    })
    const a = analyse(s.game)
    const [p1InP2, p3InP2, p3Own, p4Village] = s.game.markets
    expect(isMarketActive(s.game, a, p1InP2)).toBe(true)
    expect(marketValue(s.game, a, p1InP2)).toBe(1)
    // The road is p3's, but it doesn't reach a p3 city.
    expect(isMarketActive(s.game, a, p3InP2)).toBe(false)
    expect(isMarketActive(s.game, a, p3Own)).toBe(true)
    expect(marketValue(s.game, a, p3Own)).toBe(0)
    expect(isMarketActive(s.game, a, p4Village)).toBe(false)
  })

  it('sells an active market for its value instead of building, and it counts no more (R-MKT-05/06)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      for (const col of [8, 9, 10]) putRoad(g, 'p1', at(0, col), [1, 3])
      g.markets = [
        { owner: 'p1', cell: at(0, 7), sold: false },
        { owner: 'p1', cell: at(2, 4), sold: false },
      ]
    })
    expect(reject(s, { type: 'SELL_MARKET', playerId: 'p1', cell: at(2, 4) })).toMatch(/worth at least 1/)
    expect(reject(s, { type: 'SELL_MARKET', playerId: 'p1', cell: at(0, 11) })).toMatch(/don't have a market/)
    const sold = play(s, { type: 'SELL_MARKET', playerId: 'p1', cell: at(0, 7) })
    expect(sold.game.players.p1.points).toBe(16)
    expect(sold.game.markets[0].sold).toBe(true)
    expect(sold.game.turnPlayerId).toBe('p2')
    expect(scoreOf(sold.game, 'p1').markets).toBe(0)
  })
})

describe('§9 oracles', () => {
  // Oracle at D4 (row 3, col 7). Alice's city C1 reaches it down column 7;
  // Bob's city on the village at row 6, col 8 reaches it round the side.
  const oracle = at(3, 7)
  function contest() {
    return fresh((g) => {
      g.oracles = [{ cell: oracle, attention: null }]
      putCity(g, 'p1', at(0, 7))
      putRoad(g, 'p1', at(1, 7), [0, 2])
      putCity(g, 'p2', at(6, 8))
      putRoad(g, 'p2', at(5, 8), [0, 2])
      putRoad(g, 'p2', at(4, 8), [2, 3])
    })
  }

  it('attends to the first city that connects (R-ORACLE-02, examples K/L)', () => {
    const s = play(contest(), road('p1', at(2, 7), [0, 2]))
    expect(s.game.oracles).toEqual([{ cell: oracle, attention: at(0, 7) }])
    expect(s.game.events).toContainEqual({ kind: 'oracle', oracle, from: null, to: at(0, 7), owner: 'p1' })
  })

  it('keeps its attention on a tie and switches only to a strictly more important city (R-ORACLE-03, examples M–O)', () => {
    let s = play(contest(), road('p1', at(2, 7), [0, 2]))
    s = play(s, endTurn('p1'))
    expect(s.game.turnPlayerId).toBe('p2')
    s = play(s, road('p2', at(4, 7), [0, 1]))
    // Both cities now have one connection (the oracle): a tie keeps Alice.
    expect(s.game.oracles[0].attention).toBe(at(0, 7))
    s = play(s, road('p2', at(6, 7), [1, 2]))
    s = play(s, road('p2', at(7, 7), [0, 3]))
    // Bob's city reaches the village at row 7, col 6 too: 2 > 1.
    expect(s.game.oracles[0].attention).toBe(at(6, 8))
    expect(s.game.events).toContainEqual({ kind: 'oracle', oracle, from: at(0, 7), to: at(6, 8), owner: 'p2' })
    expect(scoreOf(s.game, 'p2').oracles).toBe(4)
    expect(scoreOf(s.game, 'p1').oracles).toBe(0)
  })
})

describe('§10 game end and scoring', () => {
  it('ends after the last round; equal scores share the win (R-END-01/02)', () => {
    const end = passToEnd(newGame())
    expect(end.status).toBe('completed')
    expect(end.game.round).toBe(12)
    expect(end.pendingPlayerIds).toEqual([])
    expect(end.game.finalScores?.p1).toEqual({ points: 15, markets: 0, oracles: 0, total: 15 })
    expect(end.winnerPlayerIds).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('plays 8 rounds in the short game', () => {
    const end = passToEnd(newGame({ options: { rounds: 8 } }))
    expect(end.game.round).toBe(8)
    expect(end.game.usedCards).toHaveLength(8)
  })

  it('adds track points, active market values and 4 per oracle', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at(0, 7))
      for (const col of [8, 9, 10]) putRoad(g, 'p1', at(0, col), [1, 3])
      g.markets = [
        { owner: 'p1', cell: at(0, 7), sold: false },
        { owner: 'p1', cell: at(0, 11), sold: false },
      ]
      g.oracles = [{ cell: at(3, 7), attention: at(0, 7) }]
    })
    expect(scoreOf(s.game, 'p1')).toEqual({ points: 15, markets: 2, oracles: 4, total: 21 })
  })
})

describe('turn flow', () => {
  it('passes the turn automatically when the player has nothing they could do', () => {
    const s = fresh((g) => {
      g.players.p2 = { ...g.players.p2, points: 0, supply: { roads: 0, cities: 0 }, staging: { roads: 0, cities: 0 } }
    })
    const next = play(s, endTurn('p1'))
    expect(next.game.turnPlayerId).toBe('p3')
    expect(next.actionHistory).toHaveLength(1)
  })

  it('skips a player who concedes, even mid-turn (R-LEAVE-01)', () => {
    const s = fresh((g) => putCity(g, 'p1', at(0, 7)))
    const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: 'p1' })
    if (!result.ok) throw new Error(result.error)
    const next = result.state as GameState
    expect(next.game.turnPlayerId).toBe('p2')
    expect(next.game.cityTiles[at(0, 7)]).toBe('p1')
    const later = passToEnd(next)
    expect(later.winnerPlayerIds).not.toContain('p1')
  })

  it('narrates moves, the round change and the final scores', () => {
    let s = fresh()
    s = play(s, city('p1', at(0, 7)))
    const founded = gameDefinition.describeAction(city('p1', at(0, 7)), fresh(), s)
    expect(founded.message).toBe('{player} founded a city at H1.')
    expect(founded.extraLines).toContainEqual({ playerId: 'p1', message: '{player} placed a free market in the new city at H1.' })
    const bridged = fresh((g) => putRoad(g, 'p1', at(3, 8), [1, 3]))
    expect(gameDefinition.describeAction(city('p1', at(2, 7)), bridged, play(bridged, city('p1', at(2, 7)))).message).toBe('{player} founded a city at H3 and H4.')
    const lastTurn = fresh((g) => (g.turnPlayerId = 'p4'))
    const round2 = play(lastTurn, endTurn('p4'))
    expect(gameDefinition.describeAction(endTurn('p4'), lastTurn, round2).extraLines?.[0].message).toMatch(/^Round 2 of 12: the card gives roads \d, cities \d, resupply \d\. Turn order: /)
  })
})
