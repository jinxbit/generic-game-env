// Proves the secret an opponent isn't entitled to yet never reaches their
// browser over the wire — in any response, not just that the UI declines to
// render it — against a real, deployed project (or, for the half that doesn't
// need a socket, the in-process stack).
//
// The secret is the example game's (src/game/rules.ts, "Unique Pick"): while
// a round is open, every other player's pick must read `null` in
// `game.picks` and their PICK_NUMBER log entry must be a HIDDEN_ACTION
// placeholder (src/engine/redaction.ts) — in a full response, in a
// protocol-2 delta's append and overlay, and in the acting player's own
// write response alike. Once the round resolves, both are revealed.
//
// Reuses this directory's existing provisioning (provisionLiveRoom,
// runSmoke.ts's fixtureForRoom/replayFixtureThroughStack) rather than a
// second path to a live project, per this directory's README: private room,
// 'live' play mode, room deleted before its throwaway users. The only extra
// surface on `LiveRoom` it needs is `clientFor` (liveProject.ts), for the raw
// (uncollapsed) Edge Function response and the real Realtime subscription
// this check makes — `applyAction`/`readAs` already collapse the wire
// response before a caller ever sees it, which is exactly what this file
// needs to bypass.
//
// A three-seat room, not two: the write-path leak (apply-action's own
// response handing the acting player another still-pending seat's pick) only
// shows up when someone *other* than the last-to-act player submits — in a
// two-player game the acting player is always last, so the round has already
// resolved by the time their own response comes back. See
// ../__tests__/writePathRedaction.test.ts, which pins the same reasoning at
// the Edge Function level.
//
// Split into a wire half (get-game-state/apply-action raw response bodies)
// and a Realtime half: the in-process stack (src/test/supabaseStack/)
// patches only `fetch`, not WebSocket, so it can run the wire half on every
// PR (../__tests__/hiddenInformationWireRunner.test.ts) but not the Realtime
// half, which only ever runs against a live project
// (./hiddenInformationWire.smoke.ts).
//
// Game-specific in what it looks for (`game.picks`, `game.rounds`,
// PICK_NUMBER): replacing src/game/ means re-expressing `disclosedPick` and
// `revealedPick` below for the new game's secret.

