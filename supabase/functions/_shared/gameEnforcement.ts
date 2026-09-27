// Shared plumbing for the apply-action/undo-action/redo-action/
// get-game-state/start-game Edge Functions — caller-seat resolution, the
// owner/admin-override check, redaction of responses, and the game_state
// compare-and-swap write, all in one place so the functions (each its own
// independent deploy unit, per Supabase's `_shared/` convention) don't
// duplicate them. Imports `src/engine/`/`src/game/`/`src/lib/` directly and
// unmodified: there is no rule-logic duplication between client and server.
//
// The Edge Runtime does NOT honor `sloppy-imports`: every relative import
// reachable from here must carry an explicit `.ts` extension (safe, since
// `tsconfig.app.json` sets `allowImportingTsExtensions`), and JSON imports
// need `with { type: 'json' }`. A missing extension only fails at deploy
// time, not in CI.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { applyAction } from '../../../src/engine/applyAction.ts'
import type { Action, LoggedAction } from '../../../src/engine/actions.ts'
import { redoableTail } from '../../../src/engine/historyFold.ts'
import { redactStateForPlayer, revealedGameStateView, toClientGameState, unredactedPrefix, type RedactedGameState, type RedactedGameStateDelta } from '../../../src/engine/redaction.ts'
import { buildInFlightOverlay, needsInFlightOverlay } from '../../../src/engine/inFlightOverlay.ts'
import { hashGameStateView } from '../../../src/lib/gameStateHash.ts'
import type { ActionResult, GameState } from '../../../src/engine/types.ts'
import { buildGenesisState } from '../../../src/lib/gameGenesis.ts'
import type { GameRow as FullGameRow, PlayerRow as FullPlayerRow } from '../../../src/lib/dbTypes.ts'
import { compressGameStateForStorage, decompressGameStateFromStorage, type StoredGameState } from '../../../src/lib/gameStateCompression.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders } })
}

/** Every table row this module needs — deliberately narrower than dbTypes.ts's full GameRow/PlayerRow, just the columns actually selected below. */
export interface GameRow {
  id: string
  play_mode: 'hotseat' | 'live' | 'async'
  created_by: string
  /** Room lifecycle status — only get-game-state's read-visibility check (mirroring game_state's SELECT RLS policy) uses this; apply-action/undo-action/redo-action ignore it. */
  status: 'lobby' | 'active' | 'completed' | 'canceled'
}
export interface PlayerRow {
  id: string
  user_id: string
}
/** The row's logical (decompressed) shape — see loadGameContext, which decompresses before this ever reaches a caller. */
export interface GameStateRow {
  state: GameState
  version: number
}

/** The row's actual on-disk shape, before loadGameContext decompresses it — see gameStateCompression.ts. */
interface RawGameStateRow {
  state: StoredGameState
  version: number
}

/** Service-role client — every DB read/write these functions do is against this, not the caller's own RLS-scoped session (these functions enforce authorization themselves). */
export function serviceRoleClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

/**
 * Resolves the calling user's id from their JWT (`Authorization` header),
 * via a client scoped to that JWT rather than the service-role one — this is
 * what actually verifies the token, exactly like GamePage.tsx's `session`
 * resolves `auth.uid()` client-side. Returns null for a missing/invalid
 * token; callers should reject with 401 in that case (verify_jwt is on by
 * default for these functions, so an invalid JWT normally never reaches this
 * point at all — this is a defensive fallback for that assumption, not the
 * primary check).
 */
export async function getCallerUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null
  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data, error } = await anonClient.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

export interface GameContext {
  game: GameRow
  players: PlayerRow[]
  gameState: GameStateRow
  /** profiles.is_admin, checked from the DB rather than trusted from the client. The one caller get-game-state trusts with still-secret information — unlike isOwnerOrAdmin below, the room owner does NOT get this: an owner is still just a player, with no reason to see another player's hidden information. */
  isAdmin: boolean
  /** games.created_by or profiles.is_admin — the write-side act-as-any-player/history-override carve-out. Deliberately broader than isAdmin: forcing an action through (e.g. for a stuck/AFK player) is an owner responsibility, unrelated to reading someone else's still-secret state (see isAdmin above). */
  isOwnerOrAdmin: boolean
}

