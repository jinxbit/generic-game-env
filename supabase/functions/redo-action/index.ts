// Redoes the last undone action of a rule-enforced game, server-side.
// Undo/redo are logged actions (UNDO_ACTION/REDO_ACTION) folded in by
// resolveHistory (packages/sdk/src/historyFold.ts), not a splice of the log, so
// this needs the game's genesis (buildGenesisState, src/lib/gameGenesis.ts):
// it's a shorter/longer replay from the start, not a step forward from the
// current state — mirroring GamePage.tsx's client-trusted handleUndo/
// handleRedo.
//
// Allowed for any seated player (or the room owner/an admin), at any time:
// moving the pointer is non-destructive. Discarding the undone tail only
// happens when a *new* action is submitted behind the tip — that's gated in
// apply-action, not here.
//
// Request body: `{ gameId: string }` — no action payload, by design. The
// response's `state` is redacted the same way apply-action's is.
import { applyRedoAction } from '@game-platform/sdk'
import {
  buildGenesisState,
  corsHeaders,
  getCallerUserId,
  jsonResponse,
  loadFullGameAndPlayers,
  loadGameContext,
  respondToWrite,
  withViewLog,
  serviceRoleClient,
  writeGameStateCAS,
} from '../_shared/gameEnforcement.ts'

interface RedoActionRequest {
  gameId: string
  /**
   * The caller's own cached `actionHistory` prefix length, and which delta
   * contract it speaks — both forwarded straight to `respondWithState`
   * (../_shared/gameEnforcement.ts), which is the same builder the read path
   * uses — so the response can be a delta rather than the whole state.
   */
  sinceActionIndex?: number
  protocol?: number
  /** Why the caller could not use a delta, when it could not — see StateFallbackReason (../_shared/gameEnforcement.ts). */
  fallbackReason?: string
  /** Protocol 3: the caller's `sinceActionIndex` is a cursor into a view-log state — see respondWithViewLog (../_shared/gameEnforcement.ts). */
  viewLog?: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const callerUserId = await getCallerUserId(req)
  if (!callerUserId) return jsonResponse(401, { ok: false, error: 'Not authenticated.' })

  let body: RedoActionRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' })
  }
  const { gameId, sinceActionIndex, protocol, fallbackReason, viewLog } = body
  if (!gameId) return jsonResponse(400, { ok: false, error: 'Request body must be { gameId }.' })

  const supabase = serviceRoleClient()
  const ctx = await loadGameContext(supabase, gameId, callerUserId)
  if (!ctx) return jsonResponse(404, { ok: false, error: 'Game not found, or has no state yet (still in the lobby?).' })

  const isSeated = ctx.players.some((p) => p.user_id === callerUserId)
  if (!isSeated && !ctx.isOwnerOrAdmin) {
    return jsonResponse(403, { ok: false, error: 'Only a seated player (or the room owner/an admin) may redo.' })
  }

  const genesisInputs = await loadFullGameAndPlayers(supabase, gameId)
  if (!genesisInputs) return jsonResponse(404, { ok: false, error: 'Game not found.' })
  const genesis = buildGenesisState(genesisInputs.game, genesisInputs.players, ctx.gameState.state.setupRandom)

  const callerPlayerId = ctx.players.find((p) => p.user_id === callerUserId)?.id ?? null

  const result = applyRedoAction(genesis, ctx.gameState.state, callerPlayerId)
  if (!result.ok) return jsonResponse(400, { ok: false, error: result.error })
  const written = withViewLog(ctx, ctx.gameState.state, result.state)

  const newVersion = await writeGameStateCAS(supabase, gameId, written, ctx.gameState.version)
  if (newVersion === null) {
    return jsonResponse(409, { ok: false, error: 'Game state changed concurrently — refetch and retry.' })
  }

  // Same write-side redaction as apply-action — see redactedResponseState.
  return respondToWrite('redo-action', ctx, callerUserId, written, newVersion, { sinceActionIndex, protocol, fallbackReason, viewLog })
})
