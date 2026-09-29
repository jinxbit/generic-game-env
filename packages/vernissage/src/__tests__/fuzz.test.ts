// Randomised games: a bot proposes random (often illegal) moves, the rules
// must reject the illegal ones cleanly (never throw), the legal ones must keep
// every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import {
  allowedKinds,
  ARTISTS,
  availableValues,
  COUNTER_COPIES,
  COUNTER_KINDS,
  COUNTER_MAX,
  FAME_MAX,
  gameDefinition,
  influencedArtists,
  IN_FROM,
  TOP_STEP,
  type GameState,
} from '../rules'
import { handOf, newGame, simplestMove, testRandom } from '../testing'
import type { GameAction } from '../types'

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const actor = r.next() < 0.03 ? r.pick(g.seatOrder) : s.pendingPlayerIds[0]
  const hand = handOf(s, actor)
  const out: GameAction[] = []
  switch (g.step) {
    case 'place': {
      const artists = influencedArtists(g, actor)
      const kinds = allowedKinds(g, g.fate!)
      const kind = kinds.length ? r.pick(kinds) : 'purchase'
      const values = availableValues(g, kind)
      out.push({ type: 'PLACE_COUNTER', playerId: actor, artist: r.pick(ARTISTS), kind: r.pick(COUNTER_KINDS), value: r.int(0, 8) })
      if (artists.length && values.length) out.push({ type: 'PLACE_COUNTER', playerId: actor, artist: r.pick(artists), kind, value: r.pick(values) })
      break
    }
    case 'objections': {
      const values = availableValues(g, g.dispute!.counter.kind).filter((v) => v !== g.dispute!.counter.value)
      if (values.length && r.next() < 0.6) out.push({ type: 'RESPOND', playerId: actor, value: r.pick(values) })
      out.push({ type: 'RESPOND', playerId: actor, value: null })
      break
    }
    case 'negotiate': {
      const proposals = Object.values(g.dispute!.responses).filter((v): v is number => v !== null)
      if (r.next() < 0.3) out.push({ type: 'NEGOTIATE', playerId: actor, value: r.pick(proposals) })
      out.push({ type: 'NEGOTIATE', playerId: actor, value: null })
      break
    }
    case 'challenge':
      out.push({ type: 'CHALLENGE', playerId: actor, challenge: r.next() < 0.7 })
      break
    case 'trial':
      out.push({ type: 'COMMIT_MIGHT', playerId: actor, count: r.int(0, hand.filter((c) => c.kind === 'might').length + 1) })
      break
    case 'display':
      out.push({ type: 'DISPLAY', playerId: actor, count: r.int(0, 3) })
      break
    case 'buy':
      out.push(r.next() < 0.5 ? { type: 'BUY_PILE', playerId: actor, pile: r.int(-1, 7) } : { type: 'BUY_GREY', playerId: actor })
      break
    case 'choose': {
      const pile = g.piles[g.choosing!]
      out.push({ type: 'TAKE_CARD', playerId: actor, cardId: r.next() < 0.1 ? null : (r.pick(pile)?.id ?? null) })
      break
    }
    case 'play': {
      const critic = hand.find((c) => c.kind === 'critic')
      if (critic && r.next() < 0.5) out.push({ type: 'PLAY_CRITIC', playerId: actor, cardId: critic.id, artist: r.pick(ARTISTS) })
      const limited = hand.find((c) => c.kind === 'limited')
      if (limited && r.next() < 0.3) out.push({ type: 'PLAY_LIMITED', playerId: actor, cardId: limited.id, agent: r.int(0, 2), to: r.int(0, TOP_STEP + 1) })
      if (r.next() < 0.3) out.push({ type: 'END_TURN', playerId: actor })
      break
    }
    default:
      break
  }
  return out
}

