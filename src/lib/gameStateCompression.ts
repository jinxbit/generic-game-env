import { gunzipFromBase64, gzipToBase64 } from './gzip.ts'
import type { GameState } from '@game-platform/sdk'
/**
 * Compressed encoding for `game_state.state`, applied only on the write path
 * that's exclusive to `ruleEnforcementEnabled` games — see
 * `supabase/functions/_shared/gameEnforcement.ts`'s `writeGameStateCAS`. A
 * client-trusted game's direct writes (`insertGameState`/`writeGameState` in
 * `gameApi.ts`) are untouched and keep storing a plain `GameState` object:
 * only the Edge Functions (`apply-action`/`undo-action`/`redo-action`), which
 * never run for a client-trusted game, produce this shape. The column stays
 * `jsonb` either way — `{"__gz": "<base64 gzip>", ...}` is just another JSON
 * value — so every read path (shared by both kinds of game) can tell the two
 * apart per-row via `__gz`'s presence, with no migration or coordinated
 * rollout: a legacy/client-trusted row with no `__gz` key round-trips through
 * `decompressGameStateFromStorage` unchanged.
 *
 * Duplicates `status`/`phase`/`turn`/`pendingPlayerIds`/`activePlayerId`/
 * `turnOrder` in plaintext alongside the gzip blob: the
 * `game_state_sync_meta` DB trigger (the baseline migration) reads these
 * fields straight off `new.state` with `->>`/`->` — it has no way to gunzip
 * `__gz` first, so without them a rule-enforced game's `game_state_meta`
 * projection (which every listing screen's "finished"/"your turn"
 * classification reads — see gameCardView.ts) would read `status: 'unknown'`.
 * No new information exposure: these fields already sit inside the same
 * `state` column, visible to the same RLS-gated audience, just gzipped —
 * duplicating a few of them in plaintext doesn't reveal anything a reader
 * couldn't already decompress.
 */
export interface CompressedGameState {
  __gz: string
  status: GameState['status']
  phase: GameState['phase']
  turn: GameState['turn']
  pendingPlayerIds: GameState['pendingPlayerIds']
  activePlayerId: GameState['activePlayerId']
  turnOrder: GameState['turnOrder']
}

export type StoredGameState = GameState | CompressedGameState

function isCompressedGameState(value: StoredGameState): value is CompressedGameState {
  return typeof value === 'object' && value !== null && '__gz' in value
}

export async function compressGameStateForStorage(state: GameState): Promise<CompressedGameState> {
  return {
    __gz: await gzipToBase64(JSON.stringify(state)),
    status: state.status,
    phase: state.phase,
    turn: state.turn,
    pendingPlayerIds: state.pendingPlayerIds,
    activePlayerId: state.activePlayerId,
    turnOrder: state.turnOrder,
  }
}

export async function decompressGameStateFromStorage(stored: StoredGameState): Promise<GameState> {
  if (!isCompressedGameState(stored)) return stored
  return JSON.parse(await gunzipFromBase64(stored.__gz)) as GameState
}
