import type { GameState } from './types.ts'

/**
 * Every seated player who must act before the game can move on — the
 * game-maintained `pendingPlayerIds`, but only while the game is active.
 * Used to diff "who newly needs to act" across a state transition for turn
 * notifications, and by hotseat to know who to hand the device to.
 */
export function pendingActorIds(state: GameState): string[] {
  return state.status === 'active' ? state.pendingPlayerIds : []
}

/** Whichever seated player must act next — the head of pendingActorIds(), or null once nobody is pending. */
export function currentActorId(state: GameState): string | null {
  return pendingActorIds(state)[0] ?? null
}