import type { SupabaseClient } from '@supabase/supabase-js'
import { applyAction } from '../../engine/applyAction.ts'
import type { Action } from '../../engine/actions.ts'
import type { GameState } from '../../engine/types.ts'
import { buildGenesisState } from '../../lib/gameGenesis.ts'
import { buildFixture, type ProductionGameFixture } from '../fixtures/productionGames/loadFixtures.ts'
import { nextLegalAction, testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'
import { replayFixtureThroughStack } from '../supabaseStack/replayFixture.ts'
import { provisionLiveRoom, type LiveProjectConfig } from './liveProject.ts'
import { fixtureForRoom, type SmokeLogger } from './runSmoke.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-0000000000f9'

const SEATS = testPlayers(
  GAME_ID,
  [0, 1, 2].map((index) => ({ id: `hiw-seat-${index}`, userId: `hiw-user-${index}`, name: `Wire Check Player ${index + 1}` })),
)

const SETTINGS = testGameSettings({ ruleEnforcementEnabled: true, hiddenInformationEnabled: true, gameOptions: { targetScore: 30, maxRounds: 10 } })

function applyOne(state: GameState, action: Action): GameState {
  const result = applyAction(state, action)
  if (!result.ok) throw new Error(`Setup action ${JSON.stringify(action)} was rejected: ${result.error}`)
  return result.state
}

/**
 * One fully resolved round (so the room has revealed history as well as a
 * secret), then exactly one pick of the next round — landing on one seat
 * committed and the other two still pending. Driven straight against the
 * pure engine; `buildHiddenInformationFixture` below is what turns it into
 * something `provisionLiveRoom` can replay for real.
 */
function playToOpenRound(): GameState {
  const game = testGameRow({ id: GAME_ID, createdBy: SEATS[0].user_id, settings: SETTINGS, playerCount: SEATS.length, roomCode: 'HIWTST', name: 'hidden-information wire self-test' })
  let state = buildGenesisState(game, SEATS)
  for (let guard = 0; state.turn < 2; guard++) {
    if (guard > 50) throw new Error('Setup ran on far longer than one round should take.')
    const action = nextLegalAction(state)
    if (!action) throw new Error('Setup ran out of legal actions before the second round opened.')
    state = applyOne(state, action)
  }
  if (state.status !== 'active') throw new Error('The game ended before its second round — raise the target score.')
  const firstPick = nextLegalAction(state)
  if (!firstPick) throw new Error('No legal first pick in the second round.')
  return applyOne(state, firstPick)
}

/** A short, self-verifying fixture (loadFixtures.ts's buildFixture replays it and checks it reproduces itself) ending mid-round, for provisionLiveRoom to open a real room from. */
export function buildHiddenInformationFixture(): ProductionGameFixture {
  return buildFixture(
    'hidden-information-wire',
    { exportedAt: new Date(0).toISOString(), gameState: playToOpenRound() },
    {
      settings: SETTINGS,
      createdBy: SEATS[0].user_id,
      roomCode: 'HIWTST',
      name: 'hidden-information wire self-test',
      userIdByPlayerId: Object.fromEntries(SEATS.map((seat) => [seat.id, seat.user_id])),
    },
  )
}

interface RawWireResponse {
  status: number
  /** Parsed JSON exactly as the server sent it — before gameApi.ts's toClientGameState collapses/truncates it, which is the one step this file exists to look behind. */
  body: unknown
}

/** Mirrors liveProject.ts's own `rawInvoke()` — see this file's own doc comment for why the collapse after it is exactly what has to be bypassed here. */
async function rawInvoke(client: SupabaseClient, name: 'get-game-state' | 'apply-action', body: Record<string, unknown>): Promise<RawWireResponse> {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error) {
    const context = (error as { context?: Response }).context
    if (!context) return { status: 0, body: { ok: false, error: error.message } }
    try {
      return { status: context.status, body: await context.clone().json() }
    } catch {
      return { status: context.status, body: { ok: false, error: error.message } }
    }
  }
  return { status: 200, body: data }
}

/** A still-secret pick: whose it is, what it was, and which round it belongs to. */
interface Secret {
  playerId: string
  value: number
  round: number
}

/** The parts of a response body this check reads — structurally, rather than through RedactedGameState, since this file is deliberately looking at bytes a client never runs through that type. */
interface WireStateLike {
  turn?: number
  game?: { picks?: Record<string, number | null>; rounds?: { round: number; picks: Record<string, number> }[] }
  actionHistory?: { turn: number; action: { type: string; playerId?: string | null; value?: number } }[]
}

/** Every state-shaped thing in a response: a full `state`, and/or a protocol-2 delta's `overlay` plus its `actionHistoryAppend`. */
function wireStates(response: RawWireResponse): WireStateLike[] {
  const body = response.body as { state?: WireStateLike; overlay?: WireStateLike; actionHistoryAppend?: WireStateLike['actionHistory'] }
  const states: WireStateLike[] = []
  if (body.state) states.push(body.state)
  if (body.overlay) states.push(body.overlay)
  if (body.actionHistoryAppend) states.push({ turn: body.overlay?.turn ?? body.state?.turn, actionHistory: body.actionHistoryAppend })
  return states
}

/**
 * Where this response discloses `secret`, if anywhere: the open round's
 * `game.picks`, or a PICK_NUMBER entry of that player's from the secret's own
 * round that still carries its value. Deliberately not a blind "does this
 * number appear anywhere" scan — a small integer is everywhere in a state —
 * but exactly the two places redaction is responsible for.
 */
