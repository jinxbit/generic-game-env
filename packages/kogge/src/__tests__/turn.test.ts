import { describe, expect, it } from 'vitest'
import { gameDefinition } from '../rules'
import type { GameState } from '../engine'
import type { GameAction } from '../types'
import { arrange, atTurn, goods, newGame, play, startAll } from '../testing'
import { attempt, expectConserved } from './helpers'

const base = () => startAll(newGame({ players: 3 }), [0, 4, 7])

function rejects(state: GameState, action: GameAction, message?: RegExp) {
  const result = attempt(state, action)
  expect(result.ok).toBe(false)
  if (message && !result.ok) expect(result.error).toMatch(message)
}

/** City `city`'s routes set to `a` and `b` (face up). */
function routes(state: GameState, city: number, a: number, b: number): GameState {
  return arrange(state, (g) => {
    g.reserve[g.cities[city].routes[0].value!]++
    g.reserve[g.cities[city].routes[1].value!]++
    g.reserve[a]--
    g.reserve[b]--
    g.cities[city].routes = [
      { value: a, faceDown: false, placedBy: null, placementId: null },
      { value: b, faceDown: false, placedBy: null, placementId: null },
    ]
  })
}

describe('the Guildmaster (R-GM)', () => {
  function atGuildmaster(start: number, at = start) {
    let s = base()
    s = arrange(s, (g) => {
      g.guildmaster = at
      g.guildmasterStart = start
    })
    s = play(s, { type: 'BID', playerId: 'p1', markers: [8] })
    s = play(s, { type: 'BID', playerId: 'p2', markers: [7] })
    return play(s, { type: 'BID', playerId: 'p3', markers: [6] })
  }

  it('R-GM-01: the starting player moves it one or two cities clockwise and it brings two goods', () => {
    let s = atGuildmaster(2)
    expect(s.pendingPlayerIds).toEqual(['p1'])
    rejects(s, { type: 'MOVE_GUILDMASTER', playerId: 'p2', steps: 1 })
    const before = s.game.cities[4].goods.orange
    s = play(s, { type: 'MOVE_GUILDMASTER', playerId: 'p1', steps: 2 })
    expect(s.game.guildmaster).toBe(4)
    // Riga has p2's house: one good for it, one for the city (R-AUC-08).
    expect(s.game.cities[4].goods.orange).toBe(before + 1)
    expect(s.game.cities[4].houses[0].goods.orange).toBeGreaterThanOrEqual(1)
    expect(s.phase).toBe('actions')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expectConserved(s)
  })

  it('R-GM-01: raided cities are skipped and don’t count', () => {
    let s = atGuildmaster(2)
    s = arrange(s, (g) => {
      g.cities[3].raids.push('p3')
    })
    s = play(s, { type: 'MOVE_GUILDMASTER', playerId: 'p1', steps: 1 })
    expect(s.game.guildmaster).toBe(4)
  })

  it('R-END-03: passing its start twice makes it the last round, which is then played out [AMBIG-1]', () => {
    let s = atGuildmaster(0, 8)
    s = arrange(s, (g) => {
      g.guildmasterLaps = 1
    })
    s = play(s, { type: 'MOVE_GUILDMASTER', playerId: 'p1', steps: 2 })
    expect(s.game.guildmaster).toBe(1)
    expect(s.game.guildmasterLaps).toBe(2)
    expect(s.status).toBe('active')
    for (const id of s.game.order) s = play(s, { type: 'END_TURN', playerId: id })
    expect(s.status).toBe('completed')
    expect(s.game.scores).not.toBeNull()
    const best = Math.max(...Object.values(s.game.scores!).map((x) => x.total))
    expect(s.winnerPlayerIds.every((id) => s.game.scores![id].total === best)).toBe(true)
  })

  it('R-GM-01a: taxes take a good from each boat there and non-matching goods from the city', () => {
    let s = startAll(newGame({ players: 3, options: { taxes: true } }), [0, 4, 7])
    s = arrange(s, (g) => {
      g.guildmaster = 2
      g.players.p2.city = 3
      g.cities[3].goods.white = 1
      g.supply.white--
    })
    s = play(s, { type: 'BID', playerId: 'p1', markers: [8] })
    s = play(s, { type: 'BID', playerId: 'p2', markers: [7] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [6] })
    s = play(s, { type: 'MOVE_GUILDMASTER', playerId: 'p1', steps: 1 })
    expect(s.game.players.p2.goods).toEqual(goods({ grey: 1, orange: 1 }))
    expect(s.game.cities[3].goods.white).toBe(0)
    expectConserved(s)
  })
})

