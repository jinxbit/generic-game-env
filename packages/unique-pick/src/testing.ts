// Test helpers for Unique Pick — this package's `testing` entry point, also
// used by the platform's own tests, which play this game as their fixture.

import { createNewGame, registerGame, type PlayMode } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { gameDefinition, type GameState } from './rules.ts'
import type { GameOptions } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...), in seat
 * order. Defaults: 2 players, live, hidden information off, the game's
 * default options. Registers the game first, so a test needs no setup.
 */
export function newGame(params: { players?: number; playMode?: PlayMode; hiddenInformationEnabled?: boolean; options?: GameOptions; gameId?: string } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: params.gameId ?? 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: params.options,
    players: seatPlayers(params.players ?? 2),
  }) as GameState
}

export function pick(state: GameState, playerId: string, value: number): GameState {
  return act(state, { type: 'PICK_NUMBER', playerId, value })
}

/** Submits every pick in `values`, in key order. */
export function pickAll(state: GameState, values: Record<string, number>): GameState {
  return Object.entries(values).reduce((s, [playerId, value]) => pick(s, playerId, value), state)
}