function disclosedPick(response: RawWireResponse, secret: Secret): string | null {
  for (const state of wireStates(response)) {
    if (state.turn === secret.round && state.game?.picks && state.game.picks[secret.playerId] !== null && state.game.picks[secret.playerId] !== undefined) {
      return `game.picks["${secret.playerId}"] = ${state.game.picks[secret.playerId]}`
    }
    for (const entry of state.actionHistory ?? []) {
      if (entry.turn === secret.round && entry.action.type === 'PICK_NUMBER' && entry.action.playerId === secret.playerId) {
        return `an actionHistory PICK_NUMBER entry (${JSON.stringify(entry.action)})`
      }
    }
  }
  return null
}

/** Whether this response shows `secret` as revealed — its round resolved, with that player's pick in the round's result. */
function revealedPick(response: RawWireResponse, secret: Secret): boolean {
  return wireStates(response).some((state) => state.game?.rounds?.some((round) => round.round === secret.round && round.picks[secret.playerId] === secret.value))
}

function assertOk(response: RawWireResponse, where: string): void {
  const body = response.body as { ok?: boolean; error?: string }
  if (body?.ok !== true) {
    throw new Error(`${where} failed (status ${response.status}): ${body?.error ?? JSON.stringify(response.body)}`)
  }
}

function assertNoLeak(response: RawWireResponse, secret: Secret, where: string): void {
  const leak = disclosedPick(response, secret)
  if (leak) {
    throw new Error(`${where} disclosed a still-secret pick through ${leak} — exactly the leak this check exists to catch:\n${JSON.stringify(response.body)}`)
  }
}

/** The inverse of assertNoLeak, so a masking assertion earlier in the same run can't pass merely because the value never appears anywhere at all. */
function assertRevealed(response: RawWireResponse, secret: Secret, where: string): void {
  if (!revealedPick(response, secret)) {
    throw new Error(`${where} should have revealed the now-resolved pick (${secret.playerId}: ${secret.value}) but didn't.`)
  }
}

function secretOf(action: Action | null | undefined, round: number): Secret {
  if (!action || action.type !== 'PICK_NUMBER') throw new Error(`Expected a PICK_NUMBER action, got ${action?.type ?? 'nothing'}.`)
  return { playerId: action.playerId, value: action.value, round }
}

