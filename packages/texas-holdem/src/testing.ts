// Test helpers for Texas Hold'em — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { amountToCall, FULL_DECK, gameDefinition, withEnvelope, type GameState } from './rules.ts'
import type { Card, GameAction, GameData, GameOptions } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream for tests (an LCG) — never used by the rules themselves. */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/** A draw that makes `random.int(0, size - 1)` return `index`. */
function drawIndex(index: number, size: number): number {
  return Math.floor(((index + 0.5) / size) * 4294967296)
}

/** Every card the hand in `game` has dealt so far — what a draw can't return. */
export function usedCards(game: GameData): Card[] {
  return [...game.board, ...game.seatOrder.flatMap((id) => game.players[id].hole.filter((c): c is Card => c !== null))]
}

/**
 * A source whose next draws deal exactly `cards`, in order, from a hand that
 * has already dealt `used` (the rules draw each card from the undealt ones in
 * FULL_DECK order, RULES.md AMBIG-1). Once they're dealt it carries on with
 * `testRandom(seed)`, so a move that goes on to deal a new hand still works.
 */
export function stacked(cards: readonly Card[], used: readonly Card[] = [], seed = 1): Uint32Source {
  const remaining = FULL_DECK.filter((card) => !used.includes(card))
  const queue = [...cards]
  const rest = testRandom(seed)
  return () => {
    const card = queue.shift()
    if (card === undefined) return rest()
    const index = remaining.indexOf(card)
    if (index === -1) throw new Error(`${card} has already been dealt.`)
    remaining.splice(index, 1)
    return drawIndex(index, remaining.length + 1)
  }
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults:
 * 3 players, live, the default options, a seeded deal. `deal` draws exactly
 * those cards first, in the order the rules deal: one card each starting
 * after the button (the first seat), then round again.
 */
export function newGame(params: { players?: number; playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; seed?: number; deal?: Card[] } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: { ...gameDefinition.defaultOptions, ...params.options },
    players: seatPlayers(params.players ?? 3),
    setupRandom: params.deal ? stacked(params.deal, [], params.seed) : testRandom(params.seed ?? 1),
  }) as GameState
}

/** applyAction, throwing on rejection; `random` is a seed or a source (e.g. `stacked(...)`). */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/** The player to act does `type` (with `amount` for a BET). */
export function move(state: GameState, type: GameAction['type'], amount?: number, random: number | Uint32Source = 7): GameState {
  const playerId = state.game.toActId!
  const action = (type === 'BET' ? { type, playerId, amount: amount! } : { type, playerId }) as GameAction
  return play(state, action, random)
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

/** The simplest legal move for whoever must act: check if free, else call. */
export function simplestMove(state: GameState): GameAction {
  const playerId = state.game.toActId
  if (!playerId) throw new Error('Nobody is to act.')
  return amountToCall(state.game, playerId) > 0 ? { type: 'CALL', playerId } : { type: 'CHECK', playerId }
}
