// Test helpers for Magna Grecia — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { allowanceLeft, analyse, gameDefinition, legalCityCells, legalRoads, withEnvelope, type GameState } from './rules.ts'
import type { GameAction, GameData, GameOptions } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream for tests (an LCG) — never used by the rules themselves. */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults:
 * 4 players, live, the default options. `seed` drives the setup draws
 * (oracles and the first card).
 */
export function newGame(params: { players?: number; playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; seed?: number } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: params.options,
    players: seatPlayers(params.players ?? 4),
    setupRandom: testRandom(params.seed ?? 1),
  }) as GameState
}

/** applyAction, throwing on rejection; `random` is a seed or a source. */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/**
 * Arranges a position without logging an action: edits a copy of the game
 * slice, then recomputes the envelope. For setting up rules tests only.
 */
export function arrange(state: GameState, edit: (game: GameData) => void): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameData
  edit(game)
  return withEnvelope(state, game)
}

/**
 * A simple, always-legal move for the turn player: a city tile if one fits,
 * else a road, else a full resupply, else end the turn. Every turn ends, so a
 * game played with it always finishes.
 */
export function simplestMove(state: GameState): GameAction {
  const g = state.game
  const actor = g.turnPlayerId
  if (!actor || state.status !== 'active') throw new Error('The game is over.')
  const [city] = legalCityCells(g, analyse(g))
  if (city !== undefined) return { type: 'PLACE_CITY', playerId: actor, cell: city }
  const [road] = legalRoads(g)
  if (road) return { type: 'PLACE_ROAD', playerId: actor, cell: road.cell, ends: road.ends }
  const p = g.players[actor]
  const left = allowanceLeft(g).resupply
  if (left > 0 && p.staging.roads + p.staging.cities > 0) {
    const roads = Math.min(p.staging.roads, Math.ceil(left / 2))
    const cities = Math.min(p.staging.cities, left - roads)
    if (roads + cities > 0) return { type: 'RESUPPLY', playerId: actor, roads, cities }
  }
  return { type: 'END_TURN', playerId: actor }
}
