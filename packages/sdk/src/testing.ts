// Test helpers for game packages and the platform — the SDK's `testing` entry
// point. Not imported by any runtime code.

import type { Action } from './actions.ts'
import { applyAction } from './applyAction.ts'
import type { PlayerSeed } from './createGame.ts'
import type { GameState } from './types.ts'

const NAMES = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi']
const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#06b6d4', '#ec4899']

/** `count` seats with ids `p1..pN` (Alice, Bob, Carol, ...), in seat order — pass to createNewGame's `players`. */
export function seatPlayers(count: number): PlayerSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    authUserId: `auth_${i + 1}`,
    displayName: NAMES[i] ?? `Player ${i + 1}`,
    color: COLORS[i % COLORS.length],
  }))
}

/** applyAction, throwing on rejection so a test fails loudly at the step that went wrong. Keeps the caller's own state type. */
export function act<S extends GameState<unknown, unknown>, A extends Action>(state: S, action: A): S {
  const result = applyAction(state, action)
  if (!result.ok) throw new Error(`${action.type} rejected: ${result.error}`)
  return result.state as S
}

/** A GameState with every log entry's timestamp blanked, for comparing states produced at different moments. */
export function withoutTimestamps<S extends GameState<unknown, unknown>>(state: S): S {
  return { ...state, actionHistory: state.actionHistory.map((entry) => ({ ...entry, timestamp: '' })) }
}
