// Randomised games: a bot proposes random (often illegal) moves, the rules
// must reject the illegal ones cleanly (never throw), the legal ones must keep
// every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import { BONUS_TYPES, COLORS } from '../data'
import type { GameState } from '../engine'
import { gameDefinition } from '../rules'
import { newGame, simplestMove, testRandom } from '../testing'
import type { Color, GameAction, Goods } from '../types'
import { expectConserved } from './helpers'

function randomGoods(r: Random, max: number): Goods {
  const g: Goods = { grey: 0, orange: 0, purple: 0, white: 0 }
  for (let i = r.int(0, max); i > 0; i--) g[r.pick(COLORS)]++
  return g
}

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const id = s.pendingPlayerIds[0]
  const out: GameAction[] = []
  const marker = () => r.int(0, 8)
  const color = (): Color => r.pick(COLORS)
  const pay = () => (r.next() < 0.5 ? { kind: 'good' as const, color: color() } : { kind: 'marker' as const, value: marker() })
  switch (g.stage) {
    case 'start':
      out.push({ type: 'START_PICK', playerId: r.pick(s.pendingPlayerIds), attempt: g.startAttempt, value: marker() })
      break
    case 'auction':
      out.push({ type: 'BID', playerId: id, markers: Array.from({ length: r.int(1, 3) }, marker) })
      break
    case 'guildmaster':
      out.push({ type: 'MOVE_GUILDMASTER', playerId: id, steps: r.pick([1, 2] as const) })
      break
    case 'actions':
      if (g.offer) {
        out.push({ type: 'RESPOND_TRADE', playerId: id, accept: r.next() < 0.5 })
        break
      }
      if (g.raid?.step === 'divide') out.push({ type: 'RAID_DIVIDE', playerId: id, group: randomGoods(r, 6) })
      else if (g.raid?.step === 'take') out.push({ type: 'RAID_TAKE', playerId: id, group: r.pick([0, 1] as const) })
      else if (g.raid?.step === 'route') out.push({ type: 'RAID_ROUTE', playerId: id, route: r.pick([0, 1] as const) })
      else {
        for (let i = 0; i < 3; i++) out.push({ type: 'MOVE', playerId: id, route: r.pick([0, 1, 'passage'] as const), payments: Array.from({ length: r.int(0, 2) }, pay) })
        out.push({ type: 'BUILD_HOUSE', playerId: id })
        out.push({ type: 'BUILD_HOUSE', playerId: id })
        out.push({ type: 'GUILD_TRADE', playerId: id, trade: { kind: 'raidMarker', value: marker() } })
        out.push({ type: 'GUILD_TRADE', playerId: id, trade: { kind: 'bonus', color: color(), bonus: r.pick(BONUS_TYPES) } })
        out.push({ type: 'GUILD_TRADE', playerId: id, trade: { kind: r.pick(['buyMarker', 'sellMarker'] as const), value: marker() } })
        out.push({ type: 'BUY_ROUTES', playerId: id, lot: r.int(0, 3), payment: color() })
        out.push({ type: 'CITY_TRADE', playerId: id, give: color(), take: Array.from({ length: r.int(2, 3) }, color) })
        out.push({ type: 'CHANGE_ROUTE', playerId: id, slot: r.pick([0, 1] as const), value: marker(), placementId: g.nextPlacementId })
        if (r.next() < 0.1) out.push({ type: 'RAID', playerId: id, target: r.next() < 0.5 ? { kind: 'city' } : { kind: 'player', victim: r.pick(g.order) } })
        if (r.next() < 0.1) {
          out.push({ type: 'PROPOSE_TRADE', playerId: id, to: r.pick(g.order), give: { goods: randomGoods(r, 2), markers: [] }, get: { goods: randomGoods(r, 1), markers: r.next() < 0.5 ? [marker()] : [] } })
        }
        if (r.next() < 0.3) out.push({ type: 'END_MOVEMENT', playerId: id })
        if (r.next() < 0.04) out.push({ type: 'END_TURN', playerId: id })
      }
      break
    case 'over':
      break
  }
  return r.shuffle(out)
}

function checkInvariants(s: GameState): void {
  expectConserved(s)
  const g = s.game
  for (const p of Object.values(g.players)) {
    expect(COLORS.every((c) => p.goods[c] >= 0)).toBe(true)
    expect(p.markers.every((n) => n >= 0)).toBe(true)
    expect(p.raidMarkers).toBeGreaterThanOrEqual(0)
    expect(p.raidMarkers).toBeLessThanOrEqual(2)
  }
  if (s.status === 'active') {
    expect(s.pendingPlayerIds.length).toBeGreaterThan(0)
  }
  // A redacted view never shows another player's hand, face-down routes or pending start pick.
  if (s.status === 'active') {
    for (const viewer of g.seatOrder) {
      const view = gameDefinition.redactGame(s, viewer)
      for (const id of g.seatOrder) if (id !== viewer) expect(view.players[id].markers.every((n) => n === 0)).toBe(true)
      for (const city of view.cities) for (const slot of city.routes) if (slot.faceDown && slot.placedBy !== viewer) expect(slot.value).toBeNull()
    }
  }
}

describe('random games', () => {
  for (const [run, taxes] of [false, true, false, true].entries()) {
    for (const players of [2, 3, 4]) {
      it(`run ${run}: ${players} players${taxes ? ', taxes' : ''}, with a concession in the 4-player games`, () => {
        const r = createRandom('kogge-fuzz', players, run)
        let s = newGame({ players, options: { taxes }, seed: players * 5 + run })
        const genesis = s
        const concedeAt = players === 4 ? r.int(30, 200) : -1
        for (let step = 0; step < 5000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: r.pick(s.game.order) }, { random: testRandom(step) })
            expect(result.ok).toBe(true)
            if (result.ok) s = result.state as GameState
            checkInvariants(s)
            continue
          }
          let applied = false
          for (const action of candidates(s, r)) {
            const result = applyAction(s as PlatformState, action, { random: testRandom(step + 1) })
            if (result.ok) {
              s = result.state as GameState
              applied = true
              break
            }
          }
          if (!applied) {
            const result = applyAction(s as PlatformState, simplestMove(s, r), { random: testRandom(step + 1) })
            if (!result.ok) throw new Error(`simplest move rejected in ${s.phase}: ${result.error}`)
            s = result.state as GameState
          }
          checkInvariants(s)
        }
        if (process.env.FUZZ_STATS) {
          const counts = s.actionHistory.reduce((m: Record<string, number>, e) => ({ ...m, [e.action.type]: (m[e.action.type] ?? 0) + 1 }), {})
          console.log(run, players, taxes, s.game.round, JSON.stringify(counts), s.winnerPlayerIds)
        }
        expect(s.status).toBe('completed')
        expect(s.game.scores).not.toBeNull()
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      })
    }
  }
})
