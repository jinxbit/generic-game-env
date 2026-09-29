// Test helpers for Magic: The Gathering — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import {
  canAttack,
  canPlayLand,
  castableNow,
  cardDef,
  colorsOf,
  DECKS,
  findPayment,
  gameDefinition,
  handOf,
  HAND_SIZE,
  isPriorityStep,
  legalTargets,
  maxX,
  permanentById,
  withEnvelope,
  type GameState,
} from './rules.ts'
import type { CardRef, Effect, GameAction, GameData, GameOptions, Permanent, PlayerId, Target } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream for tests (an LCG) — never used by the rules themselves. */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/** A fresh genesis for Alice (p1) and Bob (p2), still choosing decks. */
export function newGame(params: { playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; seed?: number } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: { ...gameDefinition.defaultOptions, ...params.options },
    players: seatPlayers(2),
    setupRandom: testRandom(params.seed ?? 1),
  }) as GameState
}

/** applyAction, throwing on rejection; `random` is a seed or a source. */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/** A game past deck choice and mulligans: p1 plays `decks[0]`, p2 `decks[1]`, both keep seven. */
export function startedGame(decks: [string, string] = ['red', 'green'], seed = 1, options: Partial<GameOptions> = {}): GameState {
  let s = newGame({ seed, options })
  s = play(s, { type: 'CHOOSE_DECK', playerId: 'p1', deck: decks[0] }, seed)
  s = play(s, { type: 'CHOOSE_DECK', playerId: 'p2', deck: decks[1] }, seed + 1)
  s = play(s, { type: 'KEEP', playerId: 'p1', bottom: [] }, seed + 2)
  return play(s, { type: 'KEEP', playerId: 'p2', bottom: [] }, seed + 3)
}

/**
 * Arranges a position without logging an action: edits a deep copy of the
 * game slice, then rederives the envelope. For setting up rules tests only.
 */
export function arrange(state: GameState, edit: (game: GameData) => void): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameData
  edit(game)
  return withEnvelope(state, game)
}

let nextTestCard = 900

/** A card ref for `def` owned by `owner` — for arranging hands and battlefields. */
export function card(owner: PlayerId, def: string): CardRef {
  return { id: `${owner}-${nextTestCard++}`, def }
}

/** Puts a permanent onto the battlefield (untapped, not summoning sick unless asked). */
export function put(game: GameData, owner: PlayerId, def: string, extra: Partial<Permanent> = {}): Permanent {
  const c = card(owner, def)
  const p: Permanent = { id: c.id, def, owner, controller: owner, tapped: false, sick: false, damage: 0, attachedTo: null, eot: { power: 0, toughness: 0, keywords: [] }, ...extra }
  game.battlefield.push(p)
  return p
}

/** Gives `owner` these cards in hand. */
export function give(game: GameData, owner: PlayerId, ...defs: string[]): CardRef[] {
  const cards = defs.map((def) => card(owner, def))
  game.players[owner].hand.push(...cards)
  return cards
}

/**
 * An empty main phase for p1: no battlefield, 20 cards left in each
 * library, p1 to act, and one basic land in each hand — so neither player
 * passes automatically (RULES.md AMBIG-4) until a test says so. The base
 * for scenario tests.
 */
export function blankBoard(decks: [string, string] = ['red', 'green']): GameState {
  return arrange(startedGame(decks), (g) => {
    for (const id of g.seatOrder) {
      const p = g.players[id]
      p.library = [...(p.library as CardRef[]), ...(p.hand as CardRef[])].slice(0, 20)
      p.hand = [card(id, id === 'p1' ? 'mountain' : 'forest')]
      p.landsPlayed = 0
    }
    g.battlefield = []
    g.activeId = 'p1'
    g.priorityId = 'p1'
    g.step = 'main1'
    g.passed = []
    g.turnNumber = 3
  })
}

const HARMFUL: Effect['kind'][] = ['damage', 'destroy', 'exileGainLife', 'bounce', 'counter']

/** A target the bot likes for a spell or ability with these effects: the opponent's side for harm, its own for help. */
function preferredTarget(game: GameData, me: PlayerId, targets: Target[], effects: readonly Effect[]): Target | null {
  const harmful = effects.some((e) => HARMFUL.includes(e.kind))
  const mine = (t: Target) => {
    if (t.kind === 'player') return t.id === me
    if (t.kind === 'spell') return game.stack.find((s) => s.id === t.id)?.controller === me
    if (t.kind === 'card') return true
    return permanentById(game, t.id)?.controller === me
  }
  return targets.find((t) => mine(t) !== harmful) ?? null
}

/** The first spell in hand the bot would cast right now, with its targets and X. */
export function castCandidate(state: GameState, me: PlayerId): GameAction | null {
  const g = state.game
  for (const c of handOf(g, me)) {
    const def = cardDef(c.def)
    if (!castableNow(g, me, c.def)) continue
    const x = def.cost?.x ? maxX(g, me, def.cost) : 0
    if (x < 0 || !findPayment(g, me, def.cost!, x)) continue
    if (def.cost?.x && x === 0) continue
    let targets: Target[] = []
    if (def.target) {
      const effects = def.aura ? ([{ kind: 'pump', who: 'target', power: 0, toughness: 0 }] as Effect[]) : (def.effects ?? [])
      const t = preferredTarget(g, me, legalTargets(g, me, def.target, colorsOf(c.def), c.id), effects)
      if (!t) continue
      targets = [t]
    }
    return { type: 'CAST', playerId: me, cardId: c.id, targets, ...(def.cost?.x ? { x } : {}) }
  }
  return null
}

/**
 * A simple, deterministic bot for whoever must act: choose the first deck,
 * keep, play a land, cast the first spell it can (aiming harm at the
 * opponent), attack with everything, never block, discard the first cards.
 */
export function simplestMove(state: GameState): GameAction {
  const g = state.game
  if (g.step === 'chooseDeck') {
    const playerId = state.pendingPlayerIds[0]
    return { type: 'CHOOSE_DECK', playerId, deck: DECKS[g.seatOrder.indexOf(playerId) % DECKS.length].id }
  }
  if (g.step === 'mulligan') {
    const playerId = state.pendingPlayerIds[0]
    const hand = handOf(g, playerId)
    return { type: 'KEEP', playerId, bottom: hand.slice(0, g.players[playerId].mulligans).map((c) => c.id) }
  }
  const me = g.priorityId
  if (!me) throw new Error('Nobody is to act.')
  if (g.step === 'attack') return { type: 'DECLARE_ATTACKERS', playerId: me, attackers: g.battlefield.filter((p) => canAttack(g, p)).map((p) => p.id) }
  if (g.step === 'discard') {
    const hand = handOf(g, me)
    return { type: 'DISCARD', playerId: me, cardIds: hand.slice(0, hand.length - HAND_SIZE).map((c) => c.id) }
  }
  if (g.step === 'block' && g.stack.length === 0) return { type: 'DECLARE_BLOCKERS', playerId: me, blocks: [] }
  if (isPriorityStep(g)) {
    if (canPlayLand(g, me)) {
      const land = handOf(g, me).find((c) => cardDef(c.def).types.includes('Land'))
      if (land) return { type: 'PLAY_LAND', playerId: me, cardId: land.id }
    }
    // Don't counter or burn in response endlessly: only act on an empty stack or against the opponent's spell.
    const cast = castCandidate(state, me)
    if (cast && (g.stack.length === 0 || g.stack[g.stack.length - 1].controller !== me)) return cast
  }
  return { type: 'PASS', playerId: me }
}
