// Rules tests, one describe per RULES.md section. Scenarios are built on a
// known start (helpers.ts `fresh`) on the real board — cells are named by the
// board's own labels ("A5") — and pin the rulebook's worked examples where it
// has them (C, D, E, H, J, M–O).
//
// Hex sides: 0 east, 1 south-east, 2 south-west, 3 west, 4 north-west,
// 5 north-east. The top-left corner used by most scenarios: the green village
// A5 touches A7 (east) and B6 (south-east); the inland village D6 is two
// hexes below B6, touched by C5 and C7.

import { describe, expect, it } from 'vitest'
import { applyAction, type GameState as PlatformState } from '@game-platform/sdk'
import {
  analyse,
  CARDS,
  connectionCount,
  gameDefinition,
  hexDistance,
  isMarketActive,
  legalCityCells,
  marketValue,
  neighbours,
  normalizeEnds,
  normalizeGameOptions,
  planCity,
  ROAD_SHAPES,
  scoreOf,
  VILLAGES,
  withinAllowance,
  type GameState,
} from '../rules'
import { newGame, play } from '../testing'
import type { Dir, GameAction } from '../types'
import { at, fresh, putCity, putRoad } from './helpers'

function reject(state: GameState, action: GameAction): string {
  const result = applyAction(state as PlatformState, action)
  if (result.ok) throw new Error(`${action.type} was accepted`)
  return result.error
}

const road = (playerId: string, cell: string, ends: [Dir, Dir]): GameAction => ({ type: 'PLACE_ROAD', playerId, cell: at(cell), ends })
const city = (playerId: string, cell: string): GameAction => ({ type: 'PLACE_CITY', playerId, cell: at(cell) })
const endTurn = (playerId: string): GameAction => ({ type: 'END_TURN', playerId })

/** Road tiles running east along row A from A7 to A15, ending at the village A17. */
const ROW_A = ['A7', 'A9', 'A11', 'A13', 'A15']

/** Ends every turn until the game is over. */
function passToEnd(state: GameState): GameState {
  let s = state
  for (let i = 0; i < 100 && s.status === 'active'; i++) s = play(s, endTurn(s.game.turnPlayerId!), i)
  return s
}

describe('§2 board and cards', () => {
  it('has the board’s 42 villages — 10 green-bordered on the edge, 32 inland — none touching another (R-BOARD-02)', () => {
    expect(VILLAGES).toHaveLength(42)
    const green = VILLAGES.filter((v) => v.green)
    expect(green).toHaveLength(10)
    for (const v of green) expect(neighbours(v.cell).length).toBeLessThan(6)
    for (const a of VILLAGES) for (const b of VILLAGES) if (a !== b) expect(hexDistance(a.cell, b.cell)).toBeGreaterThanOrEqual(2)
  })

  it('knows the board’s shape: row A has two runs, B6 sits south-east of A5, and nothing lies off the edge', () => {
    expect(neighbours(at('A5')).sort((a, b) => a - b)).toEqual([at('A7'), at('B6')])
    expect(neighbours(at('K1'))).toHaveLength(3)
    expect(neighbours(at('H16'))).toHaveLength(6)
    expect(() => at('A19')).toThrow()
  })

  it('offers three straight and six curved road tiles, never a sharp turn (R-ROAD-01, AMBIG-12)', () => {
    expect(ROAD_SHAPES).toHaveLength(9)
    expect(normalizeEnds([3, 0])).toEqual([0, 3])
    expect(normalizeEnds([4, 0])).toEqual([0, 4])
    expect(normalizeEnds([0, 1])).toBeNull()
    expect(normalizeEnds([5, 0])).toBeNull()
    expect(normalizeEnds([6, 0])).toBeNull()
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
      putCity(g, 'p1', at('A5'))
      g.players.p1.supply.roads = 6
    })
    for (const cell of ROW_A.slice(0, 4)) s = play(s, road('p1', cell, [0, 3]))
    expect(reject(s, road('p1', 'A15', [0, 3]))).toMatch(/no more road tiles/)
    expect(reject(s, city('p1', 'B6'))).toMatch(/No city tiles left/)
  })

  it('makes resupply last and caps it by the card and the staging area (R-ACT-02/05)', () => {
    let s = fresh((g) => putCity(g, 'p1', at('A5')))
    s = play(s, road('p1', 'A7', [0, 3]))
    expect(reject(s, { type: 'RESUPPLY', playerId: 'p1', roads: 3, cities: 3 })).toMatch(/at most 5/)
    s = play(s, { type: 'RESUPPLY', playerId: 'p1', roads: 1, cities: 4 })
    expect(s.game.players.p1).toMatchObject({ supply: { roads: 4, cities: 8 }, staging: { roads: 15, cities: 12 } })
    expect(reject(s, road('p1', 'A9', [0, 3]))).toMatch(/resupply comes last/)
    expect(reject(s, { type: 'RESUPPLY', playerId: 'p1', roads: 0, cities: 1 })).toMatch(/already resupplied/)
    const lone = fresh((g) => (g.players.p1.staging = { roads: 2, cities: 16 }))
    expect(reject(lone, { type: 'RESUPPLY', playerId: 'p1', roads: 3, cities: 0 })).toMatch(/Only 2 road tiles/)
    expect(play(lone, { type: 'RESUPPLY', playerId: 'p1', roads: 2, cities: 5 }).game.players.p1.supply).toEqual({ roads: 6, cities: 9 })
  })

  it('refuses moves out of turn', () => {
    const s = fresh()
    expect(reject(s, endTurn('p2'))).toMatch(/isn't your turn/)
    expect(reject(s, city('p2', 'A5'))).toMatch(/isn't your turn/)
  })
})

