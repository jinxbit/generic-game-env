import { describe, expect, it } from 'vitest'
import { CITIES, CITY_COUNT } from '../data'
import { gameDefinition } from '../rules'
import { newGame, play, startAll } from '../testing'
import { attempt, expectConserved } from './helpers'

describe('setup (R-SET)', () => {
  it('R-SET-01/02: cities hold 3 goods of their colour; each player 2 grey, 1 orange, markers 0–8 and a Raid marker', () => {
    const s = newGame({ players: 4 })
    const g = s.game
    g.cities.forEach((city, i) => expect(city.goods[CITIES[i].color]).toBe(3))
    for (const id of g.seatOrder) {
      const p = g.players[id]
      expect(p.goods).toEqual({ grey: 2, orange: 1, purple: 0, white: 0 })
      expect(p.markers).toEqual(Array(CITY_COUNT).fill(1))
      expect(p.raidMarkers).toBe(1)
      expect(p.city).toBeNull()
    }
    expectConserved(s)
  })

  it('R-SET-04: two different route markers per city, never the city’s own number', () => {
    for (let seed = 1; seed < 40; seed++) {
      const g = newGame({ seed }).game
      const firsts = g.cities.map((c) => c.routes[0].value)
      const seconds = g.cities.map((c) => c.routes[1].value)
      expect([...firsts].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
      expect([...seconds].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
      g.cities.forEach((c, i) => {
        expect(c.routes[0].value).not.toBe(i)
        expect(c.routes[1].value).not.toBe(i)
        expect(c.routes[0].value).not.toBe(c.routes[1].value)
        expect(c.routes.every((r) => !r.faceDown)).toBe(true)
      })
    }
  })

  it('R-SET-03: the Guildmaster and the Game Ends marker start in the same city', () => {
    const g = newGame({ seed: 5 }).game
    expect(g.guildmaster).toBe(g.guildmasterStart)
    expect(g.guildmasterLaps).toBe(0)
  })

  it('R-SET-07: everyone picks at once; picks are secret until all have picked', () => {
    let s = newGame({ players: 3, hiddenInformationEnabled: true })
    expect(s.phase).toBe('start')
    expect(s.pendingPlayerIds).toEqual(['p1', 'p2', 'p3'])
    s = play(s, { type: 'START_PICK', playerId: 'p1', attempt: 1, value: 4 })
    expect(s.pendingPlayerIds).toEqual(['p2', 'p3'])
    expect(gameDefinition.redactGame(s, 'p2').startPicks.p1).toBeNull()
    expect(gameDefinition.redactGame(s, 'p1').startPicks.p1).toBe(4)
    expect(gameDefinition.isActionSecret(s.actionHistory[0], s, 'p2')).toBe(true)
    expect(gameDefinition.isActionSecret(s.actionHistory[0], s, 'p1')).toBe(false)
    // A pick may still be changed.
    s = play(s, { type: 'START_PICK', playerId: 'p1', attempt: 1, value: 6 })
    s = play(s, { type: 'START_PICK', playerId: 'p2', attempt: 1, value: 2 })
    s = play(s, { type: 'START_PICK', playerId: 'p3', attempt: 1, value: 6 })
    expect(s.game.players.p1.city).toBe(6)
    expect(s.game.cities[6].houses.map((h) => h.owner)).toEqual(['p1', 'p3'])
    expect(gameDefinition.isActionSecret(s.actionHistory[0], s, 'p2')).toBe(false)
    // R-SET-08: lowest city first.
    expect(s.game.lastAuction).toBeNull()
    expect(s.phase).toBe('auction')
    expect(s.pendingPlayerIds).toEqual(['p2'])
    expect(s.game.order[0]).toBe('p2')
    expect(s.turn).toBe(1)
  })

  it('R-SET-07: three players on one city all pick again; the rest stay placed', () => {
    let s = newGame({ players: 4 })
    for (const id of ['p1', 'p2', 'p3']) s = play(s, { type: 'START_PICK', playerId: id, attempt: 1, value: 3 })
    s = play(s, { type: 'START_PICK', playerId: 'p4', attempt: 1, value: 5 })
    expect(s.game.players.p4.city).toBe(5)
    expect(s.game.startAttempt).toBe(2)
    expect(s.pendingPlayerIds).toEqual(['p1', 'p2', 'p3'])
    expect(attempt(s, { type: 'START_PICK', playerId: 'p1', attempt: 1, value: 1 }).ok).toBe(false)
    expect(attempt(s, { type: 'START_PICK', playerId: 'p4', attempt: 2, value: 1 }).ok).toBe(false)
    s = play(s, { type: 'START_PICK', playerId: 'p1', attempt: 2, value: 1 })
    s = play(s, { type: 'START_PICK', playerId: 'p2', attempt: 2, value: 5 })
    s = play(s, { type: 'START_PICK', playerId: 'p3', attempt: 2, value: 8 })
    expect(s.game.order[0]).toBe('p1')
    expect(new Set(s.game.order.slice(1, 3))).toEqual(new Set(['p2', 'p4']))
    expect(s.game.order[3]).toBe('p3')
    expectConserved(s)
  })

  it('once everyone is placed, round 1 opens with four lots in the market (R-AUC-01)', () => {
    const s = startAll(newGame({ players: 2 }))
    expect(s.game.stage).toBe('auction')
    expect(s.game.market).toHaveLength(4)
    expect(s.game.market.every((lot) => lot.length === 2)).toBe(true)
    expectConserved(s)
  })
})
