// Applies one action to a rule-enforced game, server-side. The shared logic
// (seat resolution, authorization, the compare-and-swap write, response
// redaction) lives in ../_shared/gameEnforcement.ts, shared with
// undo-action/redo-action/get-game-state/start-game.
//
// Request body: `{ gameId: string, action: Action }` (see
// packages/sdk/src/actions.ts). UNDO_ACTION/REDO_ACTION are rejected here (same as
// applyAction() itself) — submit those to undo-action/redo-action, which
// replay from genesis rather than stepping forward. SET_ADMIN_MODE IS
// handled here — an ordinary forward step, just with its own owner-or-admin
// authorization instead of the usual per-seat one.
//
// Random numbers the rules draw come from the game's secret seed
// (loadRandomSeed) and are recorded on the new log entry, so no client ever
// needs the seed to replay the move.
//
// The response's `state` is redacted the same way get-game-state's read is —
// the acting player's own submission would otherwise be the easiest way to
// see what the game keeps secret, since it hands back the very state the
// action just produced. See redactedResponseState.
import type { Action } from '@game-platform/sdk'
import {
  applyActionEnforced,
  corsHeaders,
  getCallerUserId,
  isAuthorizedToActAs,
  jsonResponse,
  loadGameContext,
  loadRandomSeed,
  redactedResponseState,
  respondWithState,
  requiresOwnerOverride,
  serviceRoleClient,
  writeGameStateCAS,
} from '../_shared/gameEnforcement.ts'

interface ApplyActionRequest {
  gameId: string
  action: Action
  /**
   * The caller's own cached `actionHistory` prefix length, and which delta
   * contract it speaks — both forwarded straight to `respondWithState`
   * (../_shared/gameEnforcement.ts), which is the same builder the read path
   * uses — so a move's own response can be a delta rather than the whole
   * state.
   */
  sinceActionIndex?: number
  protocol?: number
  /** Why the caller could not use a delta, when it could not — see StateFallbackReason (../_shared/gameEnforcement.ts). */
  fallbackReason?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const callerUserId = await getCallerUserId(req)
  if (!callerUserId) return jsonResponse(401, { ok: false, error: 'Not authenticated.' })

  let body: ApplyActionRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' })
  }
  const { gameId, action, sinceActionIndex, protocol, fallbackReason } = body
  if (!gameId || !action || typeof action.type !== 'string') {
    return jsonResponse(400, { ok: false, error: 'Request body must be { gameId, action }.' })
  }
  if (action.type === 'UNDO_ACTION' || action.type === 'REDO_ACTION') {
    return jsonResponse(400, { ok: false, error: `${action.type} must be submitted via the undo-action/redo-action functions, not apply-action.` })
  }

  const supabase = serviceRoleClient()
  const ctx = await loadGameContext(supabase, gameId, callerUserId)
  if (!ctx) return jsonResponse(404, { ok: false, error: 'Game not found, or has no state yet (still in the lobby?).' })

  // SET_ADMIN_MODE has no seat to check `isAuthorizedToActAs` against
  // (`playerId` is narration-only, like Undo/Redo) — only the room owner or a
  // site admin may flip it. It's also exempt from the owner-override check
  // below: that check gates the very privilege this action turns on.
  if (action.type === 'SET_ADMIN_MODE') {
    if (!ctx.isOwnerOrAdmin) {
      return jsonResponse(403, { ok: false, error: 'Only the room owner or an admin may toggle admin mode.' })
    }
  } else {
    // Client-supplied: every other action must name the seat it acts for.
    const playerId: unknown = action.playerId
    if (typeof playerId !== 'string') {
      return jsonResponse(400, { ok: false, error: 'The action must name the player it is for (playerId).' })
    }
    if (!isAuthorizedToActAs(ctx, callerUserId, playerId)) {
      return jsonResponse(403, { ok: false, error: "You may not submit an action on another player's behalf." })
    }
    // Discarding another player's undone action via a branching submission
    // takes the room owner or an admin *with* room admin mode switched on.
    // Skipped for hotseat: one shared auth.uid() covers every seat, so
    // undoing one seat's move and acting for another is ordinary hotseat
    // play, not a takeover.
    const ownerOverrideAvailable = ctx.isOwnerOrAdmin && Boolean(ctx.gameState.state.adminModeActive)
    const isHotseat = ctx.game.play_mode === 'hotseat'
    if (!isHotseat && requiresOwnerOverride(ctx.gameState.state.actionHistory, playerId) && !ownerOverrideAvailable) {
      return jsonResponse(403, {
        ok: false,
        error: "Submitting this action would discard another player's undone move — only the room owner or an admin, with room admin mode on, may do that.",
      })
    }
  }

  const randomSeed = await loadRandomSeed(supabase, gameId)
  const result = applyActionEnforced(ctx.gameState.state, action, randomSeed)
  if (!result.ok) return jsonResponse(400, { ok: false, error: result.error })

  const newVersion = await writeGameStateCAS(supabase, gameId, result.state, ctx.gameState.version)
  if (newVersion === null) {
    return jsonResponse(409, { ok: false, error: 'Game state changed concurrently — refetch and retry.' })
  }

  // The response is redacted the same way get-game-state's read is — the CAS
  // write above always persists the real, unredacted result.state.
  return respondWithState('apply-action', result.state, redactedResponseState(ctx, callerUserId, result.state), newVersion, { sinceActionIndex, protocol, fallbackReason })
})