describe('§7 roads', () => {
  it('needs an end pointing at a city, a reached village or oracle, or one of your own road ends (R-ROAD-03)', () => {
    const s = fresh((g) => putCity(g, 'p1', at('A5')))
    expect(reject(s, road('p1', 'H10', [0, 3]))).toMatch(/must lead from/)
    // Beside the city but not pointing at it.
    expect(reject(s, road('p1', 'B6', [0, 2]))).toMatch(/must lead from/)
    expect(reject(s, road('p1', 'B6', [0, 1]))).toMatch(/joins two different sides/)
    const next = play(s, road('p1', 'B6', [2, 4]))
    expect(next.game.roads[at('B6')]).toEqual({ owner: 'p1', ends: [2, 4] })
    expect(play(next, road('p1', 'C5', [5, 1])).game.roads[at('C5')]).toEqual({ owner: 'p1', ends: [1, 5] })
  })

  it('may lead from an opponent’s city (R-ROAD-03)', () => {
    const s = fresh((g) => putCity(g, 'p2', at('A5')))
    expect(play(s, road('p1', 'A7', [0, 3])).game.roads[at('A7')]?.owner).toBe('p1')
  })

  it('may lead from a village only once your own road reaches it (R-ROAD-03, example F)', () => {
    const edit = (g: GameState['game']) => {
      putCity(g, 'p1', at('A5'))
      for (const cell of ROW_A) putRoad(g, 'p2', at(cell), [0, 3])
    }
    expect(reject(fresh(edit), road('p1', 'B16', [2, 5]))).toMatch(/must lead from/)
    const p2 = fresh((g) => {
      edit(g)
      g.turnPlayerId = 'p2'
    })
    expect(play(p2, road('p2', 'B16', [2, 5])).game.roads[at('B16')]?.owner).toBe('p2')
  })

  it('never points off the board or lengthens an opponent’s road, but may cut one off (R-ROAD-01/04, example G)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at('A5'))
      putCity(g, 'p2', at('C21'))
      putRoad(g, 'p2', at('C23'), [0, 3])
      putRoad(g, 'p1', at('D24'), [2, 5])
    })
    expect(reject(s, road('p1', 'A7', [3, 5]))).toMatch(/off the board/)
    expect(reject(s, road('p1', 'C25', [0, 3]))).toMatch(/another player's road/)
    const cut = play(s, road('p1', 'C25', [0, 2]))
    expect(cut.game.roads[at('C25')]).toEqual({ owner: 'p1', ends: [0, 2] })
  })

  it('connects the places at a road’s two ends, each place once however many roads (R-ROAD-02)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at('A5'))
      putCity(g, 'p2', at('B8'))
      // Two roads between the same two cities, and a dead end.
      putRoad(g, 'p1', at('A7'), [1, 3])
      putRoad(g, 'p2', at('B6'), [0, 4])
      putRoad(g, 'p3', at('C5'), [2, 5])
    })
    const a = analyse(s.game)
    expect(connectionCount(a, `c${at('A5')}`)).toBe(1)
    expect([...a.links.get(`c${at('A5')}`)!]).toEqual([`c${at('B8')}`])
    const row = fresh((g) => {
      putCity(g, 'p1', at('A5'))
      for (const cell of ROW_A) putRoad(g, 'p1', at(cell), [0, 3])
    })
    expect([...analyse(row.game).links.get(`v${at('A17')}`)!]).toEqual([`c${at('A5')}`])
  })
})

