// Randomised tournaments: a bot proposes random (often illegal) moves, the
// rules must reject the illegal ones cleanly (never throw), the legal ones
// must keep every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import { amountToCall, canRaise, maxRaiseTo, minRaiseTo, potTotal, type GameState } from '../rules'
import { newGame, simplestMove, testRandom } from '../testing'
import type { GameAction } from '../types'

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const actor = r.next() < 0.03 ? r.pick(g.seatOrder) : g.toActId!
  const out: GameAction[] = []
  const toCall = amountToCall(g, actor)
  // Mostly sensible play, with enough aggression to reach all-ins and side pots.
  const roll = r.next()
  if (roll < 0.05) out.push({ type: 'BET', playerId: actor, amount: r.int(-5, maxRaiseTo(g, actor) + 50) })
  if (canRaise(g, actor)) {
    const min = minRaiseTo(g, actor)
    const max = maxRaiseTo(g, actor)
    if (roll < 0.1) out.push({ type: 'BET', playerId: actor, amount: max })
    else if (roll < 0.35) out.push({ type: 'BET', playerId: actor, amount: r.int(min, Math.min(max, min * 3)) })
  }
  if (toCall > 0 && r.next() < 0.25) out.push({ type: 'FOLD', playerId: actor })
  if (r.next() < 0.05) out.push({ type: 'CHECK', playerId: actor })
  out.push(toCall > 0 ? { type: 'CALL', playerId: actor } : { type: 'CHECK', playerId: actor })
  return out
}

function checkInvariants(s: GameState, bank: number): void {
  const g = s.game
  const chips = g.seatOrder.reduce((n, id) => n + g.players[id].stack, 0) + potTotal(g)
  if (s.status === 'active' || g.step === 'ended') expect(chips).toBe(bank)
  for (const id of g.seatOrder) {
    const p = g.players[id]
    expect(p.stack).toBeGreaterThanOrEqual(0)
    expect(p.committed).toBeLessThanOrEqual(p.contributed)
    const out = s.players.find((x) => x.id === id)!.eliminated
    if (out) expect(s.pendingPlayerIds).not.toContain(id)
    if (p.bustedInHand !== null) expect(out).toBe(true)
  }
  if (s.status !== 'active') {
    // A concession that leaves one player ends the game in the framework, mid-hand.
    if (g.step !== 'ended') return
    expect(s.pendingPlayerIds).toEqual([])
    expect(s.winnerPlayerIds.length).toBeGreaterThan(0)
    return
  }
  const dealt = [...g.board, ...g.seatOrder.flatMap((id) => g.players[id].hole)]
  expect(new Set(dealt).size).toBe(dealt.length)
  expect(g.board.length).toBe({ preflop: 0, flop: 3, turn: 4, river: 5 }[g.step as 'preflop'])
  expect(s.pendingPlayerIds).toEqual([g.toActId])
  expect(s.activePlayerId).toBe(g.toActId)
  expect(s.phase).toBe(g.step)
  expect(s.turn).toBe(g.hand)
  const actor = g.players[g.toActId!]
  expect(actor.status).toBe('in')
  expect(actor.stack).toBeGreaterThan(0)
  for (const id of g.seatOrder) if (g.players[id].status === 'in') expect(g.players[id].hole).toHaveLength(2)
}

/** What the games together reached — the last test checks the bot exercised the rarer paths. */
const everSeen = new Set<string>()

describe('random tournaments', () => {
  for (const players of [2, 3, 5, 9]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const concede = seed === 3 && players > 2
      it(`${players} players, seed ${seed}${concede ? ', with a concession' : ''}`, () => {
        const r = createRandom('holdem-fuzz', players, seed)
        let s = newGame({ players, seed, options: { startingStack: 500, bigBlind: 20, blindsDoubleEvery: 5, maxHands: seed === 6 ? 4 : 0 } })
        const genesis = s
        let bank = players * 500
        const concedeAt = concede ? r.int(10, 80) : -1
        for (let step = 0; step < 6000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const leaver = r.pick(s.turnOrder)
            bank -= s.game.players[leaver].stack
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: leaver }, { random: testRandom(step + 99) })
            if (!result.ok) throw new Error(`CONCEDE rejected: ${result.error}`)
            s = result.state as GameState
            everSeen.add('CONCEDE')
            checkInvariants(s, bank)
            continue
          }
          let applied = false
          for (const action of candidates(s, r)) {
            const result = applyAction(s as PlatformState, action, { random: testRandom(step + seed * 1000) })
            if (result.ok) {
              s = result.state as GameState
              everSeen.add(action.type)
              applied = true
              break
            }
          }
          if (!applied) {
            const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step) })
            if (!result.ok) throw new Error(`simplest move rejected on the ${s.game.step}: ${result.error}`)
            s = result.state as GameState
          }
          checkInvariants(s, bank)
          const last = s.game.lastHand
          if (last?.showdown) everSeen.add('showdown')
          if (last && !last.showdown) everSeen.add('uncontested')
          if ((last?.pots.length ?? 0) > 1) everSeen.add('sidePot')
          if (last?.pots.some((p) => p.winners.length > 1)) everSeen.add('split')
          if (last?.returned) everSeen.add('returned')
          if ((last?.busted.length ?? 0) > 0) everSeen.add('bust')
        }
        expect(s.status).toBe('completed')
        everSeen.add(s.game.endReason!)
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      })
    }
  }

  it('between them, reached showdowns, side pots, split pots, uncalled bets, busts and both endings', () => {
    expect([...everSeen]).toEqual(
      expect.arrayContaining(['FOLD', 'CHECK', 'CALL', 'BET', 'CONCEDE', 'showdown', 'uncontested', 'sidePot', 'split', 'returned', 'bust', 'lastStanding', 'handLimit']),
    )
  })
})
