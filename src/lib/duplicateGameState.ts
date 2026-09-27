// "Duplicate as hot seat" / "import a game export": the new room's players
// rows get brand-new ids (players.id is a globally-unique PK, not scoped per
// game — see the baseline migration's players table), so every reference to a
// source-game player id inside its GameState has to be rewritten onto the new
// roster before the state can be seeded into the new room. Kept here as a
// small, DB-free module (mirrors gameGenesis.ts) so it can be unit-tested
// without a live Supabase project — gameApi.ts's duplicateGameAsHotseat and
// importGameExportAsHotseat are the callers.

import type { GameState } from '@game-platform/sdk'
/**
 * Rewrites every player-id reference inside a GameState onto a new roster —
 * players[].id, activePlayerId, pendingPlayerIds, turnOrder, winnerPlayerIds,
 * every actionHistory entry's playerId, and whatever the game-specific slice
 * keys or stores by player id. Deliberately done as one global string
 * substitution over the whole serialized state, rather than a per-field
 * structural walk, so the framework needn't know the game's own shape and a
 * new field carrying a player id is remapped for free — safe because player
 * ids are random UUIDs, so an old id can't turn up as a substring of anything
 * else in the state by chance. Every player's `authUserId` is overwritten to
 * `hostUserId` (not looked up in `playerIdMap`, since it's a different id
 * space — the original seat's real auth identity, not its player-row id),
 * matching how the new room's `players.user_id` is the same host account for
 * every seat (see gameApi.ts's addLocalPlayer).
 */
export function remapGameStatePlayerIds(
  state: GameState,
  params: { newGameId: string; playerIdMap: Record<string, string>; hostUserId: string },
): GameState {
  let json = JSON.stringify(state)
  for (const [oldId, newId] of Object.entries(params.playerIdMap)) {
    json = json.split(oldId).join(newId)
  }
  const remapped = JSON.parse(json) as GameState
  remapped.gameId = params.newGameId
  remapped.players = remapped.players.map((p) => ({ ...p, authUserId: params.hostUserId }))
  return remapped
}