describe('§7 cities', () => {
  it('founds a city on a green village for 1 point, with a free market, one founding per turn (R-CITY-01/06/07/08)', () => {
    let s = fresh()
    s = play(s, city('p1', 'A5'))
    expect(s.game.cities).toEqual([{ id: at('A5'), owner: 'p1' }])
    expect(s.game.markets).toEqual([{ owner: 'p1', cell: at('A5'), sold: false }])
    expect(s.game.players.p1).toMatchObject({ points: 14, markets: 19, supply: { cities: 3 } })
    expect(reject(s, city('p1', 'A17'))).toMatch(/one city may be founded/)
    expect(play(s, city('p1', 'A7')).game.cityTiles[at('A7')]).toBe('p1')
  })

  it('founds on an inland village only where your road reaches (R-CITY-01, example B)', () => {
    expect(reject(fresh(), city('p1', 'D6'))).toMatch(/green-bordered village or one your roads reach/)
    const reached = fresh((g) => putRoad(g, 'p1', at('D8'), [0, 3]))
    expect(play(reached, city('p1', 'D6')).game.cities).toEqual([{ id: at('D6'), owner: 'p1' }])
    const theirs = fresh((g) => putRoad(g, 'p2', at('D8'), [0, 3]))
    expect(reject(theirs, city('p1', 'D6'))).toMatch(/one your roads reach/)
  })

  it('never goes next to another player’s city or an oracle, nor joins two of your cities (R-CITY-03/05, example C)', () => {
    const s = fresh((g) => {
      putCity(g, 'p2', at('A5'), [at('A7')])
      putCity(g, 'p1', at('B12'), [at('B10')])
    })
    expect(reject(s, city('p1', 'A9'))).toMatch(/another player's city/)
    const oracle = fresh((g) => {
      putCity(g, 'p1', at('A5'), [at('B6')])
      g.oracles = [{ cell: at('D6'), attention: null }]
    })
    expect(reject(oracle, city('p1', 'C7'))).toMatch(/next to an oracle/)
    const two = fresh((g) => {
      putCity(g, 'p1', at('A5'), [at('A7')])
      putCity(g, 'p1', at('B12'), [at('B10')])
    })
    expect(reject(two, city('p1', 'A9'))).toMatch(/join two of your cities/)
    expect(reject(fresh(), city('p1', 'N14'))).toMatch(/must be founded on a village/)
    // H10 lies between the villages G11 and I11: no bridge can make it legal.
    expect(reject(fresh(), city('p1', 'H10'))).toMatch(/next to two villages/)
  })

  it('bridges onto a village with two tiles to expand a city (R-CITY-04, example D)', () => {
    const s = fresh((g) => putCity(g, 'p1', at('A5'), [at('B6')]))
    const plan = planCity(s.game, analyse(s.game), 'p1', at('C7'))
    expect(plan).toMatchObject({ ok: true, tiles: [at('C7'), at('D6')], founds: false, city: at('A5') })
    const next = play(s, city('p1', 'C7'))
    expect(next.game.cityTiles[at('C7')]).toBe('p1')
    expect(next.game.cityTiles[at('D6')]).toBe('p1')
    expect(next.game.cities).toHaveLength(1)
    expect(next.game.players.p1.points).toBe(13)
    expect(next.game.progress.cities).toBe(2)
    expect(analyse(next.game).tilesOf.get(at('A5'))).toHaveLength(4)
  })

  it('bridges onto a reached village to found a city (R-CITY-04, example E)', () => {
    const s = fresh((g) => putRoad(g, 'p1', at('D8'), [0, 3]))
    const next = play(s, city('p1', 'C7'))
    expect(next.game.cities).toEqual([{ id: at('D6'), owner: 'p1' }])
    expect(next.game.markets).toEqual([{ owner: 'p1', cell: at('D6'), sold: false }])
    expect(next.game.progress).toMatchObject({ cities: 2, founded: true })
  })

  it('refuses a bridge without two tiles left, in supply, or two points', () => {
    const base = (edit: (g: GameState['game']) => void) =>
      fresh((g) => {
        putCity(g, 'p1', at('A5'), [at('B6')])
        edit(g)
      })
    expect(reject(base((g) => (g.progress = { roads: 1, cities: 1, founded: false, resupplied: null })), city('p1', 'C7'))).toMatch(/needs two city tiles this turn/)
    expect(reject(base((g) => (g.players.p1.supply.cities = 1)), city('p1', 'C7'))).toMatch(/two city tiles in your supply/)
    expect(reject(base((g) => (g.players.p1.points = 1)), city('p1', 'C7'))).toMatch(/costs 2 points/)
    expect(reject(base((g) => (g.players.p1.points = 0)), city('p1', 'A7'))).toMatch(/costs 1 point/)
  })

  it('keeps other players’ markets when founding over a village, and adds none if the founder has one (R-CITY-08)', () => {
    const s = fresh((g) => {
      g.markets = [
        { owner: 'p2', cell: at('A5'), sold: false },
        { owner: 'p1', cell: at('A5'), sold: true },
      ]
    })
    const next = play(s, city('p1', 'A5'))
    expect(next.game.markets).toEqual(s.game.markets)
    expect(next.game.players.p1.markets).toBe(20)
  })

  it('takes a duplicate market off an absorbed village (R-CITY-09, AMBIG-8)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at('A5'), [at('B6')])
      g.markets = [
        { owner: 'p1', cell: at('A5'), sold: false },
        { owner: 'p1', cell: at('D6'), sold: false },
        { owner: 'p2', cell: at('D6'), sold: false },
      ]
      g.players.p1.markets = 18
    })
    const next = play(s, city('p1', 'C7'))
    expect(next.game.markets).toEqual([
      { owner: 'p1', cell: at('A5'), sold: false },
      { owner: 'p2', cell: at('D6'), sold: false },
    ])
    expect(next.game.players.p1.markets).toBe(19)
    expect(next.game.events).toContainEqual({ kind: 'marketRemoved', owner: 'p1', cell: at('D6'), sold: false })
  })

  it('offers the green villages as first cities — directly, or by bridging from a neighbouring hex', () => {
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
      putCity(g, 'p2', at('A5'), [at('A7'), at('B6')])
      g.markets = [{ owner: 'p2', cell: at('A5'), sold: false }]
    })
    const next = play(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at('A7') })
    expect(next.game.players.p1).toMatchObject({ points: 11, markets: 19 })
    expect(next.game.markets).toContainEqual({ owner: 'p1', cell: at('A5'), sold: false })
    expect(next.game.turnPlayerId).toBe('p2')
  })

  it('costs 1 plus opponents’ markets in a village, and ignores sold markets (R-MKT-02, example J)', () => {
    const village = fresh((g) => (g.markets = [{ owner: 'p2', cell: at('B12'), sold: false }]))
    expect(play(village, { type: 'BUILD_MARKET', playerId: 'p1', cell: at('B12') }).game.players.p1.points).toBe(13)
    const j = fresh((g) => {
      putCity(g, 'p4', at('A5'), [at('A7')])
      g.markets = [
        { owner: 'p4', cell: at('A5'), sold: false },
        { owner: 'p1', cell: at('A5'), sold: true },
        { owner: 'p2', cell: at('A5'), sold: true },
      ]
      g.turnPlayerId = 'p3'
    })
    expect(play(j, { type: 'BUILD_MARKET', playerId: 'p3', cell: at('A5') }).game.players.p3.points).toBe(12)
  })

  it('allows one market per place, never in your own city, and never on credit (R-MKT-01/02)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at('A5'))
      g.markets = [
        { owner: 'p1', cell: at('A5'), sold: false },
        { owner: 'p1', cell: at('B12'), sold: true },
      ]
    })
    expect(reject(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at('A5') })).toMatch(/other players’ cities/)
    expect(reject(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at('B12') })).toMatch(/already have a market/)
    expect(reject(s, { type: 'BUILD_MARKET', playerId: 'p1', cell: at('H10') })).toMatch(/villages and cities/)
    const broke = fresh((g) => (g.players.p1.points = 0))
    expect(reject(broke, { type: 'BUILD_MARKET', playerId: 'p1', cell: at('B12') })).toMatch(/costs 1 points; you have 0/)
  })

  it('is active in its owner’s city, or connected by any road to one of their cities, and worth the connections (R-MKT-03/04, example I)', () => {
    const s = fresh((g) => {
      putCity(g, 'p1', at('A5'))
      putCity(g, 'p2', at('A17'))
      for (const cell of ROW_A) putRoad(g, 'p3', at(cell), [0, 3])
      putCity(g, 'p3', at('G3'))
      g.markets = [
        { owner: 'p1', cell: at('A17'), sold: false },
        { owner: 'p3', cell: at('A17'), sold: false },
        { owner: 'p3', cell: at('G3'), sold: false },
        { owner: 'p4', cell: at('B12'), sold: false },
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
      putCity(g, 'p1', at('A5'))
      for (const cell of ROW_A) putRoad(g, 'p1', at(cell), [0, 3])
      g.markets = [
        { owner: 'p1', cell: at('A5'), sold: false },
        { owner: 'p1', cell: at('B12'), sold: false },
      ]
    })
    expect(reject(s, { type: 'SELL_MARKET', playerId: 'p1', cell: at('B12') })).toMatch(/worth at least 1/)
    expect(reject(s, { type: 'SELL_MARKET', playerId: 'p1', cell: at('A17') })).toMatch(/don't have a market/)
    const sold = play(s, { type: 'SELL_MARKET', playerId: 'p1', cell: at('A5') })
    expect(sold.game.players.p1.points).toBe(16)
    expect(sold.game.markets[0].sold).toBe(true)
    expect(sold.game.turnPlayerId).toBe('p2')
    expect(scoreOf(sold.game, 'p1').markets).toBe(0)
  })
})

