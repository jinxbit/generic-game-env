// Randomised games: a bot proposes random (often illegal) moves, the rules
// must reject the illegal ones cleanly (never throw), the legal ones must
// keep every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import {
  activationProblem,
  blockableAttackers,
  canAttack,
  cardDef,
  colorsOf,
  creatureStats,
  DECKS,
  gameDefinition,
  handOf,
  isPriorityStep,
  legalTargets,
  maxX,
  COLORS,
  type GameAction,
  type GameState,
  type Target,
} from '../rules'
import { castCandidate, newGame, simplestMove, testRandom } from '../testing'

function anyTarget(s: GameState, r: Random): Target {
  const g = s.game
  const pool: Target[] = [
    ...g.seatOrder.map((id): Target => ({ kind: 'player', id })),
    ...g.battlefield.map((p): Target => ({ kind: 'permanent', id: p.id })),
    ...g.stack.map((i): Target => ({ kind: 'spell', id: i.id })),
  ]
  return r.pick(pool)
}

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const out: GameAction[] = []
  if (g.step === 'chooseDeck') {
    const playerId = r.pick(g.seatOrder)
    out.push({ type: 'CHOOSE_DECK', playerId, deck: r.next() < 0.05 ? 'nope' : r.pick(DECKS).id })
    return out
  }
  if (g.step === 'mulligan') {
    const playerId = r.pick(g.seatOrder)
    if (r.next() < 0.2) out.push({ type: 'MULLIGAN', playerId })
    const hand = handOf(g, playerId)
    out.push({ type: 'KEEP', playerId, bottom: r.shuffle(hand).slice(0, g.players[playerId].mulligans).map((c) => c.id) })
    return out
  }
  const me = r.next() < 0.03 ? r.pick(g.seatOrder) : g.priorityId!
  if (r.next() < 0.03) out.push({ type: 'PASS', playerId: me })
  if (g.step === 'attack') {
    const able = g.battlefield.filter((p) => canAttack(g, p))
    out.push({ type: 'DECLARE_ATTACKERS', playerId: me, attackers: able.filter(() => r.next() < 0.7).map((p) => p.id) })
    out.push({ type: 'DECLARE_ATTACKERS', playerId: me, attackers: able.map((p) => p.id) })
    return out
  }
  if (g.step === 'discard') {
    const hand = handOf(g, me)
    out.push({ type: 'DISCARD', playerId: me, cardIds: r.shuffle(hand).slice(0, hand.length - 7).map((c) => c.id) })
    return out
  }
  if (!isPriorityStep(g)) return out
  // Abilities, sometimes.
  for (const p of r.shuffle(g.battlefield.filter((q) => q.controller === me))) {
    const abilities = cardDef(p.def).abilities ?? []
    abilities.forEach((a, i) => {
      if (r.next() > 0.25 || activationProblem(g, me, p, i) !== null) return
      if (a.produces !== undefined) {
        if (r.next() < 0.3) out.push({ type: 'ACTIVATE', playerId: me, permanentId: p.id, ability: i, targets: [], ...(a.produces === 'any' ? { color: r.pick(COLORS) } : {}) })
        return
      }
      const targets = a.target ? legalTargets(g, me, a.target, colorsOf(p.def)) : []
      if (a.target && targets.length === 0) return
      out.push({ type: 'ACTIVATE', playerId: me, permanentId: p.id, ability: i, targets: a.target ? [r.pick(targets)] : [] })
    })
  }
  // Spells: sometimes a random (possibly illegal) target or X, mostly the bot's sensible pick.
  const hand = handOf(g, me)
  if (hand.length > 0 && r.next() < 0.1) {
    const c = r.pick(hand)
    const def = cardDef(c.def)
    out.push({ type: 'CAST', playerId: me, cardId: c.id, targets: def.target ? [anyTarget(s, r)] : [], ...(def.cost?.x ? { x: r.int(0, Math.max(0, maxX(g, me, def.cost))) } : {}) })
  }
  const land = hand.find((c) => cardDef(c.def).types.includes('Land'))
  if (land && r.next() < 0.9) out.push({ type: 'PLAY_LAND', playerId: me, cardId: land.id })
  const sensible = castCandidate(s, me)
  if (sensible && r.next() < 0.8) out.push(sensible)
  if (g.step === 'block' && g.stack.length === 0) {
    const blocks: { blocker: string; attacker: string }[] = []
    for (const p of g.battlefield.filter((q) => q.controller === me)) {
      const options = blockableAttackers(g, p)
      if (options.length > 0 && r.next() < 0.6) blocks.push({ blocker: p.id, attacker: r.pick(options) })
    }
    out.push({ type: 'DECLARE_BLOCKERS', playerId: me, blocks })
  }
  return out
}