/** Loads everything apply-action/undo-action/redo-action/get-game-state need about one game in one place, or null if the game/its state doesn't exist. */
export async function loadGameContext(supabase: SupabaseClient, gameId: string, callerUserId: string): Promise<GameContext | null> {
  const [{ data: game, error: gameError }, { data: players, error: playersError }, { data: gameState, error: stateError }] = await Promise.all([
    supabase.from('games').select('id, play_mode, created_by, status').eq('id', gameId).maybeSingle(),
    supabase.from('players').select('id, user_id').eq('game_id', gameId),
    supabase.from('game_state').select('state, version').eq('game_id', gameId).maybeSingle(),
  ])
  if (gameError) throw gameError
  if (playersError) throw playersError
  if (stateError) throw stateError
  if (!game || !players || !gameState) return null

  const { data: profile, error: profileError } = await supabase.from('profiles').select('is_admin').eq('user_id', callerUserId).maybeSingle()
  if (profileError) throw profileError

  const isAdmin = profile?.is_admin ?? false
  const rawGameState = gameState as RawGameStateRow
  return {
    game,
    players,
    gameState: { state: await decompressGameStateFromStorage(rawGameState.state), version: rawGameState.version },
    isAdmin,
    isOwnerOrAdmin: game.created_by === callerUserId || isAdmin,
  }
}

/**
 * Is `callerUserId` entitled to submit `playerId`'s action? In hotseat one
 * shared `auth.uid()` covers every local seat, so any player enrolled in a
 * hotseat game may act for any seat in it. Live/async requires an exact
 * (game, seat, caller) match. The room owner or a site admin may act for
 * anyone (e.g. to unstick an AFK player).
 */
export function isAuthorizedToActAs(ctx: GameContext, callerUserId: string, playerId: string): boolean {
  if (ctx.isOwnerOrAdmin) return true
  if (ctx.game.play_mode === 'hotseat') return ctx.players.some((p) => p.user_id === callerUserId)
  return ctx.players.some((p) => p.id === playerId && p.user_id === callerUserId)
}

/**
 * get-game-state's read-visibility check — mirrors `game_state`'s SELECT RLS
 * policies (seated player, or any signed-in user once the game is past
 * 'lobby'; an admin, of anything, always) exactly, since a service-role-client Edge
 * Function bypasses RLS entirely and so has to reimplement whatever gate RLS
 * would otherwise have provided. Deliberately keyed on `isAdmin`, not the
 * broader `isOwnerOrAdmin` — RLS itself gives the room owner no special read
 * access beyond being a seated player, so neither should this.
 */
export function canReadGameState(ctx: GameContext, callerUserId: string): boolean {
  if (ctx.isAdmin) return true
  if (ctx.players.some((p) => p.user_id === callerUserId)) return true
  return ctx.game.status !== 'lobby'
}

/**
 * Write-side mirror of `get-game-state`'s redaction gate: apply-action/
 * undo-action/redo-action hand the caller back the very state their own
 * compare-and-swap just wrote, so without this the write response would leak
 * exactly what the read path withholds. Keyed on the caller's own seat, not
 * the action's `playerId` — the owner/admin override lets someone submit on
 * another seat's behalf, but the response lands in *this* caller's browser.
 *
 * Always wraps in the `RedactedGameState` shape, even when nothing is masked
 * (`revealedGameStateView`), so every caller gets one predictable shape and
 * `gameApi.ts` can unconditionally run it through `toClientGameState`.
 */
export function redactedResponseState(ctx: GameContext, callerUserId: string, state: GameState): RedactedGameState {
  const shouldRedact = state.hiddenInformationEnabled && ctx.game.play_mode !== 'hotseat'
  if (ctx.isAdmin || !shouldRedact) return revealedGameStateView(state)
  const callerPlayerId = ctx.players.find((p) => p.user_id === callerUserId)?.id ?? null
  return redactStateForPlayer(state, callerPlayerId)
}

/**
 * Whether appending `submittedByPlayerId`'s new action would discard another
 * player's undone action. Appending to the raw `actionHistory` while the undo
 * pointer sits behind the tip prunes the un-redone tail automatically
 * (resolveHistory, src/engine/historyFold.ts) — this checks, before that
 * happens, whether that tail contains anyone else's action.
 *
 * Only decides WHETHER an override is needed, not whether the caller has one:
 * that takes the room owner or a site admin (`ctx.isOwnerOrAdmin`) *with*
 * room admin mode switched on (`GameState.adminModeActive`, toggled by
 * SET_ADMIN_MODE) — checked by apply-action itself. Also unconditional on
 * play mode: apply-action skips calling this for a hotseat game, where one
 * shared `auth.uid()` covers every seat and there's no second human whose
 * undone move could be discarded.
 */
export function requiresOwnerOverride(rawHistory: LoggedAction[], submittedByPlayerId: string): boolean {
  return redoableTail(rawHistory).some((entry) => actionPlayerId(entry.action) !== submittedByPlayerId)
}

function actionPlayerId(action: Action): string | null {
  return 'playerId' in action ? action.playerId : null
}

/**
 * Applies `action` against `state` via applyAction (src/engine/applyAction.ts)
 * — the same entry point GamePage.tsx's submitAction uses client-side, so
 * forced follow-ups fold into the same actionHistory entry here and there.
 */