describe('§9 oracles', () => {
  // An oracle on D6. Alice's city A5 reaches it through B6 and C5; Bob's
  // city on E9 reaches it through D8, and later the village G11 through F10.
  const oracle = at('D6')
  function contest() {
    return fresh((g) => {
      g.oracles = [{ cell: oracle, attention: null }]
      putCity(g, 'p1', at('A5'))
      putRoad(g, 'p1', at('B6'), [2, 4])
      putCity(g, 'p2', at('E9'))
    })
  }

  it('attends to the first city that connects (R-ORACLE-02, examples K/L)', () => {
    const s = play(contest(), road('p1', 'C5', [1, 5]))
    expect(s.game.oracles).toEqual([{ cell: oracle, attention: at('A5') }])
    expect(s.game.events).toContainEqual({ kind: 'oracle', oracle, from: null, to: at('A5'), owner: 'p1' })
  })

  it('keeps its attention on a tie and switches only to a strictly more important city (R-ORACLE-03, examples M–O)', () => {
    let s = play(contest(), road('p1', 'C5', [1, 5]))
    s = play(s, endTurn('p1'))
    expect(s.game.turnPlayerId).toBe('p2')
    s = play(s, road('p2', 'D8', [1, 3]))
    // Both cities now have one connection (the oracle): a tie keeps Alice.
    expect(s.game.oracles[0].attention).toBe(at('A5'))
    s = play(s, road('p2', 'F10', [1, 4]))
    // Bob's city reaches the village G11 too: 2 > 1.
    expect(s.game.oracles[0].attention).toBe(at('E9'))
    expect(s.game.events).toContainEqual({ kind: 'oracle', oracle, from: at('A5'), to: at('E9'), owner: 'p2' })
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
      putCity(g, 'p1', at('A5'))
      for (const cell of ROW_A) putRoad(g, 'p1', at(cell), [0, 3])
      g.markets = [
        { owner: 'p1', cell: at('A5'), sold: false },
        { owner: 'p1', cell: at('A17'), sold: false },
      ]
      g.oracles = [{ cell: at('D6'), attention: at('A5') }]
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
    const s = fresh((g) => putCity(g, 'p1', at('A5')))
    const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: 'p1' })
    if (!result.ok) throw new Error(result.error)
    const next = result.state as GameState
    expect(next.game.turnPlayerId).toBe('p2')
    expect(next.game.cityTiles[at('A5')]).toBe('p1')
    const later = passToEnd(next)
    expect(later.winnerPlayerIds).not.toContain('p1')
  })

  it('narrates moves, the round change and the final scores', () => {
    let s = fresh()
    s = play(s, city('p1', 'A5'))
    const founded = gameDefinition.describeAction(city('p1', 'A5'), fresh(), s)
    expect(founded.message).toBe('{player} founded a city at A5.')
    expect(founded.extraLines).toContainEqual({ playerId: 'p1', message: '{player} placed a free market in the new city at A5.' })
    const bridged = fresh((g) => putRoad(g, 'p1', at('D8'), [0, 3]))
    expect(gameDefinition.describeAction(city('p1', 'C7'), bridged, play(bridged, city('p1', 'C7'))).message).toBe('{player} founded a city at C7 and D6.')
    const lastTurn = fresh((g) => (g.turnPlayerId = 'p4'))
    const round2 = play(lastTurn, endTurn('p4'))
    expect(gameDefinition.describeAction(endTurn('p4'), lastTurn, round2).extraLines?.[0].message).toMatch(/^Round 2 of 12: the card gives roads \d, cities \d, resupply \d\. Turn order: /)
  })
})