describe('movement (R-MOV)', () => {
  it('R-MOV-01: the first move is free, later ones cost a good or marker', () => {
    let s = routes(routes(atTurn(base(), 'p1', 0), 0, 3, 5), 3, 6, 1)
    rejects(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [{ kind: 'good', color: 'grey' }] }, /free/)
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] })
    expect(s.game.players.p1.city).toBe(3)
    rejects(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] }, /costs 1/)
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [{ kind: 'marker', value: 2 }] })
    expect(s.game.players.p1.city).toBe(6)
    expect(s.game.players.p1.markers[2]).toBe(0)
    expectConserved(s)
  })

  it('R-MOV-02: Move 2 spaces makes the second move free', () => {
    let s = routes(routes(atTurn(base(), 'p1', 0, (g) => g.players.p1.bonuses.push('moves')), 0, 3, 5), 3, 6, 1)
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] })
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] })
    expect(s.game.players.p1.city).toBe(6)
  })

  it('R-MOV-03: the Secret Passage goes to the Guildmaster for one extra', () => {
    let s = atTurn(base(), 'p1', 0, (g) => {
      g.players.p1.bonuses.push('passage')
      g.guildmaster = 5
    })
    rejects(s, { type: 'MOVE', playerId: 'p1', route: 'passage', payments: [] })
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 'passage', payments: [{ kind: 'good', color: 'grey' }] })
    expect(s.game.players.p1.city).toBe(5)
    rejects(s, { type: 'MOVE', playerId: 'p1', route: 'passage', payments: [{ kind: 'good', color: 'grey' }, { kind: 'good', color: 'orange' }] })
  })

  it('R-MOV-05: never to a city with your own Raid marker', () => {
    const s = routes(atTurn(base(), 'p1', 0, (g) => g.cities[3].raids.push('p1')), 0, 3, 5)
    rejects(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] }, /raided/)
    expect(attempt(s, { type: 'MOVE', playerId: 'p1', route: 1, payments: [] }).ok).toBe(true)
  })

  it('R-MOV-04: a face-down marker turns up; into your own raid, the move is used and you stay', () => {
    let s = atTurn(base(), 'p1', 0, (g) => {
      g.cities[3].raids.push('p1')
      g.reserve[g.cities[0].routes[0].value!]++
      g.reserve[3]--
      g.cities[0].routes[0] = { value: 3, faceDown: true, placedBy: 'p2', placementId: 9 }
    })
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] })
    expect(s.game.players.p1.city).toBe(0)
    expect(s.game.cities[0].routes[0]).toEqual({ value: 3, faceDown: false, placedBy: null, placementId: null })
    expect(s.game.turn?.moves).toBe(1)
    expect(s.game.turn?.moved).toBe(false)
  })

  it('R-MOV-06: goods by your houses are collected at the start of the turn and on arrival', () => {
    let s = routes(atTurn(base(), 'p1', 0), 0, 4, 5)
    s = arrange(s, (g) => {
      g.cities[4].houses.push({ owner: 'p1', goods: goods({ orange: 2 }) })
      g.supply.orange -= 2
    })
    const before = s.game.players.p1.goods.orange
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] })
    expect(s.game.players.p1.goods.orange).toBe(before + 2)
    expect(s.game.cities[4].houses[1].goods).toEqual(goods())
    expectConserved(s)
  })
})

