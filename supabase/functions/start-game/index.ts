// Starts a rule-enforced game server-side: re-fetches the roster straight
// from the DB (never a client-supplied one — a stale client-held `players`
// snapshot could otherwise build genesis for the wrong roster), builds
// genesis with the same shared buildGenesisState the client and the other
// functions use, and writes it under a service-role client. The baseline
// migration blocks the matching direct client writes (the `game_state`
// INSERT, and `games`' 'lobby' -> 'active' transition in the
// `enforce_game_status_transition` trigger) for an enforced game, so this is
// the only legitimate way to start one.
//
// Non-enforced games are untouched: gameApi.ts's startGameFromLobby() does
// the same sequence client-side for them, and this function rejects a game
// that isn't ruleEnforcementEnabled, so there's only ever one code path
// responsible for a given game's Start.
//
// Randomness needs nothing here: the room's seed was rolled when it was
// created (src/lib/randomSeed.ts) and is already on the row, so
// buildGenesisState stays a deterministic function of it.
//
// Request body: `{ gameId: string }`. Idempotent past the point a
// `game_state` row exists: a retry after a prior call inserted genesis but
// failed before flipping `games.status` just (re)flips status.
import { findGameDefinition } from '@game-platform/sdk'
import { canStartGame } from '../../../src/lib/roomReadiness.ts'
import { compressGameStateForStorage } from '../../../src/lib/gameStateCompression.ts'
import type { GameRow, PlayerRow } from '../../../src/lib/dbTypes.ts'
import { buildGenesisState, corsHeaders, getCallerUserId, jsonResponse, serviceRoleClient } from '../_shared/gameEnforcement.ts'

interface StartGameRequest {
  gameId: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // An unexpected server error (a DB error, a malformed settings row, ...)
  // would otherwise surface as Deno's own unhandled-rejection response, with
  // no `{ok:false, error}` body for gameApi.ts's `invokeStartGame` to parse.
  try {
    return await handleStartGame(req)
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err instanceof Error ? err.message : 'Unexpected server error.' })
  }
})

async function handleStartGame(req: Request): Promise<Response> {
  const callerUserId = await getCallerUserId(req)
  if (!callerUserId) return jsonResponse(401, { ok: false, error: 'Not authenticated.' })

  let body: StartGameRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' })
  }
  const { gameId } = body
  if (!gameId) return jsonResponse(400, { ok: false, error: 'Request body must be { gameId }.' })

  const supabase = serviceRoleClient()
  const { data: game, error: gameError } = await supabase.from('games').select().eq('id', gameId).maybeSingle()
  if (gameError) throw gameError
  if (!game) return jsonResponse(404, { ok: false, error: 'Game not found.' })
  const gameRow = game as GameRow

  // Mirrors the "room owner can update their game" RLS policy and
  // LobbyPage.tsx's own `isCreator` gate — starting a room is an Owner
  // action, same as canceling/deleting it. No admin override: nothing else
  // in the room-lifecycle model gives an admin that privilege either.
  if (gameRow.created_by !== callerUserId) {
    return jsonResponse(403, { ok: false, error: 'Only the room owner may start the game.' })
  }
  if (!gameRow.settings.ruleEnforcementEnabled) {
    return jsonResponse(400, { ok: false, error: 'This game is not rule-enforced — it starts through the client-trusted path instead.' })
  }

  const { data: existingState, error: existingStateError } = await supabase.from('game_state').select('game_id').eq('game_id', gameId).maybeSingle()
  if (existingStateError) throw existingStateError

  if (!existingState) {
    if (gameRow.status !== 'lobby') {
      return jsonResponse(400, { ok: false, error: 'This room is not in the lobby.' })
    }
    // buildGenesisState throws for a game (or pinned rules version) this
    // deployment hasn't registered (src/games/registry.ts). That's the
    // room's problem, not the server's — say so as a 400 rather than let it
    // surface as the catch-all 500.
    if (!findGameDefinition(gameRow.game_type, gameRow.settings.rulesVersion)) {
      const version = gameRow.settings.rulesVersion === undefined ? '' : ` (rules version ${gameRow.settings.rulesVersion})`
      return jsonResponse(400, { ok: false, error: `This room's game "${gameRow.game_type}"${version} isn't available on this site, so it can't be started.` })
    }

    const { data: playerRows, error: playersError } = await supabase
      .from('players')
      .select()
      .eq('game_id', gameId)
      .order('seat_index', { ascending: true })
    if (playersError) throw playersError
    const players = (playerRows ?? []) as PlayerRow[]

    if (!canStartGame(gameRow, players)) {
      return jsonResponse(409, { ok: false, error: 'This room changed since you loaded it — refresh and try again.' })
    }

    const genesis = buildGenesisState(gameRow, players)
    const compressed = await compressGameStateForStorage(genesis)
    const { error: insertError } = await supabase
      .from('game_state')
      .insert({ game_id: gameId, state: compressed, turn: genesis.turn, active_player_id: genesis.activePlayerId })
    if (insertError && insertError.code !== '23505') throw insertError
  }

  // Same coarse-status-only flip startGameFromLobby's client-side path ends
  // with — see its own doc comment in gameApi.ts for why `games.status`
  // itself only ever needs to become 'active' here, never anything finer.
  const { error: statusError } = await supabase.from('games').update({ status: 'active' }).eq('id', gameId)
  if (statusError) throw statusError

  return jsonResponse(200, { ok: true })
}