function assertThat(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/**
 * Subscribes exactly the way gameApi.ts's subscribeToPlayers/subscribeToGame/
 * subscribeToGameState do for a hidden-information game (same tables, same
 * filters — game_state itself is never subscribed to for such a game, only
 * its game_state_meta projection) — but through this room's own throwaway
 * client rather than the app's singleton, and forwarding every raw payload
 * instead of a typed refetch callback, so this file can inspect literal wire
 * bytes rather than trust the client library's own shape for them.
 *
 * Returns `ready`, which resolves only once the channel actually reaches
 * `SUBSCRIBED` (or rejects with whatever status it ended up in instead).
 * The caller must await it before making the writes this check watches for:
 * `.subscribe()` returns before the server has registered this socket's
 * replication filter, so a write made right after calling it can complete —
 * and be missed — before the subscription is actually live.
 */
function subscribeForLeakCheck(client: SupabaseClient, gameId: string, onPayload: (payload: unknown) => void): { ready: Promise<void>; stop: () => void } {
  let settle: (error: Error | null) => void
  const ready = new Promise<void>((resolve, reject) => {
    settle = (error) => (error ? reject(error) : resolve())
  })
  const channel = client
    .channel(`hidden-info-wire-check:${gameId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `game_id=eq.${gameId}` }, onPayload)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` }, onPayload)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state_meta', filter: `game_id=eq.${gameId}` }, onPayload)
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') settle(null)
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        settle(new Error(`Realtime channel for the leak-check watcher ended up ${status} instead of SUBSCRIBED${err ? `: ${err.message}` : ''}.`))
      }
    })
  return {
    ready,
    stop: () => {
      client.removeChannel(channel)
    },
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export interface HiddenInformationWireReport {
  gameId: string
  realtimeChecked: boolean
  /** Only set when realtimeChecked — absence of this being > 0 would mean the check proved nothing. */
  realtimePayloadsObserved?: number
}

/**
 * Opens a real three-seat room via provisionLiveRoom, plays it into an open
 * round with one seat committed, then:
 *
 *  1. Confirms neither still-pending seat's own get-game-state response —
 *     full, or a protocol-2 delta with its overlay — carries the committed
 *     seat's pick.
 *  2. Confirms the *middle* seat's own apply-action response doesn't either
 *     (the write-path scenario — needs the third seat still pending, which
 *     is why this is three seats, not two).
 *  3. Has the last seat resolve the round, and confirms its own response
 *     *does* reveal both earlier picks, so an assertion that never fires
 *     isn't mistaken for one that never leaks — and, once Realtime is
 *     included, that nothing the watcher's subscription saw along the way
 *     carried any game state at all.
 *
 * `includeRealtime: false` runs everything except the Realtime subscription,
 * for the in-process stack, which has no socket for one to connect to.
 */
export async function checkHiddenInformationWire(
  config: LiveProjectConfig,
  options: { includeRealtime: boolean },
  log: SmokeLogger = () => {},
): Promise<HiddenInformationWireReport> {
  const label = 'hidden-information-wire'
  const fixture = buildHiddenInformationFixture()
  log(`start ${label}: provisioning a 3-seat room`)
  const room = await provisionLiveRoom(config, fixture)
  const capturedRealtime: unknown[] = []
  let stopRealtime = () => {}

  try {
    const roomFixture = fixtureForRoom(fixture, room)
    await replayFixtureThroughStack(room, roomFixture)

    let state = (await room.readTrueState())!.state
    assertThat(state.status === 'active' && state.turn === 2, `[${label}] expected the room mid-round 2, got ${state.status}/round ${state.turn}.`)
    assertThat(state.pendingPlayerIds.length === 2, `[${label}] expected two seats still pending after the first pick, got ${state.pendingPlayerIds.length}.`)

    const secret0 = secretOf(room.remapped.history.at(-1)?.action, state.turn)

    // 1. Neither still-pending seat's own get-game-state call sees it — not
    // in a full response, and not in a protocol-2 delta from the start of the
    // round (its append and its in-flight overlay).
    const roundStart = state.actionHistory.length - 1
    for (const seatId of state.pendingPlayerIds) {
      const client = room.clientFor(room.remapped.userIdForPlayer(seatId))
      const full = await rawInvoke(client, 'get-game-state', { gameId: room.game.id })
      assertOk(full, `[${label}] get-game-state as still-pending seat ${seatId}`)
      assertNoLeak(full, secret0, `[${label}] get-game-state response to still-pending seat ${seatId}`)
      const delta = await rawInvoke(client, 'get-game-state', { gameId: room.game.id, sinceActionIndex: roundStart, protocol: 2 })
      assertOk(delta, `[${label}] protocol-2 get-game-state as still-pending seat ${seatId}`)
      assertNoLeak(delta, secret0, `[${label}] protocol-2 get-game-state response to still-pending seat ${seatId}`)
    }

    // The watcher is whichever of the two still-pending seats nextLegalAction
    // does *not* pick next — it won't act until it resolves the round in
    // step 3, so subscribing it to Realtime now covers every write in
    // between without it ever having submitted anything itself yet.
    const watcherSeatId = state.pendingPlayerIds[1]
    const watcherUserId = room.remapped.userIdForPlayer(watcherSeatId)
    if (options.includeRealtime) {
      const subscription = subscribeForLeakCheck(room.clientFor(watcherUserId), room.game.id, (payload) => capturedRealtime.push(payload))
      stopRealtime = subscription.stop
      await subscription.ready
    }

    // 2. The middle seat's own apply-action response must not hand back the
    // first seat's pick either.
    const midSeatId = state.pendingPlayerIds[0]
    const midAction = nextLegalAction(state)
    assertThat(midAction !== null && midAction.playerId === midSeatId, `[${label}] no legal action for the middle seat ${midSeatId}.`)
    const secret1 = secretOf(midAction, state.turn)
    const midRaw = await rawInvoke(room.clientFor(room.remapped.userIdForPlayer(midSeatId)), 'apply-action', { gameId: room.game.id, action: midAction })
    assertOk(midRaw, `[${label}] the middle seat's (${midSeatId}) own action`)
    assertNoLeak(midRaw, secret0, `[${label}] apply-action response to the middle seat ${midSeatId}, before the round resolved`)

    // 3. The watcher's own action resolves the round.
    state = (await room.readTrueState())!.state
    assertThat(
      state.pendingPlayerIds.length === 1 && state.pendingPlayerIds[0] === watcherSeatId,
      `[${label}] expected only the watcher seat (${watcherSeatId}) still pending, got ${JSON.stringify(state.pendingPlayerIds)}.`,
    )
    const lastAction = nextLegalAction(state)
    assertThat(lastAction !== null, `[${label}] no legal action for the last seat ${watcherSeatId}.`)
    const lastRaw = await rawInvoke(room.clientFor(watcherUserId), 'apply-action', { gameId: room.game.id, action: lastAction })
    assertOk(lastRaw, `[${label}] the last seat's (${watcherSeatId}) own action`)
    assertRevealed(lastRaw, secret0, `[${label}] apply-action response once the round resolved`)
    assertRevealed(lastRaw, secret1, `[${label}] apply-action response once the round resolved`)

    let realtimePayloadsObserved: number | undefined
    if (options.includeRealtime) {
      // 60s: the smoke config runs this file before the fixture replays
      // (vitest.smoke.config.ts's AlphabeticalSequencer), but a deploy or a
      // concurrently-running workflow can still delay delivery. The leak scan
      // below is unaffected by a wider window: it only widens how long a
      // payload can arrive before this check gives up on ever seeing one.
      await waitUntil(() => capturedRealtime.length >= 1, 60_000)
      assertThat(
        capturedRealtime.length > 0,
        // Deliberately does NOT blame the connection: `subscribeForLeakCheck`
        // resolves `ready` only on SUBSCRIBED and rejects otherwise, and that
        // promise is awaited before any action is dispatched — so reaching
        // here means it connected and then delivered nothing, which this
        // check cannot tell apart from a real delivery failure.
        `[${label}] the watcher's subscription connected (SUBSCRIBED) but no Realtime payload arrived within 60s, so this check could not prove anything either way. Rule out a deploy or migration touching this project mid-run before treating it as a delivery fault.`,
      )
      // These channels (players, games, game_state_meta) carry no game state
      // by design (0001_baseline.sql section 6: "only which players still
      // have to act, never what anyone chose"), so any trace of a pick at all
      // is a leak.
      for (const payload of capturedRealtime) {
        const text = JSON.stringify(payload)
        if (text.includes('"picks"') || text.includes('PICK_NUMBER') || text.includes('"actionHistory"') || text.includes('"__gz"')) {
          throw new Error(`[${label}] a Realtime payload delivered to the watcher (who hadn't acted yet) carried game state:\n${text}`)
        }
      }
      realtimePayloadsObserved = capturedRealtime.length
    }

    log(
      `ok    ${label}: no secret crossed the wire before its round resolved, revealed once it did` +
        (options.includeRealtime ? ` (${realtimePayloadsObserved} Realtime payload(s) inspected)` : ''),
    )
    return { gameId: room.game.id, realtimeChecked: options.includeRealtime, realtimePayloadsObserved }
  } finally {
    stopRealtime()
    await room.teardown()
  }
}
