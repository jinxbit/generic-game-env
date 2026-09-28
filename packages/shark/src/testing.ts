// Test helpers for Shark — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { COLOUR_DIE, COLOURS, gameDefinition, gameDefinitionV1, maxForcedSale, placementsForRoll, pricesOf, withEnvelope, type GameState } from './rules.ts'
import type { ColourFace, GameAction, GameData, GameOptions } from './types.ts'

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
function face(index: number, sides: number): number {
  return Math.floor(((index + 0.5) / sides) * 4294967296)
}

/** A source whose next ROLL shows `colour` (the first white face for 'white') and `zone`. */
export function dice(colour: ColourFace, zone: number): Uint32Source {
  const queue = [face(COLOUR_DIE.indexOf(colour), COLOUR_DIE.length), face(zone - 1, 6)]
  return () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('No more dice queued')
    return next
  }
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults:
 * 3 players, live, the default options, the newest rules version.
 * Registers every rules version first.
 */
export function newGame(params: { players?: number; playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; rulesVersion?: number } = {}): GameState {
  registerGame(gameDefinition)
  registerGame(gameDefinitionV1)
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    rulesVersion: params.rulesVersion,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: params.options,
    players: seatPlayers(params.players ?? 3),
  }) as GameState
}

/** applyAction, throwing on rejection; `random` is a seed or a source (e.g. `dice(...)`). */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/** The turn player rolls exactly `colour` and `zone`. */
export function roll(state: GameState, colour: ColourFace, zone: number): GameState {
  return play(state, { type: 'ROLL', playerId: state.game.turnPlayerId! }, dice(colour, zone))
}

/**
 * Arranges a position without logging an action: edits a copy of the game
 * slice, then recomputes prices from the board and the envelope from the
 * step. For setting up rules tests only.
 */
export function arrange(state: GameState, edit: (game: GameData) => void): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameData
  edit(game)
  game.prices = pricesOf(game.board)
  return withEnvelope(state, game)
}

/** The first legal move for whoever must act: roll, first legal placement, sell what's owed, end the turn. */
export function simplestMove(state: GameState): GameAction {
  const g = state.game
  const actor = state.pendingPlayerIds[0]
  switch (g.step) {
    case 'preTrade':
      return { type: 'ROLL', playerId: actor }
    case 'place': {
      const [first] = placementsForRoll(g)
      return { type: 'PLACE', playerId: actor, cell: first.cell, colour: first.colour }
    }
    case 'debts': {
      const colour = COLOURS.find((k) => maxForcedSale(g, actor, k) > 0)!
      return { type: 'FORCED_SELL', playerId: actor, colour, count: maxForcedSale(g, actor, colour) }
    }
    case 'postTrade':
      return { type: 'END_TURN', playerId: actor }
    case 'ended':
      throw new Error('The game is over.')
  }
}
