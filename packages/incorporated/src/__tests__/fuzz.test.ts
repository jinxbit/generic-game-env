// Randomised games: a bot proposes random (often illegal) moves, the rules
// must reject the illegal ones cleanly (never throw), the legal ones must keep
// every invariant, and the whole log must replay to the same state.

import { describe, expect, it } from 'vitest'
import { applyAction, createRandom, replayActions, type GameState as PlatformState, type Random } from '@game-platform/sdk'
import { COUNTRIES, INDUSTRIES, ZONES } from '../data/board'
import { CORPORATIONS } from '../data/corporations'
import { newGame, simplestMove, testRandom } from '../testing'
import type { Attack, GameAction, GameOptions, GameState, LobbyEvent, Move } from '../types'

const IDS = COUNTRIES.map((c) => c.id)

function candidates(s: GameState, r: Random): GameAction[] {
  const g = s.game
  const prompt = g.prompt!
  const pick = <T,>(items: readonly T[]): T => r.pick(items)
  const out: GameAction[] = []
  const actor = s.pendingPlayerIds[0]
  if ((g.phase === 'investment' || g.phase === 'competition') && r.next() < 0.05) out.push({ type: 'TAKE_LOAN', playerId: pick(g.seatOrder) })
  const attack = (country: string): Attack =>
    r.next() < 0.5
      ? { kind: 'grab', country, square: r.int(0, 6) }
      : { kind: 'kill', country, target: r.next() < 0.4 ? { kind: 'square', square: r.int(0, 6) } : { kind: r.next() < 0.5 ? 'loose' : 'defender', playerId: pick(g.seatOrder) } }
  switch (prompt.kind) {
    case 'investTurn':
      for (let i = 0; i < 4; i++) out.push({ type: 'START_AUCTION', playerId: actor, country: pick(IDS), bid: r.int(2, 14) })
      out.push({ type: 'START_PRIVATE_SALE', playerId: actor, country: pick(Object.keys(g.players[actor].shares)), minPrice: r.int(0, 10) })
      out.push({ type: 'INVEST_PASS', playerId: actor })
      break
    case 'auction': {
      const base = prompt.high?.amount ?? prompt.limit
      out.push({ type: 'BID', playerId: actor, amount: prompt.mode === 'reverse' ? base - r.int(1, 4) : base + r.int(0, 5) })
      out.push({ type: 'PASS_BID', playerId: actor })
      break
    }
    case 'sealedAuction':
      out.push({ type: 'SEALED_BID', playerId: actor, auctionId: prompt.auctionId, amount: r.int(0, Math.max(0, g.players[actor].cash ?? 0)) })
      break
    case 'competitionTurn': {
      const loose = IDS.filter((id) => (g.countries[id].loose[actor] ?? 0) > 0)
      if (loose.length) {
        const c = pick(loose)
        out.push({ type: 'FIGHT', playerId: actor, attacks: r.next() < 0.5 ? [attack(c)] : [attack(c), attack(c)] })
        const moves: Move[] = [{ from: c, to: pick(IDS) }]
        if (r.next() < 0.5) moves.push({ from: moves[0].to, to: pick(IDS) })
        out.push({ type: 'EXPAND', playerId: actor, moves })
      }
      if (g.players[actor].executives > 0) out.push({ type: 'DEFEND', playerId: actor, country: pick(IDS) })
      if (r.next() < 0.3) out.push({ type: 'COMPETITION_PASS', playerId: actor, defenders: Array.from({ length: g.players[actor].executives }, () => pick(IDS)) })
      break
    }
    case 'freeAttack':
      out.push({ type: 'FREE_ATTACK', playerId: actor, attacks: [attack(prompt.country), attack(prompt.country)].slice(0, r.int(0, 2)) })
      break
    case 'lobbyTurn': {
      const events: LobbyEvent[] = [
        { kind: 'powerPlay', zone: pick(ZONES), camp: r.next() < 0.5 ? 'NATO' : 'SCO' },
        { kind: 'powerPlay', zone: pick(ZONES), camp: r.next() < 0.5 ? 'NATO' : 'SCO' },
        { kind: 'centralBanks', slider: r.next() < 0.5 ? 'interest' : 'stress', direction: r.next() < 0.5 ? 1 : -1 },
        { kind: 'budget', mode: 'austerity', discardIndex: r.int(0, 3) },
        { kind: 'budget', mode: 'stimulus' },
        { kind: 'rd', country: pick(IDS), square: r.int(0, 6) },
        { kind: 'subsidies' },
      ]
      for (const event of events) out.push({ type: 'LOBBY', playerId: actor, event })
      if (prompt.canDefer) out.push({ type: 'DEFER_EXECUTIVE', playerId: actor })
      break
    }
    case 'chooseSquare':
      out.push({ type: 'CHOOSE_SQUARE', playerId: actor, square: prompt.optional && r.next() < 0.5 ? null : pick(prompt.options) })
      break
    case 'removeCubes':
      out.push({ type: 'REMOVE_CUBES', playerId: actor, cubes: r.shuffle(prompt.options).slice(0, prompt.count) })
      break
    case 'moveMarker':
      out.push({ type: 'MOVE_MARKER', playerId: actor, country: pick(prompt.options) })
      break
    case 'subsidies':
      out.push({ type: 'SUBSIDIES_SWAP', playerId: actor, peekIndex: r.int(0, prompt.peek.length - 1), revealedIndex: r.int(0, g.revealed.length - 1) })
      break
    case 'stimulus':
      out.push({ type: 'STIMULUS_KEEP', playerId: actor, index: r.int(0, 1) })
      break
    case 'outlookChoice':
      out.push({ type: 'OUTLOOK_CHOICE', playerId: actor, choice: pick(prompt.options) })
      break
    case 'useAbility':
      out.push({ type: 'USE_ABILITY', playerId: actor, use: r.next() < 0.5 })
      break
    case 'pickOutlook':
      out.push({ type: 'PICK_OUTLOOK', playerId: actor, index: r.int(0, 1) })
      break
    case 'crisisDecision':
      out.push({ type: 'CRISIS_DECISION', playerId: actor, decision: pick(['accept', 'reroll', 'noCrisis'] as const) })
      break
    case 'crisisDiscard':
      out.push({ type: 'CRISIS_DISCARD', playerId: actor, indices: r.shuffle(g.revealed.map((_, i) => i)).slice(0, prompt.count) })
      break
    case 'repayment':
      out.push({ type: 'REPAY', playerId: actor, promptId: prompt.promptId, count: r.int(0, g.players[actor].bonds) })
      break
    default:
      break
  }
  return r.shuffle(out)
}

