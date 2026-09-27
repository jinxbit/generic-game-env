// Who a `game_state` UPDATE newly owes a turn to — the decision behind both
// turn pings, notify-discord-turn and notify-web-push. Both functions keep
// their own delivery code (Discord webhook vs. Web Push) but share this, so
// the two can't drift apart: they were separate hand-kept copies once, and
// one had already silently diverged from the other.
//
// Game-agnostic: "whose turn" is the game-maintained `pendingPlayerIds`
// (src/engine/types.ts — every player who may act right now, sequential or
// simultaneous), diffed across the write. Nothing here knows which game is
// being played beyond its phase label (GameDefinition.describePhase, looked
// up by the room's `game_type`).
//
// Works from the webhook payload's *stored* row, not a full GameState: a
// rule-enforced game stores its state gzipped under `__gz` with only
// status/phase/turn/pendingPlayerIds/activePlayerId/turnOrder duplicated in
// plaintext (src/lib/gameStateCompression.ts), so these functions read only
// those fields. src/test/__tests__/turnNotify.test.ts checks them against the
// engine's own pendingActorIds() (src/engine/turnOrder.ts) on both
// encodings — keep the two in sync; the test fails if they aren't.

import { findGameDefinition } from '@game-platform/sdk'
import './games.ts'

/** The fields of GameState these functions read — all in a compressed row's plaintext. */
export interface GameState {
  status: 'lobby' | 'active' | 'completed'
  phase: string | null
  /** Game-defined turn/round counter. */
  turn: number
  activePlayerId: string | null
  pendingPlayerIds: string[]
  turnOrder: string[]
}

/** A `game_state` row as a Database Webhook delivers it in `record`/`old_record`. */
export interface GameStateRow {
  game_id: string
  state: GameState
  active_player_id: string | null
}

/** Mirrors src/engine/turnOrder.ts's pendingActorIds(). */
export function pendingActorIds(state: GameState): string[] {
  return state.status === 'active' ? (state.pendingPlayerIds ?? []) : []
}

/** Players owed a turn after this write who weren't before it — the ones to ping. */
export function newlyPendingActorIds(oldRow: GameStateRow, newRow: GameStateRow): string[] {
  const wasPending = new Set(pendingActorIds(oldRow.state))
  return pendingActorIds(newRow.state).filter((id) => !wasPending.has(id))
}

// A game_state UPDATE that moves the state to `completed` is the "game
// finished" event. `status` is one of the fields gameStateCompression.ts
// duplicates in plaintext alongside a rule-enforced game's gzipped state, so
// this reads correctly on both write paths without decompressing anything.
export function justFinished(oldState: GameState, newState: GameState): boolean {
  return oldState.status !== 'completed' && newState.status === 'completed'
}

/**
 * The game's own label for the current phase (e.g. "Picking"), for the ping
 * text — or null when the game has no phase to name, isn't active, or isn't
 * registered in this deployment.
 */
export function phaseLabel(state: GameState, gameType: string): string | null {
  if (state.status !== 'active' || !state.phase) return null
  return findGameDefinition(gameType)?.describePhase(state.phase) ?? null
}

/** The turn/round number to show in the ping, or null outside an active game. */
export function turnNumber(state: GameState): number | null {
  return state.status === 'active' && typeof state.turn === 'number' ? state.turn : null
}
