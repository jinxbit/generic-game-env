// Randomised games: a bot proposes random moves — mostly legal ones, biased
// towards roads that reach places so networks, markets and oracles actually
// happen, plus some junk — the rules must reject the illegal ones cleanly
// (never throw), the legal ones must keep every invariant, and the whole log
// must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import {
  allowanceLeft,
  analyse,
  cityKey,
  connectionCount,
  legalCityCells,
  legalMarkets,
  legalRoads,
  marketPlace,
  MARKETS_PER_PLAYER,
  neighbours,
  opposite,
  parsePlace,
  placeAt,
  sellableMarkets,
  stepFrom,
  TILES_PER_KIND,
  type GameState,
} from '../rules'
import { newGame, simplestMove, testRandom } from '../testing'
import type { GameAction } from '../types'

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const me = r.next() < 0.03 ? r.pick(g.seatOrder) : g.turnPlayerId!
  const a = analyse(g)
  const out: GameAction[] = []
  if (r.next() < 0.1) out.push({ type: 'PLACE_CITY', playerId: me, cell: r.int(-1, 170) })
  if (r.next() < 0.1) out.push({ type: 'PLACE_ROAD', playerId: me, cell: r.int(0, 168), ends: [r.int(0, 3), r.int(0, 3)] as never })
  const cities = legalCityCells(g, a)
  const roads = legalRoads(g)
  // Steer roads: prefer a tile that completes a connection, else one whose open end heads for the nearest place.
  const placeCells = Array.from({ length: 169 }, (_, c) => c).filter((c) => placeAt(g, a, c) !== null)
  const linked = (cell: number, d: 0 | 1 | 2 | 3) => {
    const n = stepFrom(cell, d)
    return n !== null && (placeAt(g, a, n) !== null || (g.roads[n]?.owner === me && g.roads[n]!.ends.includes(opposite(d))))
  }
  const distance = (cell: number) => Math.min(...placeCells.map((c) => Math.abs(Math.floor(c / 13) - Math.floor(cell / 13)) + Math.abs((c % 13) - (cell % 13))))
  const score = ({ cell, ends }: { cell: number; ends: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3] }) => {
    const open = ends.filter((d) => !linked(cell, d))
    if (open.length === 0) return 100
    return -Math.min(...open.map((d) => distance(stepFrom(cell, d)!)))
  }
  const roll = r.next()
  if (cities.length > 0 && roll < 0.35) out.push({ type: 'PLACE_CITY', playerId: me, cell: r.pick(cities) })
  if (roads.length > 0 && roll < 0.75) {
    const best = Math.max(...roads.map(score))
    const pool = r.next() < 0.7 ? roads.filter((x) => score(x) === best) : roads
    const pick = r.pick(pool)
    out.push({ type: 'PLACE_ROAD', playerId: me, cell: pick.cell, ends: pick.ends })
  }
  const p = g.players[me]
  const left = allowanceLeft(g).resupply
  if (left > 0 && r.next() < 0.4) {
    const roadsBack = Math.min(p.staging.roads, r.int(0, left))
    out.push({ type: 'RESUPPLY', playerId: me, roads: roadsBack, cities: Math.min(p.staging.cities, left - roadsBack) })
  }
  const sellable = sellableMarkets(g, a)
  if (sellable.length > 0 && r.next() < 0.25) out.push({ type: 'SELL_MARKET', playerId: me, cell: r.pick(sellable).market.cell })
  const markets = legalMarkets(g, a)
  if (markets.length > 0 && r.next() < 0.5) out.push({ type: 'BUILD_MARKET', playerId: me, cell: r.pick(markets).cell })
  out.push({ type: 'END_TURN', playerId: me })
  return out
}