function checkInvariants(s: GameState): void {
  const g = s.game
  for (const id of g.seatOrder) {
    const p = g.players[id]
    const corp = CORPORATIONS.find((c) => c.id === p.corp)!
    let onBoard = 0
    let fortified = 0
    for (const c of Object.values(g.countries)) {
      onBoard += c.squares.filter((q) => q.occupant === id).length + (c.loose[id] ?? 0)
      fortified += c.squares.filter((q) => q.occupant === id && q.fortified).length
      expect(c.loose[id] ?? 0).toBeGreaterThanOrEqual(0)
    }
    // Every cube is in supply, on the board, or spent fortifying (⚑ ACCUM_RD).
    expect(p.supply + onBoard).toBeLessThanOrEqual(corp.cubes)
    expect(p.supply + onBoard + fortified).toBeGreaterThanOrEqual(corp.cubes - fortified)
    expect(p.supply).toBeGreaterThanOrEqual(0)
    expect(p.executives).toBeGreaterThanOrEqual(0)
    expect(p.executives).toBeLessThanOrEqual(p.executiveCount)
    expect(p.bonds).toBeGreaterThanOrEqual(0)
    if (s.status === 'active') expect(p.cash).toBeGreaterThanOrEqual(0)
  }
  const held = Object.values(g.players).reduce((sum, p) => sum + Object.values(p.shares).reduce((a, b) => a + b, 0), 0)
  const banked = Object.values(g.bank).reduce((a, b) => a + b, 0)
  expect(held + banked).toBeLessThanOrEqual(30)
  if (g.retiredMajors.length === 0) expect(held + banked).toBe(30)
  expect(Object.values(g.players).reduce((sum, p) => sum + p.bonds, 0)).toBeLessThanOrEqual(25)
  expect(g.payoffDeck.length + g.payoffDiscard.length + g.revealed.length + (g.prompt?.kind === 'subsidies' ? g.prompt.peek.length : 0) + (g.prompt?.kind === 'stimulus' ? g.prompt.drawn.length : 0)).toBe(25)
  for (const industry of INDUSTRIES) expect([...g.payoffDeck, ...g.payoffDiscard, ...g.revealed].filter((c) => c === industry).length).toBeLessThanOrEqual(5)
  if (s.status === 'active') expect(s.pendingPlayerIds.length).toBeGreaterThan(0)
}

const OPTION_SETS: Partial<GameOptions>[] = [
  {},
  { threeRounds: true, freeCubes: true },
  { threeRounds: true, freeCubes: true, r3SalesMode: 'reverseOnly', dontStall: true },
  { factionTweaks: true, closedAuctionSco: true, qeHyperinflation: true },
  { accumRd: true, lessCruelLoans: true, r3SalesMode: 'banned', threeRounds: true },
  { threeRounds: true, freeCubes: true, r3FreeCubesOne: true, dontStall: true, lessCruelLoans: true, accumRd: true, closedAuctionSco: true, qeHyperinflation: true, factionTweaks: true },
]

describe('random games', () => {
  for (const [n, options] of OPTION_SETS.entries()) {
    for (const players of [2, 3, 4]) {
      it(`${players} players, option set ${n}, with a concession in the 3-player games`, () => {
        const r = createRandom('fuzz', n, players)
        let s = newGame({ players, options, seed: n * 10 + players })
        const genesis = s
        const concedeAt = players === 3 ? r.int(20, 120) : -1
        for (let step = 0; step < 3000 && s.status === 'active'; step++) {
          if (step === concedeAt) {
            const result = applyAction(s as PlatformState, { type: 'CONCEDE', playerId: r.pick(s.game.seatOrder) }, { random: testRandom(step) })
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
            const result = applyAction(s as PlatformState, simplestMove(s), { random: testRandom(step + 1) })
            if (!result.ok) throw new Error(`simplest move rejected at ${JSON.stringify(s.game.prompt)}: ${result.error}`)
            s = result.state as GameState
          }
          checkInvariants(s)
        }
        if (process.env.FUZZ_STATS) console.log(players, n, JSON.stringify(Object.entries(s.actionHistory.reduce((m: Record<string, number>, e) => ({ ...m, [e.action.type]: (m[e.action.type] ?? 0) + 1 }), {}))), s.game.finalScores && Object.values(s.game.finalScores).map((f) => f.total))
        expect(s.status).toBe('completed')
        expect(s.game.finalScores).not.toBeNull()
        expect(replayActions(genesis as PlatformState, s.actionHistory)).toEqual(s)
      })
    }
  }
})
