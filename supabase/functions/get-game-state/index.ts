// The redacted read path, opposite apply-action/undo-action/redo-action's
// write-side enforcement: a straight reuse of redactStateForPlayer
// (packages/sdk/src/redaction.ts, which delegates what's secret to the game's own
// GameDefinition.redactGame/isActionSecret) against the live state — no
// replay needed.
//
// A read: no compare-and-swap, no `action.playerId` authorization — the check
// is "is this caller entitled to read this game's state at all"
// (canReadGameState, mirroring game_state's SELECT RLS policies, which this
// function's service-role client otherwise bypasses), then which *view* of it
// they get:
//   - a site admin, a game without hidden information, or hotseat (one shared
//     auth.uid() across every local seat — see below) gets
//     revealedGameStateView: the same RedactedGameState *shape*, nothing
//     masked;
//   - a seated player in a hidden-information game gets redactStateForPlayer
//     keyed to their own seat;
//   - anyone else entitled to read at all — including the room owner, who is
//     not trusted with another player's hidden information just for having
//     created the room — gets it keyed to no seat at all.
//
// gameApi.ts's getGameStateRedacted only calls this for a rule-enforced game
// with hidden information enabled; every other game reads `game_state`
// directly via RLS.
//
// Request body: `{ gameId, sinceActionIndex?, protocol?, fallbackReason? }`.
// A client that already holds a prefix of the log names its length in
// `sinceActionIndex` and gets back only what's new (respondWithState in
// ../_shared/gameEnforcement.ts). Anything inconsistent just costs one full
// response rather than a wrong splice.
import { redactStateForPlayer, revealedGameStateView } from '@game-platform/sdk'
import { canReadGameState, corsHeaders, getCallerUserId, jsonResponse, loadGameContext, respondWithState, serviceRoleClient } from '../_shared/gameEnforcement.ts'

interface GetGameStateRequest {
  gameId: string
  sinceActionIndex?: number
  /**
   * Which delta contract the caller speaks. Absent or 1: the whole
   * `stateWithoutHistory` alongside the appended log. 2: the caller rebuilds
   * the state from the
   * actions itself, so the response carries no materialised state at all,
   * just an overlay for what a replay cannot reach and a hash to check the
   * result against.
   *
   * Versioned rather than sniffed so a stale PWA bundle keeps working: an
   * old client never sends 2 and never sees the new shape, and a new client
   * talking to an old deploy gets a protocol-1 response it still understands.
   * No coordinated rollout, same posture as the `__gz` read path.
   */
  protocol?: number
  /** Why the caller could not use a delta, when it could not — see StateFallbackReason (../_shared/gameEnforcement.ts). */
  fallbackReason?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const callerUserId = await getCallerUserId(req)
  if (!callerUserId) return jsonResponse(401, { ok: false, error: 'Not authenticated.' })

  let body: GetGameStateRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' })
  }
  const { gameId, sinceActionIndex, protocol, fallbackReason } = body
  if (!gameId) return jsonResponse(400, { ok: false, error: 'Request body must be { gameId }.' })

  const supabase = serviceRoleClient()
  const ctx = await loadGameContext(supabase, gameId, callerUserId)
  if (!ctx) return jsonResponse(404, { ok: false, error: 'Game not found, or has no state yet (still in the lobby?).' })

  if (!canReadGameState(ctx, callerUserId)) {
    return jsonResponse(403, { ok: false, error: 'You may not view this game.' })
  }

  // Opt-in (GameSettings.hiddenInformationEnabled, carried onto GameState at
  // genesis): a game without it gets the same response shape with nothing
  // masked, same as the admin/hotseat carve-outs.
  //
  // Hotseat is never redacted regardless of the flag: one shared
  // `auth.uid()` covers every local seat, so
  // `callerPlayerId` below would resolve to whichever seat happens to come
  // first in `ctx.players` — meaningless for per-seat masking, and actively
  // wrong (it would hide a local player's own move from the very device
  // they're using to make it).
  const shouldRedact = ctx.gameState.state.hiddenInformationEnabled && ctx.game.play_mode !== 'hotseat'

  if (ctx.isAdmin || !shouldRedact) {
    return respondWithState('get-game-state', ctx.gameState.state, revealedGameStateView(ctx.gameState.state), ctx.gameState.version, { sinceActionIndex, protocol, fallbackReason })
  }

  const callerPlayerId = ctx.players.find((p) => p.user_id === callerUserId)?.id ?? null
  const state = redactStateForPlayer(ctx.gameState.state, callerPlayerId)
  return respondWithState('get-game-state', ctx.gameState.state, state, ctx.gameState.version, { sinceActionIndex, protocol, fallbackReason })
})
