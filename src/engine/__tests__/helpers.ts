// Shared fixtures for tests of the framework (src/engine/) and the example
// game (src/game/). Not a test file itself — vitest's default `include`
// only matches `*.test.*`.

import type { Action } from '../actions'
import { applyAction } from '../applyAction'
import { createNewGame } from '../createGame'
import type { GameState, PlayMode } from '../types'
import type { GameOptions } from '../../game/types'

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316']

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...), in seat
 * order. Defaults: 2 players, live, hidden information off, the game's
 * default options.
 */
export function newGame(params: { players?: number; playMode?: PlayMode; hiddenInformationEnabled?: boolean; options?: GameOptions; gameId?: string } = {}): GameState {
  const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank']
  const count = params.players ?? 2
  return createNewGame({
    gameId: params.gameId ?? 'game_1',
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: params.options,
    players: Array.from({ length: count }, (_, i) => ({
      id: `p${i + 1}`,
      authUserId: `auth_${i + 1}`,
      displayName: names[i],
      color: COLORS[i],
    })),
  })
}

/** applyAction, throwing on rejection so a test fails loudly at the step that went wrong. */
export function act(state: GameState, action: Action): GameState {
  const result = applyAction(state, action)
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error}`)
  return result.state
}

export function pick(state: GameState, playerId: string, value: number): GameState {
  return act(state, { type: 'PICK_NUMBER', playerId, value })
}

/** Submits every pick in `values`, in key order. */
export function pickAll(state: GameState, values: Record<string, number>): GameState {
  return Object.entries(values).reduce((s, [playerId, value]) => pick(s, playerId, value), state)
}

/** A GameState with every log entry's timestamp blanked, for comparing states produced at different moments. */
export function withoutTimestamps(state: GameState): GameState {
  return { ...state, actionHistory: state.actionHistory.map((entry) => ({ ...entry, timestamp: '' })) }
}
