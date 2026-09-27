/**
 * Rebuilds everything the delta read path needs to replay actions locally,
 * from a cached `GameState` alone — no network, no waiting for the roster.
 *
 * WHY THIS EXISTS: `GamePage.tsx`'s mount effect fetches the game state and
 * the players roster together, so at the moment the state request goes out
 * `players` is still empty and genesis can't be built from the roster. A
 * cold open — which for async play is *most* opens — would otherwise fall
 * back to a full response every time.
 *
 * The way out is that none of it actually needs the table. `buildGenesisState`
 * reads exactly four player columns (`GenesisPlayerInput`), and a cached
 * `GameState`'s own `players` carry all four — as it carries the random
 * numbers setup drew (`setupRandom`). So genesis is reconstructable
 * from the cache plus the `games` row, which the mount effect already has in
 * hand before it runs.
 *
 * A stale cache is not a hazard here. If the roster changed since it was
 * written, the reconstructed genesis differs, the replay lands somewhere the
 * server disagrees with, the hash check fails, and the client pays for one
 * full fetch — the same fallback every other mismatch takes.
 */
import { buildGenesisState } from './gameGenesis'
import type { GameRow } from './dbTypes'
import type { GameState } from '@game-platform/sdk'
/**
 * Everything `getGameStateRedacted` needs to rebuild a state from actions
 * rather than be handed one. Lives here rather than in gameApi.ts so it can be
 * built and tested without importing the Supabase client, which throws at
 * import time when the app's env vars are absent.
 */
export interface DeltaReplayContext {
  genesis: GameState
}

/**
 * `null` when genesis cannot be rebuilt — a state with no players, or a
 * `games` row whose settings no longer describe a game this engine can
 * construct. Both mean "ask for a full state", never an error.
 */
export function buildDeltaReplayContextFromState(game: GameRow, state: GameState): DeltaReplayContext | null {
  if (state.players.length === 0) return null
  try {
    const genesis = buildGenesisState(
      game,
      state.players.map((player) => ({
        id: player.id,
        user_id: player.authUserId,
        display_name: player.displayName,
        color: player.color,
      })),
      state.setupRandom,
    )
    return { genesis }
  } catch {
    return null
  }
}
