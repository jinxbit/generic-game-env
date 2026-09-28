// Randomised games: a bot proposes random (often illegal) moves, the rules
// must reject the illegal ones cleanly (never throw), the legal ones must keep
// every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import { COLOURS, MARKERS_PER_COLOUR, MAX_BUY_PER_TURN, MAX_PRICE, placementsForRoll, previewPlacement, pricesOf, SHARES_PER_COLOUR, type GameState } from '../rules'
import { newGame, simplestMove, testRandom } from '../testing'
import type { GameAction } from '../types'

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const actor = r.next() < 0.03 ? r.pick(g.seatOrder) : s.pendingPlayerIds[0]
  const colour = () => r.pick(COLOURS)
  const out: GameAction[] = []
  switch (g.step) {
    case 'preTrade':
    case 'postTrade':
      for (let i = 0; i < 3; i++) {
        const priced = COLOURS.filter((k) => g.prices[k] > 0)
        if (r.next() < 0.7) out.push({ type: 'BUY', playerId: actor, colour: priced.length && r.next() < 0.9 ? r.pick(priced) : colour(), count: r.int(0, 3) })
        if (r.next() < 0.2) out.push({ type: 'SELL', playerId: actor, colour: colour(), count: r.int(1, 3) })
      }
      out.push(g.step === 'preTrade' ? { type: 'ROLL', playerId: actor } : { type: 'END_TURN', playerId: actor })
      break
    case 'place': {
      out.push({ type: 'PLACE', playerId: actor, cell: r.int(-1, 120), colour: colour() })
      const legal = placementsForRoll(g)
      // Prefer placements that grow groups or eliminate, so prices and falls actually happen.
      const touching = legal.filter((p) => g.board.some((c, i) => c && Math.abs(i - p.cell) in { 1: 1, 12: 1 }))
      const eliminating = legal.filter((p) => previewPlacement(g.board, p.cell, p.colour).eliminated.length > 0)
      const pool = eliminating.length > 0 && r.next() < 0.8 ? eliminating : touching.length > 0 && r.next() < 0.5 ? touching : legal
      const choice = r.pick(pool)
      out.push({ type: 'PLACE', playerId: actor, cell: choice.cell, colour: choice.colour })
      break
    }
    case 'debts':
      out.push({ type: 'FORCED_SELL', playerId: actor, colour: colour(), count: r.int(1, 4) })
      break
    case 'ended':
      break
  }
  return out
}

function checkInvariants(s: GameState): void {
  const g = s.game
  for (const k of COLOURS) {
    expect(g.bank[k] + g.seatOrder.reduce((n, id) => n + g.players[id].shares[k], 0)).toBe(SHARES_PER_COLOUR)
    expect(g.supply[k]).toBeGreaterThanOrEqual(0)
    expect(g.board.filter((c) => c === k).length).toBeLessThanOrEqual(MARKERS_PER_COLOUR - g.supply[k])
    expect(g.prices[k]).toBeLessThanOrEqual(MAX_PRICE)
  }
  expect(g.prices).toEqual(pricesOf(g.board))
  expect(g.boughtThisTurn).toBeLessThanOrEqual(MAX_BUY_PER_TURN)
  if (s.status !== 'active') {
    expect(s.pendingPlayerIds).toEqual([])
    return
  }
  const out = (id: string) => s.players.find((p) => p.id === id)!.eliminated
  if (g.step === 'debts') {
    expect(s.pendingPlayerIds).toEqual(g.debtors)
    expect(g.debtors.length).toBeGreaterThan(0)
    for (const id of g.debtors) expect(g.players[id].cash).toBeLessThan(0)
  } else {
    expect(s.pendingPlayerIds).toEqual([g.turnPlayerId])
    expect(s.activePlayerId).toBe(g.turnPlayerId)
    expect(g.debtors).toEqual([])
  }
  for (const id of g.seatOrder) {
    if (out(id)) expect(s.pendingPlayerIds).not.toContain(id)
    if (!g.debtors.includes(id)) expect(g.players[id].cash).toBeGreaterThanOrEqual(0)
  }
}

/** What every game together reached — the last test checks the bot exercised the rarer paths. */
const everSeen = new Set<string>()

describe('random games', () => {
  for (const players of [3, 4, 5, 6]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      it(`${players} players, seed ${seed}${players === 4 ? ', with a concession' : ''}`, () => {
        const r = createRandom('shark-fuzz', players, seed)
        let s = newGame({ players, options: { startingCash: seed === 3 ? 20_000 : 0 } })
        const genesis = s
        const concedeAt = players === 4 ? r.int(20, 200) : -1
        const seen = new Set<string>()
        for (let step = 0; step < 5000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: r.pick(s.game.seatOrder) })
            if (!result.ok) throw new Error(`CONCEDE rejected: ${result.error}`)
            s = result.state as GameState
            checkInvariants(s)
            continue
          }
          let applied = false
          for (const action of candidates(s, r)) {
            const result = applyAction(s as PlatformState, action, { random: testRandom(step + seed * 1000) })
            if (result.ok) {
              s = result.state as GameState
              seen.add(action.type)
              applied = true
              break
            }
          }
          if (!applied) {
            const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step) })
            if (!result.ok) throw new Error(`simplest move rejected in ${s.game.step}: ${result.error}`)
            s = result.state as GameState
          }
          checkInvariants(s)
          everSeen.add(s.game.step)
          if (s.game.autoSales.length > 0) everSeen.add('autoSale')
          if (Object.keys(s.game.writeOffs).length > 0) everSeen.add('writeOff')
          if (s.game.lastRoll?.missed) everSeen.add('missedTurn')
          if ((s.game.lastPlacement?.eliminated.length ?? 0) > 0) everSeen.add('elimination')
        }
        for (const type of seen) everSeen.add(type)
        if (process.env.FUZZ_STATS) console.log(players, seed, s.actionHistory.length, JSON.stringify(s.game.endReason), [...seen].join(","), JSON.stringify(s.game.finalWealth))
        expect(s.status).toBe('completed')
        expect(s.game.finalWealth).not.toBeNull()
        expect(s.winnerPlayerIds.length).toBeGreaterThan(0)
        expect([...seen]).toEqual(expect.arrayContaining(['BUY', 'ROLL', 'PLACE']))
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      })
    }
  }

  it('between them, reached forced sales (chosen and automatic), write-offs and eliminations', () => {
    expect([...everSeen]).toEqual(expect.arrayContaining(['debts', 'FORCED_SELL', 'autoSale', 'writeOff', 'elimination']))
  })
})
