// Test helpers for Vernissage — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { allowedKinds, ARTISTS, availableValues, canBuyAny, FATE_DIE, gameDefinition, influencedArtists, TOP_STEP, withEnvelope, type GameState } from './rules.ts'
import type { Card, FateFace, GameAction, GameData, GameOptions } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream for tests (an LCG) — never used by the rules themselves. */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/** A draw that makes `random.int(0, sides - 1)` return `index`. */
export function face(index: number, sides: number): number {
  return Math.floor(((index + 0.5) / sides) * 4294967296)
}

/** A source that yields exactly `draws`, then fails. */
export function draws(...values: number[]): Uint32Source {
  const queue = [...values]
  return () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('No more draws queued')
    return next
  }
}

/** A source whose ROLL_FATE shows `f`. */
export function fateDie(f: FateFace): Uint32Source {
  return draws(face(FATE_DIE.indexOf(f), FATE_DIE.length))
}

/** Draws for red dice: each number 1–6 in turn. */
export function redDice(...pips: number[]): Uint32Source {
  return draws(...pips.map((n) => face(n - 1, 6)))
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults:
 * 3 players, live, the default options.
 */
export function newGame(params: { players?: number; playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; seed?: number } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: params.options,
    players: seatPlayers(params.players ?? 3),
    setupRandom: testRandom(params.seed ?? 1),
  }) as GameState
}

/** applyAction, throwing on rejection; `random` is a seed or a source. */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/**
 * Arranges a position without logging an action: edits a copy of the game
 * slice, then recomputes the envelope from the step. For rules tests only.
 */
export function arrange(state: GameState, edit: (game: GameData) => void): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameData
  edit(game)
  return withEnvelope(state, game)
}

/** The cards in `playerId`'s hand (true state). */
export function handOf(state: GameState, playerId: string): Card[] {
  return state.game.players[playerId].hand.filter((c): c is Card => c !== null)
}

/** Steps worth standing on: those of artists still in the game, lowest first. */
function artistSteps(g: GameData): number[] {
  return [...new Set(ARTISTS.filter((a) => !g.artists[a].out).map((a) => g.artists[a].step))].sort((a, b) => a - b)
}

/**
 * A step change that gains influence, if the hand has one — so a bot keeps
 * following the artists up the staircase and games end.
 */
function followArtists(state: GameState, actor: string): GameAction | null {
  const g = state.game
  const p = g.players[actor]
  if (g.stepCardPlayed) return null
  const hand = handOf(state, actor)
  const steps = artistSteps(g)
  const covered = (agents: (number | null)[]) => steps.filter((s) => agents.includes(s)).length
  const unlimited = hand.find((c) => c.kind === 'unlimited')
  if (unlimited) {
    // Cover the highest artist steps; agents already on the board stay on it.
    const targets = [...steps].reverse().slice(0, 3)
    const spare = Array.from({ length: TOP_STEP }, (_, i) => i + 1).filter((s) => !targets.includes(s))
    const agents = p.agents.map((s, i) => (i < targets.length ? targets[i] : s === null ? null : spare.shift()!))
    if (covered(agents) > covered(p.agents)) return { type: 'PLAY_UNLIMITED', playerId: actor, cardId: unlimited.id, agents }
  }
  for (const card of hand) {
    if (card.kind !== 'limited') continue
    for (let agent = 0; agent < p.agents.length; agent++) {
      for (const to of steps) {
        const from = p.agents[agent]
        const reach = from === null ? to <= card.steps : to !== from && Math.abs(to - from) <= card.steps
        const next = p.agents.map((s, i) => (i === agent ? to : s))
        if (reach && !p.agents.some((s, i) => i !== agent && s === to) && covered(next) > covered(p.agents)) {
          return { type: 'PLAY_LIMITED', playerId: actor, cardId: card.id, agent, to }
        }
      }
    }
  }
  return null
}

/** A plain legal move for whoever must act first — used by the fuzz, view and stack tests. */
export function simplestMove(state: GameState): GameAction {
  const g = state.game
  const actor = state.pendingPlayerIds[0]
  switch (g.step) {
    case 'fate':
      return { type: 'ROLL_FATE', playerId: actor }
    case 'place': {
      // Spread counters so artists hold Vernissages instead of racing one stack to the top.
      const artist = influencedArtists(g, actor).sort((a, b) => g.artists[a].counters.length - g.artists[b].counters.length)[0]
      const kind = allowedKinds(g, g.fate!)[0]
      return { type: 'PLACE_COUNTER', playerId: actor, artist, kind, value: availableValues(g, kind)[0] }
    }
    case 'objections':
      return { type: 'RESPOND', playerId: actor, value: null }
    case 'negotiate':
      return { type: 'NEGOTIATE', playerId: actor, value: null }
    case 'challenge':
      return { type: 'CHALLENGE', playerId: actor, challenge: false }
    case 'trial':
      return { type: 'COMMIT_MIGHT', playerId: actor, count: 0 }
    case 'display': {
      const artist = g.display!.artist
      return { type: 'DISPLAY', playerId: actor, count: handOf(state, actor).filter((c) => c.kind === 'work' && c.artist === artist).length }
    }
    case 'buy': {
      const pile = g.piles.findIndex((p) => p.length > 0)
      const greyLeft = g.greyDeck.length + g.greyDiscard.length > 0
      if (!canBuyAny(g)) throw new Error('Nothing to buy in the buy step.')
      return greyLeft && (pile < 0 || state.turn % 2 === 0) ? { type: 'BUY_GREY', playerId: actor } : { type: 'BUY_PILE', playerId: actor, pile }
    }
    case 'choose': {
      const pile = g.piles[g.choosing!].filter((c): c is Card => c !== null)
      const preferred = pile.find((c) => c.kind === 'unlimited') ?? pile.find((c) => c.kind === 'work') ?? pile[0]
      return { type: 'TAKE_CARD', playerId: actor, cardId: preferred?.id ?? null }
    }
    case 'play':
      return followArtists(state, actor) ?? { type: 'END_TURN', playerId: actor }
    case 'ended':
      throw new Error('The game is over.')
  }
}