export function applyActionEnforced(state: GameState, action: Action): ActionResult {
  return applyAction(state, action)
}

/**
 * game_state's existing compare-and-swap write (mirrors writeGameState in
 * src/lib/gameApi.ts): succeeds only if `expectedVersion` still matches the
 * row's current version, same optimistic-concurrency contract clients use
 * today. Returns the new version, or null if another write raced this one
 * (caller should re-fetch and retry, or surface a 409 to the client — this
 * is expected to happen occasionally under concurrent submissions, not a bug).
 *
 * This is the one path (shared by apply-action/undo-action/redo-action, and
 * only ever invoked for `ruleEnforcementEnabled` games) that gzip+base64-compresses
 * `state` before it's written, shrinking the stored row — which shrinks both
 * every subscribed client's Realtime broadcast of it and every later REST
 * read (getGameState/listMyGames/etc. in gameApi.ts). A client-trusted game's
 * direct writes (gameApi.ts's writeGameState/insertGameState) are unaffected
 * — see gameStateCompression.ts's doc comment for why this is scoped here
 * rather than to every write.
 */
export async function writeGameStateCAS(supabase: SupabaseClient, gameId: string, state: GameState, expectedVersion: number): Promise<number | null> {
  const compressed = await compressGameStateForStorage(state)
  const { data, error } = await supabase
    .from('game_state')
    .update({ state: compressed, turn: state.turn, active_player_id: state.activePlayerId, version: expectedVersion + 1 })
    .eq('game_id', gameId)
    .eq('version', expectedVersion)
    .select('version')
    .maybeSingle()
  if (error) throw error
  return data ? data.version : null
}

/**
 * Full game/player rows, beyond loadGameContext's narrow projection — needed
 * only by undo-action/redo-action/start-game, to rebuild genesis
 * (buildGenesisState, src/lib/gameGenesis.ts) the same way GamePage.tsx's
 * handleUndo/handleRedo do client-side. apply-action never needs genesis: a live submission
 * only ever steps forward from the current stored GameState.
 */
export async function loadFullGameAndPlayers(supabase: SupabaseClient, gameId: string): Promise<{ game: FullGameRow; players: FullPlayerRow[] } | null> {
  const [{ data: game, error: gameError }, { data: players, error: playersError }] = await Promise.all([
    supabase.from('games').select().eq('id', gameId).maybeSingle(),
    supabase.from('players').select().eq('game_id', gameId).order('seat_index', { ascending: true }),
  ])
  if (gameError) throw gameError
  if (playersError) throw playersError
  if (!game || !players) return null
  return { game: game as FullGameRow, players: players as FullPlayerRow[] }
}

export { buildGenesisState }

/**
 * Why a caller ended up asking for a whole state instead of a delta, as the
 * client reports it (gameApi.ts sets it when `applyReplayDelta` gives up).
 *
 * The point of carrying this at all: the server cannot otherwise tell a
 * healthy cold start — a client with no cache yet, which is expected — from a client whose local rebuild
 * *disagreed with the server*. Both arrive as "protocol 2, no cursor". The
 * second is the one worth watching: a hash mismatch means this client's engine
 * and ours produced different states from the same actions, which is exactly
 * what the hash is there to catch and is otherwise completely silent —
 * everything keeps working, just at the old cost, and nothing says so.
 */
export type StateFallbackReason = 'hash-mismatch' | 'replay-failed' | 'cursor-mismatch' | 'length-mismatch' | 'other'

const KNOWN_FALLBACK_REASONS: readonly string[] = ['hash-mismatch', 'replay-failed', 'cursor-mismatch', 'length-mismatch']

/**
 * Client-supplied, therefore not trusted into a log line as-is: anything
 * unrecognised collapses to 'other' rather than letting an arbitrary string
 * (newlines, forged JSON, unbounded length) reach the log and either break a
 * query or fake a record.
 */
function normalizeFallbackReason(raw: unknown): StateFallbackReason | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  return KNOWN_FALLBACK_REASONS.includes(raw) ? (raw as StateFallbackReason) : 'other'
}

/** What the caller asked for, and why — everything respondWithState needs beyond the state itself. */
export interface StateResponseRequest {
  sinceActionIndex?: number
  protocol?: number
  fallbackReason?: string
}

/**
 * One line per state response, into the Edge Function logs.
 *
 * Deliberately a log line and not a counter table: a row per request would put
 * a PostgREST round trip back on the hot path. stdout costs nothing and
 * Supabase already collects it.
 *
 * `evt` is a fixed string so the Logs Explorer has something exact to filter
 * on.
 */
function logStateResponse(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ evt: 'state_response', ...fields }))
}