function checkInvariants(s: GameState): void {
  const g = s.game
  const a = analyse(g)
  for (const id of g.seatOrder) {
    const p = g.players[id]
    expect(p.points).toBeGreaterThanOrEqual(0)
    expect(p.supply.roads + p.staging.roads + g.roads.filter((t) => t?.owner === id).length).toBe(TILES_PER_KIND)
    expect(p.supply.cities + p.staging.cities + g.cityTiles.filter((t) => t === id).length).toBe(TILES_PER_KIND)
    expect(p.markets + g.markets.filter((m) => m.owner === id).length).toBeLessThanOrEqual(MARKETS_PER_PLAYER)
  }
  // R-MKT-01: one market per player per place.
  const places = g.markets.map((m) => `${m.owner}@${marketPlace(a, m)}`)
  expect(new Set(places).size).toBe(places.length)
  g.cityTiles.forEach((owner, cell) => {
    if (!owner) return
    // Every tile belongs to one of its owner's cities, which never touch a rival city (R-CITY-03/05).
    expect(a.cityOf[cell]).not.toBeNull()
    for (const n of neighbours(cell)) if (g.cityTiles[n] && g.cityTiles[n] !== owner) throw new Error(`cities touch at ${cell}/${n}`)
    for (const n of neighbours(cell)) if (g.cityTiles[n] === owner) expect(a.cityOf[n]).toBe(a.cityOf[cell])
  })
  // R-ROAD-04: no road joins another player's.
  g.roads.forEach((t, cell) => {
    if (!t) return
    for (const d of t.ends) {
      const n = stepFrom(cell, d)
      expect(n).not.toBeNull()
      const other = g.roads[n!]
      if (other && other.ends.includes(opposite(d))) expect(other.owner).toBe(t.owner)
    }
  })
  // R-ORACLE-02/03: attention on a connected city at least as important as every other connected city.
  for (const o of g.oracles) {
    const connected = [...(a.links.get(`o${o.cell}`) ?? [])].map(parsePlace).filter((p) => p.kind === 'city').map((p) => p.id)
    if (connected.length === 0) {
      expect(o.attention).toBeNull()
      continue
    }
    expect(connected).toContain(o.attention)
    const importance = connectionCount(a, cityKey(o.attention!))
    for (const id of connected) expect(connectionCount(a, cityKey(id))).toBeLessThanOrEqual(importance)
  }
  if (s.status !== 'active') {
    expect(s.pendingPlayerIds).toEqual([])
    return
  }
  expect(s.pendingPlayerIds).toEqual([g.turnPlayerId])
  expect(s.players.find((p) => p.id === g.turnPlayerId)?.eliminated).toBe(false)
  expect(s.turn).toBe(g.round)
}

/** What the games together reached — the last test checks the bot exercised the rarer paths. */
const everSeen = new Set<string>()

describe('random games', () => {
  for (const players of [2, 3, 4]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const concede = players >= 3 && seed === 4
      it(`${players} players, seed ${seed}${concede ? ', with a concession' : ''}`, () => {
        const r = createRandom('magna-grecia-fuzz', players, seed)
        let s = newGame({ players, seed, options: { rounds: seed % 3 === 0 ? 8 : 12 } })
        const genesis = s
        const concedeAt = concede ? r.int(20, 120) : -1
        for (let step = 0; step < 4000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: r.pick(s.game.seatOrder) }, { random: testRandom(step) })
            if (!result.ok) throw new Error(`CONCEDE rejected: ${result.error}`)
            s = result.state as GameState
            checkInvariants(s)
            continue
          }
          let applied = false
          for (const action of candidates(s, r)) {
            const result = applyAction(s as PlatformState, action, { random: testRandom(step + seed * 1000) })
            if (!result.ok) continue
            const before = s
            s = result.state as GameState
            everSeen.add(action.type)
            if (action.type === 'PLACE_CITY' && s.game.progress.cities - before.game.progress.cities === 2) everSeen.add('bridge')
            for (const e of s.game.events) everSeen.add(e.kind === 'oracle' ? (e.from === null ? 'oracleFirst' : 'oracleSwitch') : e.kind)
            applied = true
            break
          }
          if (!applied) {
            const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step) })
            if (!result.ok) throw new Error(`simplest move rejected: ${result.error}`)
            s = result.state as GameState
          }
          checkInvariants(s)
        }
        if (process.env.FUZZ_STATS) console.log(players, seed, s.actionHistory.length, JSON.stringify(s.game.finalScores))
        expect(s.status).toBe('completed')
        expect(s.game.finalScores).not.toBeNull()
        expect(s.winnerPlayerIds.length).toBeGreaterThan(0)
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      })
    }
  }

  it('between them, reached bridges, market sales, founding markets and oracles switching', () => {
    expect([...everSeen]).toEqual(expect.arrayContaining(['PLACE_ROAD', 'PLACE_CITY', 'RESUPPLY', 'BUILD_MARKET', 'SELL_MARKET', 'bridge', 'foundingMarket', 'oracleFirst', 'oracleSwitch', 'round']))
  })
})