function checkInvariants(s: GameState, before: GameState): void {
  const g = s.game
  // Every card is in exactly one zone, and nothing appears or vanishes.
  if (g.step !== 'chooseDeck') {
    const ids = [
      ...g.battlefield.map((p) => p.id),
      ...g.stack.filter((i) => i.card).map((i) => i.card!.id),
      ...g.exile.map((c) => c.id),
      ...g.seatOrder.flatMap((id) => {
        const p = g.players[id]
        return [...p.library, ...p.bottom, ...p.hand, ...p.graveyard].map((c) => c!.id)
      }),
    ]
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(80)
  }
  for (const p of g.battlefield) {
    if (cardDef(p.def).types.includes('Creature')) {
      const { toughness } = creatureStats(g, p)
      expect(toughness).toBeGreaterThan(0)
      expect(p.damage).toBeLessThan(toughness)
    }
    if (cardDef(p.def).aura) expect(g.battlefield.some((q) => q.id === p.attachedTo)).toBe(true)
  }
  for (const id of g.seatOrder) {
    for (const k of ['W', 'U', 'B', 'R', 'G', 'C'] as const) expect(g.players[id].manaPool[k]).toBeGreaterThanOrEqual(0)
  }
  if (s.status !== 'active') {
    expect(s.pendingPlayerIds).toEqual([])
    return
  }
  if (g.step === 'chooseDeck' || g.step === 'mulligan') {
    expect(s.activePlayerId).toBeNull()
    expect(s.pendingPlayerIds.length).toBeGreaterThan(0)
    return
  }
  expect(s.pendingPlayerIds).toEqual([g.priorityId])
  expect(s.activePlayerId).toBe(g.priorityId)
  expect(s.phase).toBe(g.step)
  expect(s.turn).toBe(g.turnNumber)
  expect(g.seatOrder.every((id) => g.players[id].life > 0)).toBe(true)
  if (g.combat) expect(['block', 'combat']).toContain(g.step)
  if (g.stack.length === 0 && before.game.step !== 'attack') expect(['main1', 'main2', 'block', 'combat', 'end', 'attack', 'discard']).toContain(g.step)
}

/** What the games together reached — the last test checks the bot exercised the rarer paths. */
const everSeen = new Set<string>()

describe('random games', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    it(`seed ${seed}`, () => {
      const r = createRandom('magic-fuzz', seed)
      let s = newGame({ seed, options: { startingLife: seed % 3 === 0 ? 10 : 20 } })
      const genesis = s
      for (let step = 0; step < 4000 && s.status === 'active'; step++) {
        const before = s
        let applied = false
        for (const action of candidates(s, r)) {
          const result = applyAction(s as PlatformState, action, { random: testRandom(step + seed * 10000) })
          if (result.ok) {
            s = result.state as GameState
            everSeen.add(action.type)
            applied = true
            break
          }
        }
        if (!applied) {
          const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step) })
          if (!result.ok) throw new Error(`simplest move rejected in ${s.game.step}: ${result.error}`)
          s = result.state as GameState
        }
        checkInvariants(s, before)
        for (const line of s.game.journal) {
          if (/doesn't resolve/.test(line)) everSeen.add('fizzle')
          if (/is countered/.test(line)) everSeen.add('counter')
          if (/at random/.test(line)) everSeen.add('specterDiscard')
          if (/dies/.test(line)) everSeen.add('dies')
          if (/enchants/.test(line)) everSeen.add('aura')
        }
        if (s.game.step === 'discard') everSeen.add('discardStep')
        if (s.game.stack.length > 1) everSeen.add('response')
        if (s.game.combat?.blocks.length) everSeen.add('block')
        const g = s.game
        if (g.seatOrder.some((id) => g.players[id].mulligans > 0)) everSeen.add('mulligan')
      }
      expect(s.status).toBe('completed')
      everSeen.add(`end:${s.game.endReason}`)
      expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      // The redaction hooks never throw on any position reached.
      for (const viewer of [...s.game.seatOrder, null]) gameDefinition.redactGame(s, viewer)
    })
  }

  it('between them, reached every action, blocks, responses, counters, auras, discards, mulligans and a game ended on life', () => {
    expect([...everSeen]).toEqual(
      expect.arrayContaining([
        'CHOOSE_DECK',
        'MULLIGAN',
        'KEEP',
        'PLAY_LAND',
        'CAST',
        'ACTIVATE',
        'PASS',
        'DECLARE_ATTACKERS',
        'DECLARE_BLOCKERS',
        'block',
        'dies',
        'aura',
        'counter',
        'end:life',
        'discardStep',
        'DISCARD',
        'response',
        'specterDiscard',
        'mulligan',
      ]),
    )
  })
})