/**
 * The single response builder for every endpoint that hands a caller a game
 * state: `get-game-state` reading one, and `apply-action`/`undo-action`/
 * `redo-action` handing back the state their own compare-and-swap just wrote.
 *
 * Shared rather than copied because the clamping below is subtle and getting
 * it wrong in one of four places is the kind of bug that only shows up as a
 * leak. `view` is whatever that endpoint already decided the caller may see —
 * `redactedResponseState` for a write, `redactStateForPlayer`/
 * `revealedGameStateView` for a read — and `trueState` is the unredacted state
 * it was derived from, needed only to decide whether an overlay is required.
 *
 * Three response shapes, picked by what the caller asked for:
 *
 *   - `protocol: 2` with a usable `sinceActionIndex`: the actions
 *     it may replay, an overlay for what a replay cannot reach, and a hash to
 *     check the result against. No materialised state at all.
 *   - `sinceActionIndex` alone: `stateWithoutHistory` plus the
 *     appended log.
 *   - Neither: the whole view, as it always was.
 *
 * A caller that sends nothing new gets byte-for-byte what it got before, which
 * is what lets a stale PWA bundle keep working with no coordinated rollout.
 */
export function respondWithState(
  fn: string,
  trueState: GameState,
  view: RedactedGameState,
  version: number,
  request: StateResponseRequest,
): Response {
  const { sinceActionIndex, protocol } = request
  const fallbackReason = normalizeFallbackReason(request.fallbackReason)
  const protocolVersion = protocol ?? 1

  // `x-state-shape` / `x-state-reason` mirror the log line into the response
  // itself, so the network tab answers "is this actually sending a delta right
  // now" without a trip to the Logs Explorer. Aggregates come from the log;
  // this is for looking at one request.
  const tagged = (shape: string, reason: string, body: unknown, extra: Record<string, unknown>) => {
    logStateResponse({ fn, shape, reason, protocol: protocolVersion, ...extra })
    return jsonResponse(200, body, { 'x-state-shape': shape, 'x-state-reason': reason })
  }

  if (typeof sinceActionIndex === 'number' && Number.isInteger(sinceActionIndex) && sinceActionIndex >= 0) {
    const safePrefixLength = unredactedPrefix(view.actionHistory).length
    // `<=`, not `<`: the safe prefix is NOT monotonic. Masking derives
    // strictly from the *current* state (see redactStateForPlayer's doc
    // comment), so an undo can re-mask entries this viewer was already shown
    // and move the prefix backwards. A caller asking from beyond it falls through to a full
    // response here, which is exactly right — it has entries it is no longer
    // entitled to replay from.
    if (sinceActionIndex <= safePrefixLength) {
      const { actionHistory, ...stateWithoutHistory } = view
      const actionHistoryAppend = actionHistory.slice(sinceActionIndex, safePrefixLength)
      if (protocolVersion >= 2) {
        const clientView = toClientGameState(view)
        const overlay = needsInFlightOverlay(trueState, clientView) ? buildInFlightOverlay(clientView) : undefined
        return tagged(
          'delta',
          'ok',
          {
            ok: true,
            actionHistoryFrom: sinceActionIndex,
            actionHistoryAppend,
            actionHistoryLength: safePrefixLength,
            ...(overlay ? { overlay } : {}),
            stateHash: hashGameStateView(clientView),
            version,
          },
          { append: actionHistoryAppend.length, overlay: Boolean(overlay) },
        )
      }
      const delta: RedactedGameStateDelta = {
        state: stateWithoutHistory,
        actionHistoryFrom: sinceActionIndex,
        actionHistoryAppend,
        actionHistoryLength: safePrefixLength,
      }
      return tagged('history-delta', 'protocol-1', { ok: true, ...delta, version }, { append: actionHistoryAppend.length })
    }
    // Asked from beyond the safe prefix: entries this caller already held
    // were re-masked. Distinct from a cold start, and worth counting
    // separately.
    if (protocolVersion >= 2) {
      return tagged('full', 'prefix-moved-back', { ok: true, state: view, stateHash: hashGameStateView(toClientGameState(view)), version }, {})
    }
    return tagged('full', 'prefix-moved-back', { ok: true, state: view, version }, {})
  }

  // No cursor at all. Either a genuine cold start, or the client rebuilt a
  // delta and didn't like the result — `fallbackReason` is the only thing that
  // tells those apart, and the second is the one that matters.
  const reason = fallbackReason ?? (protocolVersion >= 2 ? 'cold-start' : 'protocol-1')
  if (protocolVersion >= 2) {
    return tagged('full', reason, { ok: true, state: view, stateHash: hashGameStateView(toClientGameState(view)), version }, {})
  }
  return tagged('full', reason, { ok: true, state: view, version }, {})
}