describe('actions (R-ACT)', () => {
  it('R-ACT-01: building costs the three other colours and the city’s marker (two with a house there)', () => {
    let s = atTurn(base(), 'p1', 4, (g) => {
      g.players.p1.goods = goods({ grey: 1, purple: 1, white: 1, orange: 0 })
      g.supply.grey += 1
      g.supply.orange += 1
      g.supply.purple -= 1
      g.supply.white -= 1
    })
    rejects(s, { type: 'BUILD_HOUSE', playerId: 'p1' }, /2 route markers/)
    s = arrange(s, (g) => {
      g.players.p1.markers[4]++
      g.reserve[4]--
    })
    s = play(s, { type: 'BUILD_HOUSE', playerId: 'p1' })
    expect(s.game.cities[4].houses.map((h) => h.owner)).toEqual(['p2', 'p1'])
    expect(s.game.players.p1.goods).toEqual(goods())
    expect(s.game.turn?.movementDone).toBe(true)
    rejects(s, { type: 'BUILD_HOUSE', playerId: 'p1' }, /already/)
    expectConserved(s)
  })

  it('R-END-02: the fifth development point wins at once', () => {
    let s = atTurn(base(), 'p1', 5, (g) => {
      g.players.p1.bonuses.push('route', 'trading', 'moves')
      g.bonusesAvailable.route--
      g.bonusesAvailable.trading--
      g.bonusesAvailable.moves--
      g.players.p1.goods = goods({ grey: 1, orange: 1, white: 1 })
      g.supply.grey += 1
      g.supply.white -= 1
    })
    s = play(s, { type: 'BUILD_HOUSE', playerId: 'p1' })
    expect(s.status).toBe('completed')
    expect(s.winnerPlayerIds).toEqual(['p1'])
    expect(s.pendingPlayerIds).toEqual([])
  })

  it('R-ACT-02: Guildmaster trades — only where it stands, one per turn', () => {
    let s = atTurn(base(), 'p1', 0, (g) => {
      g.guildmaster = 0
      g.players.p1.markers[2] = 3
      g.reserve[2] -= 2
    })
    rejects(atTurn(s, 'p1', 1), { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'sellMarker', value: 3 } }, /isn’t here/)
    s = play(s, { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'raidMarker', value: 2 } })
    expect(s.game.players.p1.raidMarkers).toBe(2)
    rejects(s, { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'sellMarker', value: 3 } }, /already/)
    expectConserved(s)
  })

  it('R-ACT-02b/c/d: bonus for six goods; a good for a marker of its colour and back', () => {
    const at = (edit = (_: GameState['game']) => {}) =>
      atTurn(base(), 'p1', 0, (g) => {
        g.guildmaster = 0
        edit(g)
      })
    let s = at((g) => {
      g.players.p1.goods.grey = 6
      g.supply.grey -= 4
    })
    s = play(s, { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'bonus', color: 'grey', bonus: 'passage' } })
    expect(s.game.players.p1.bonuses).toEqual(['passage'])
    expect(s.game.bonusesAvailable.passage).toBe(1)
    s = play(at(), { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'buyMarker', value: 3 } })
    expect(s.game.players.p1.markers[3]).toBe(2)
    expect(s.game.players.p1.goods.orange).toBe(0)
    rejects(at(), { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'buyMarker', value: 5 } }, /purple/)
    s = play(at(), { type: 'GUILD_TRADE', playerId: 'p1', trade: { kind: 'sellMarker', value: 8 } })
    expect(s.game.players.p1.goods.white).toBe(1)
    expectConserved(s)
  })

  it('R-ACT-03: a lot from the market for one good', () => {
    let s = atTurn(base(), 'p1', 0)
    const lot = s.game.market[1]
    s = play(s, { type: 'BUY_ROUTES', playerId: 'p1', lot: 1, payment: 'orange' })
    expect(s.game.market).toHaveLength(3)
    for (const m of lot) expect(s.game.players.p1.markers[m]).toBeGreaterThanOrEqual(1)
    expectConserved(s)
  })

  it('R-ACT-04: trade with the city only after moving: one good in, two others out (three with 3:1)', () => {
    let s = routes(atTurn(base(), 'p1', 0), 0, 3, 5)
    rejects(s, { type: 'CITY_TRADE', playerId: 'p1', give: 'grey', take: ['orange', 'orange'] }, /after moving/)
    s = play(s, { type: 'MOVE', playerId: 'p1', route: 0, payments: [] })
    rejects(s, { type: 'CITY_TRADE', playerId: 'p1', give: 'orange', take: ['orange', 'orange'] }, /different colour/)
    rejects(s, { type: 'CITY_TRADE', playerId: 'p1', give: 'grey', take: ['orange', 'orange', 'orange'] }, /Take 2/)
    s = play(s, { type: 'CITY_TRADE', playerId: 'p1', give: 'grey', take: ['orange', 'orange'] })
    expect(s.game.players.p1.goods).toEqual(goods({ grey: 1, orange: 3 }))
    expect(s.game.cities[3].goods).toEqual(goods({ grey: 1, orange: 1 }))
    expectConserved(s)
  })

  it('R-ACT-05: a route is exchanged for a face-down marker only its owner knows', () => {
    let s = routes(atTurn({ ...base(), hiddenInformationEnabled: true }, 'p1', 0), 0, 3, 5)
    rejects(s, { type: 'CHANGE_ROUTE', playerId: 'p1', slot: 0, value: 0, placementId: 1 }, /itself/)
    rejects(s, { type: 'CHANGE_ROUTE', playerId: 'p1', slot: 0, value: 6, placementId: 7 }, /out of date/)
    s = play(s, { type: 'CHANGE_ROUTE', playerId: 'p1', slot: 0, value: 6, placementId: 1 })
    expect(s.game.cities[0].routes[0]).toEqual({ value: 6, faceDown: true, placedBy: 'p1', placementId: 1 })
    expect(s.game.players.p1.markers[3]).toBe(2)
    expect(gameDefinition.redactGame(s, 'p2').cities[0].routes[0].value).toBeNull()
    expect(gameDefinition.redactGame(s, 'p1').cities[0].routes[0].value).toBe(6)
    const entry = s.actionHistory[s.actionHistory.length - 1]
    expect(gameDefinition.isActionSecret(entry, s, 'p2')).toBe(true)
    expect(gameDefinition.isActionSecret(entry, s, 'p1')).toBe(false)
    // Hands are secret too: others see only the count.
    const view = gameDefinition.redactGame(s, 'p2').players.p1
    expect(view.hiddenHand).toBe(9)
    expect(view.markers.every((n) => n === 0)).toBe(true)
    expectConserved(s)
  })

  it('R-ACT-06b: raiding a city takes its goods and the houses’, then the player to the left sends the boat on', () => {
    let s = routes(atTurn(base(), 'p1', 4), 4, 6, 8)
    s = arrange(s, (g) => {
      g.cities[4].houses[0].goods.orange = 1
      g.supply.orange--
    })
    s = play(s, { type: 'RAID', playerId: 'p1', target: { kind: 'city' } })
    expect(s.game.players.p1.goods.orange).toBe(1 + 3 + 1)
    expect(s.game.cities[4].raids).toEqual(['p1'])
    expect(s.game.players.p1.raidMarkers).toBe(0)
    expect(s.phase).toBe('raid')
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'RAID_ROUTE', playerId: 'p2', route: 1 })
    expect(s.game.players.p1.city).toBe(8)
    // The raider's turn is over: the next round starts (p1 was last).
    expect(s.phase).toBe('auction')
    expectConserved(s)
  })

  it('R-ACT-06a: raiding a player — they split their goods, the raider picks a half', () => {
    let s = routes(atTurn(base(), 'p1', 4), 4, 6, 8)
    s = arrange(s, (g) => {
      g.players.p2.goods = goods({ grey: 2, orange: 1, white: 2 })
      g.supply.orange += 0
      g.supply.white -= 2
    })
    rejects(s, { type: 'RAID', playerId: 'p1', target: { kind: 'player', victim: 'p3' } }, /this city/)
    s = play(s, { type: 'RAID', playerId: 'p1', target: { kind: 'player', victim: 'p2' } })
    expect(s.pendingPlayerIds).toEqual(['p2'])
    rejects(s, { type: 'RAID_DIVIDE', playerId: 'p2', group: goods({ grey: 1 }) }, /equal/)
    s = play(s, { type: 'RAID_DIVIDE', playerId: 'p2', group: goods({ grey: 2 }) })
    expect(s.pendingPlayerIds).toEqual(['p1'])
    s = play(s, { type: 'RAID_TAKE', playerId: 'p1', group: 1 })
    expect(s.game.players.p1.goods).toEqual(goods({ grey: 2, orange: 2, white: 2 }))
    expect(s.game.players.p2.goods).toEqual(goods({ grey: 2 }))
    expect(s.pendingPlayerIds).toEqual(['p2'])
    s = play(s, { type: 'RAID_ROUTE', playerId: 'p2', route: 0 })
    expect(s.game.players.p1.city).toBe(6)
    expectConserved(s)
  })

  it('R-ACT-07: trade offers go to a player in the same city, who accepts or declines', () => {
    let s = atTurn(base(), 'p1', 4)
    rejects(s, { type: 'PROPOSE_TRADE', playerId: 'p1', to: 'p3', give: { goods: goods({ grey: 1 }), markers: [] }, get: { goods: goods(), markers: [5] } }, /your city/)
    s = play(s, { type: 'PROPOSE_TRADE', playerId: 'p1', to: 'p2', give: { goods: goods({ grey: 1 }), markers: [0] }, get: { goods: goods(), markers: [5] } })
    expect(s.phase).toBe('trade')
    expect(s.pendingPlayerIds).toEqual(['p2'])
    rejects(s, { type: 'END_TURN', playerId: 'p1' })
    s = play(s, { type: 'RESPOND_TRADE', playerId: 'p2', accept: true })
    expect(s.game.players.p1.markers[5]).toBe(2)
    expect(s.game.players.p2.goods.grey).toBe(3)
    expect(s.game.players.p2.markers[0]).toBe(2)
    expect(s.pendingPlayerIds).toEqual(['p1'])
    // Movement isn't over after a trade.
    expect(s.game.turn?.movementDone).toBe(false)
    expectConserved(s)
  })

  it('turns pass in turn order and the round wraps into the next auction', () => {
    let s = base()
    s = play(s, { type: 'BID', playerId: 'p1', markers: [0] })
    s = play(s, { type: 'BID', playerId: 'p2', markers: [8] })
    s = play(s, { type: 'BID', playerId: 'p3', markers: [1] })
    expect(s.game.order).toEqual(['p2', 'p3', 'p1'])
    s = play(s, { type: 'MOVE_GUILDMASTER', playerId: 'p2', steps: 1 })
    for (const id of ['p2', 'p3', 'p1']) {
      expect(s.pendingPlayerIds).toEqual([id])
      s = play(s, { type: 'END_TURN', playerId: id })
    }
    expect(s.turn).toBe(2)
    expect(s.phase).toBe('auction')
    expectConserved(s)
  })

  it('a conceding player is skipped from then on', () => {
    let s = atTurn(base(), 'p1', 0)
    s = play(s, { type: 'CONCEDE', playerId: 'p1' } as never)
    expect(s.status).toBe('active')
    expect(s.game.order).not.toContain('p1')
    expect(s.phase).toBe('auction')
  })
})