function checkInvariants(s: GameState): void {
  const g = s.game
  // Every counter is in the pool, in front of an artist, or under dispute.
  for (const kind of COUNTER_KINDS) {
    for (let v = 1; v <= COUNTER_MAX[kind]; v++) {
      const onBoard = ARTISTS.reduce((n, a) => n + g.artists[a].counters.filter((c) => c.kind === kind && c.value === v).length, 0)
      const disputed = g.dispute && g.dispute.counter.kind === kind && g.dispute.counter.value === v ? 1 : 0
      expect(g.pool[kind][v - 1] + onBoard + disputed).toBe(COUNTER_COPIES)
      expect(g.pool[kind][v - 1]).toBeGreaterThanOrEqual(0)
    }
  }
  for (const a of ARTISTS) {
    const artist = g.artists[a]
    expect(artist.step).toBeGreaterThanOrEqual(1)
    expect(artist.step + artist.counters.length).toBeLessThanOrEqual(TOP_STEP)
    if (artist.out) expect(artist.fame).toBe(0)
    else {
      expect(artist.fame).toBeGreaterThan(0)
      expect(artist.fame).toBeLessThan(IN_FROM)
    }
    expect(artist.fame).toBeLessThanOrEqual(FAME_MAX)
  }
  if (g.feather) expect(g.artists[g.feather].out).toBe(false)
  // Every card is somewhere, exactly once.
  const ids = [
    ...Object.values(g.players).flatMap((p) => [...p.hand, ...p.shown]),
    ...g.piles.flat(),
    ...g.aside,
    ...g.greyDeck,
    ...g.greyDiscard,
    ...Object.values(g.trial?.might ?? {}).flat(),
  ].map((c) => c!.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of g.seatOrder) {
    const agents = g.players[id].agents.filter((x) => x !== null)
    expect(new Set(agents).size).toBe(agents.length)
    expect(g.players[id].cash).toBeGreaterThanOrEqual(0)
  }
  if (s.status !== 'active') {
    expect(s.pendingPlayerIds).toEqual([])
    return
  }
  expect(s.pendingPlayerIds.length).toBeGreaterThan(0)
  for (const id of s.pendingPlayerIds) expect(s.players.find((p) => p.id === id)!.eliminated).toBe(false)
  expect(g.dispute !== null).toBe(['objections', 'negotiate', 'challenge', 'trial'].includes(g.step))
}

const everSeen = new Set<string>()

describe('random games', () => {
  for (const players of [3, 4, 5]) {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      it(`${players} players, seed ${seed}${players === 4 ? ', with a concession' : ''}`, () => {
        const r = createRandom('vernissage-fuzz', players, seed)
        let s = newGame({ players, seed, options: { mightVariant: seed % 2 === 0 } })
        const genesis = s
        const concedeAt = players === 4 ? r.int(10, 150) : -1
        for (let step = 0; step < 6000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: r.pick(s.turnOrder) }, { random: testRandom(step) })
            if (!result.ok) throw new Error(`CONCEDE rejected: ${result.error}`)
            s = result.state as GameState
            checkInvariants(s)
            everSeen.add(`concede:${s.game.step}`)
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
            const move = simplestMove(s)
            const result = applyAction(s as PlatformState, move, { random: testRandom(step) })
            if (!result.ok) throw new Error(`simplest move ${move.type} rejected in ${s.game.step}: ${result.error}`)
            s = result.state as GameState
            everSeen.add(move.type)
          }
          checkInvariants(s)
          everSeen.add(s.game.step)
          if (s.game.lastTrial) everSeen.add(`trial:${s.game.lastTrial.winner}`)
          if (ARTISTS.some((a) => s.game.artists[a].out)) everSeen.add('out')
          if (s.game.players[s.game.seatOrder[0]].notes > 0) everSeen.add('note')
        }
        expect(s.status).toBe('completed')
        expect(s.game.finalAssets).not.toBeNull()
        expect(s.winnerPlayerIds.length).toBeGreaterThan(0)
        everSeen.add(`end:${s.game.endReason}`)
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
        // Every entry narrates something.
        for (const entry of s.actionHistory) expect(entry.action.type).toBeTruthy()
      })
    }
  }

  it('between them, reached objections, trials both ways, IN payments and an artist OUT', () => {
    expect([...everSeen]).toEqual(
      expect.arrayContaining(['negotiate', 'challenge', 'trial', 'display', 'choose', 'COMMIT_MIGHT', 'PLAY_CRITIC', 'PLAY_LIMITED', 'trial:pro', 'trial:contra', 'out']),
    )
  })

  it('describes every kind of action without throwing', () => {
    let s = newGame()
    for (let i = 0; i < 300 && s.status === 'active'; i++) {
      const move = simplestMove(s)
      const result = applyAction(s as PlatformState, move, { random: testRandom(i) })
      if (!result.ok) throw new Error(result.error)
      const next = result.state as GameState
      expect(gameDefinition.describeAction(move, s, next).message.length).toBeGreaterThan(0)
      s = next
    }
  })
})
