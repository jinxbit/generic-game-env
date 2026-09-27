// @vitest-environment node
//
// Self-test for the get-game-state Edge Function against the
// production-simulating Supabase stack (src/test/supabaseStack/) — see
// supabaseStack.test.ts's own doc comment for what "production-simulating"
// means here. gameApi.ts's getGameStateRedacted is the app's only caller
// (GamePage.tsx, for a game with both ruleEnforcementEnabled and
// hiddenInformationEnabled on), so this is where its authorization/
// redaction/opt-in-gating behavior runs against the real canReadGameState()/
// redactStateForPlayer() code paths, rather than just the engine-level
// redaction unit tests.
//
// The secret here is the example game's (src/game/rules.ts): while a round
// is open, another player's pick is `null` in `game.picks` and their
// PICK_NUMBER log entry is a HIDDEN_ACTION placeholder; once the round
// resolves, both are revealed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildGameLogFrom } from '../../engine/gameLog.ts'
import { applyRedactedGameStateDelta, toClientGameState, type RedactedLoggedAction } from '../../engine/redaction.ts'
import { applyInFlightOverlay, type InFlightOverlay } from '../../engine/inFlightOverlay.ts'
import { extendReplay, replayActions } from '../../engine/replay.ts'
import { hashGameStateView } from '../../lib/gameStateHash.ts'
import type { LoggedAction } from '../../engine/actions.ts'
import type { GameState } from '../../engine/types.ts'
import { buildGenesisState } from '../../lib/gameGenesis.ts'
import type { GameRow, GameSettings } from '../../lib/dbTypes.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-000000000002'
const ALICE = 'auth-user-alice' // room owner, seated
const BOB = 'auth-user-bob' // seated
const CAROL = 'auth-user-carol' // unseated stranger
const ADMIN = 'auth-user-admin' // unseated site admin

const PLAYERS = testPlayers(GAME_ID, [
  { id: 'seat-alice', userId: ALICE, name: 'Alice' },
  { id: 'seat-bob', userId: BOB, name: 'Bob' },
])

/** This file's default is opted in — most tests here exercise actual redaction. The "not opted in"/hotseat tests override it. */
function settingsFor(overrides: Partial<GameSettings> = {}): GameSettings {
  return testGameSettings({ hiddenInformationEnabled: true, ...overrides })
}

function gameRow(settings: GameSettings, playMode: GameRow['play_mode'] = 'live'): GameRow {
  return testGameRow({ id: GAME_ID, createdBy: ALICE, settings, playerCount: PLAYERS.length, playMode, roomCode: 'GETST', name: 'get-game-state self-test' })
}

const BOB_PICK = 4
const ALICE_PICK = 2

describe('get-game-state Edge Function', () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  /** Seeds a started game, still on its first round with both seats pending. */
  async function seedRoundOne(settingsOverrides: Partial<GameSettings> = {}, playMode: GameRow['play_mode'] = 'live'): Promise<GameState> {
    const game = gameRow(settingsFor(settingsOverrides), playMode)
    const genesis = buildGenesisState(game, PLAYERS)
    await stack.seedStartedGame({ game, players: PLAYERS, genesis })
    stack.addUser(CAROL)
    stack.addUser(ADMIN, { isAdmin: true })
    expect(genesis.pendingPlayerIds).toEqual(['seat-alice', 'seat-bob'])
    return genesis
  }

  async function bobPicks(): Promise<void> {
    const picked = await stack.applyAction(BOB, GAME_ID, { type: 'PICK_NUMBER', playerId: 'seat-bob', value: BOB_PICK })
    if (!picked.ok) throw new Error(picked.error)
  }

  async function fullRead(userId: string) {
    const read = await stack.getGameState(userId, GAME_ID)
    if (!read.ok) throw new Error(read.error)
    if ('actionHistoryAppend' in read) throw new Error('expected a full response — no sinceActionIndex was sent')
    return read
  }

  it("hides another player's in-progress pick from a seated player, including the room owner", async () => {
    await seedRoundOne()
    await bobPicks()

    // Alice is the room owner — which earns her no special visibility into
    // Bob's still-secret pick.
    const asOwner = await fullRead(ALICE)
    expect(asOwner.state.pendingPlayerIds).toEqual(['seat-alice'])
    expect(asOwner.state.game.picks['seat-bob']).toBeNull()
    expect(asOwner.state.actionHistory).toEqual([expect.objectContaining({ action: { type: 'HIDDEN_ACTION', playerId: 'seat-bob' } })])
    expect(JSON.stringify(asOwner.state)).not.toContain('"value"')

    // Bob sees his own real pick.
    const asBob = await fullRead(BOB)
    expect(asBob.state.game.picks['seat-bob']).toBe(BOB_PICK)
    expect(asBob.state.actionHistory[0].action).toEqual({ type: 'PICK_NUMBER', playerId: 'seat-bob', value: BOB_PICK })
  })

  it('gives a site admin the real pick, in the same RedactedGameState shape everyone else gets', async () => {
    await seedRoundOne()
    await bobPicks()

    const asAdmin = await fullRead(ADMIN)
    // Nothing is actually masked (revealedGameStateView, not
    // redactStateForPlayer) — but the response is the same shape as every
    // other caller's, so gameApi.ts's toClientGameState never has to sniff
    // which shape it got back.
    expect(asAdmin.state.game.picks['seat-bob']).toBe(BOB_PICK)
    expect(asAdmin.state.actionHistory[0].action.type).toBe('PICK_NUMBER')
  })

  it("doesn't redact a game that hasn't opted into hiddenInformationEnabled, even with ruleEnforcementEnabled on", async () => {
    await seedRoundOne({ hiddenInformationEnabled: false })
    await bobPicks()

    const asOwner = await fullRead(ALICE)
    expect(asOwner.state.game.picks['seat-bob']).toBe(BOB_PICK)
  })

  it('never redacts a hotseat game, regardless of hiddenInformationEnabled', async () => {
    await seedRoundOne({ hiddenInformationEnabled: true }, 'hotseat')
    await bobPicks()

    // Asking as Alice's own auth user still sees Bob's real pick: one shared
    // auth.uid() per local device means per-seat masking would just hide a
    // local player's own pick from the device they're using to make it.
    const asAlice = await fullRead(ALICE)
    expect(asAlice.state.game.picks['seat-bob']).toBe(BOB_PICK)
  })

  it('lets a signed-in stranger read a started game redacted with no seat of their own, but refuses a lobby game', async () => {
    await seedRoundOne()
    await bobPicks()

    const asStranger = await fullRead(CAROL)
    expect(asStranger.state.game.picks['seat-bob']).toBeNull()
    expect(asStranger.state.actionHistory[0].action.type).toBe('HIDDEN_ACTION')

    // A lobby-status game is invisible to a non-seated, non-admin stranger —
    // the same gate game_state's RLS draws (0001_baseline.sql section 8),
    // reimplemented in canReadGameState since the service-role client
    // bypasses it.
    const lobbyGame = stack.db.table<{ id: string; status: string }>('games').find((row) => row.id === GAME_ID)!
    lobbyGame.status = 'lobby'
    stack.db.replaceRow('games', lobbyGame)
    const blocked = await stack.getGameState(CAROL, GAME_ID)
    expect(blocked).toMatchObject({ ok: false, status: 403 })

    // A seated player is unaffected by the game being in the lobby.
    const stillOk = await stack.getGameState(ALICE, GAME_ID)
    expect(stillOk.ok).toBe(true)
  })

  it('refuses an unauthenticated caller', async () => {
    await seedRoundOne()
    const { error } = await stack.anonClient().functions.invoke('get-game-state', { body: { gameId: GAME_ID } })
    expect((error as { context?: Response }).context?.status).toBe(401)
  })

  it('404s for a game with no state yet', async () => {
    stack.addUser(ALICE)
    const missing = await stack.getGameState(ALICE, '3f1c2d4e-0000-4000-8000-00000000dead')
    expect(missing).toMatchObject({ ok: false, status: 404 })
  })

  it('the client-side collapse (toClientGameState) of a redacted response never breaks the game log while a pick is still pending', async () => {
    const genesis = await seedRoundOne()
    await bobPicks()

    const client = toClientGameState((await fullRead(ALICE)).state)
    // Bob's still-secret pick simply isn't in the truncated actionHistory
    // yet (unredactedPrefix) — the log must not try to replay a masked entry.
    expect(client.actionHistory).toEqual([])
    const log = buildGameLogFrom(genesis, client.actionHistory)
    expect(log.ok).toBe(true)
    expect(log.events.some((event) => event.message.includes(String(BOB_PICK)))).toBe(false)
  })

  it('reveals both picks once the round resolves and moves on', async () => {
    await seedRoundOne()
    await bobPicks()
    const resolved = await stack.applyAction(ALICE, GAME_ID, { type: 'PICK_NUMBER', playerId: 'seat-alice', value: ALICE_PICK })
    if (!resolved.ok) throw new Error(resolved.error)
    expect(resolved.state.turn).toBe(2)

    const asOwner = await fullRead(ALICE)
    expect(asOwner.state.game.rounds[0].picks).toEqual({ 'seat-alice': ALICE_PICK, 'seat-bob': BOB_PICK })
    expect(asOwner.state.actionHistory.map((entry) => entry.action.type)).toEqual(['PICK_NUMBER', 'PICK_NUMBER'])
    // The new round's picks are all open again.
    expect(asOwner.state.game.picks).toEqual({ 'seat-alice': null, 'seat-bob': null })
  })

  describe('response telemetry', () => {
    /** The `x-state-shape`/`x-state-reason` pair, which is also what the log line records. */
    async function tagsFor(userId: string, body: Record<string, unknown>) {
      const raw = await stack.rawInvoke(userId, 'get-game-state', body)
      expect(raw.status).toBe(200)
      return { shape: raw.headers.get('x-state-shape'), reason: raw.headers.get('x-state-reason'), body: raw.body as Record<string, unknown> }
    }

    it('tags a delta, a cold start and a protocol-1 caller differently', async () => {
      await seedRoundOne()
      const cold = await tagsFor(ALICE, { gameId: GAME_ID, protocol: 2 })
      expect(cold).toMatchObject({ shape: 'full', reason: 'cold-start' })

      const prefixLength = toClientGameState(cold.body.state as never).actionHistory.length
      const delta = await tagsFor(ALICE, { gameId: GAME_ID, sinceActionIndex: prefixLength, protocol: 2 })
      expect(delta).toMatchObject({ shape: 'delta', reason: 'ok' })

      // A client that never learned about protocol 2 is counted separately, so
      // "stale bundles still out there" is a number rather than a guess.
      const old = await tagsFor(ALICE, { gameId: GAME_ID })
      expect(old).toMatchObject({ shape: 'full', reason: 'protocol-1' })
    })

    it('separates a client whose rebuild disagreed from one that simply had no cache', async () => {
      // Both arrive as "protocol 2, no cursor", and only one of them means
      // this client's engine and the server's produced different states.
      await seedRoundOne()
      const mismatch = await tagsFor(ALICE, { gameId: GAME_ID, protocol: 2, fallbackReason: 'hash-mismatch' })
      expect(mismatch).toMatchObject({ shape: 'full', reason: 'hash-mismatch' })
    })

    it('tags a caller asking from beyond the safe prefix as its own case', async () => {
      await seedRoundOne()
      const beyond = await tagsFor(ALICE, { gameId: GAME_ID, sinceActionIndex: 9999, protocol: 2 })
      expect(beyond).toMatchObject({ shape: 'full', reason: 'prefix-moved-back' })
    })

    it('never lets a client put an arbitrary string in the reason', async () => {
      // fallbackReason is client-supplied and lands in a log line, so anything
      // unrecognised collapses to 'other' rather than reaching the log as-is.
      await seedRoundOne()
      const forged = await tagsFor(ALICE, { gameId: GAME_ID, protocol: 2, fallbackReason: '{"evt":"state_response","shape":"delta"}\n' })
      expect(forged).toMatchObject({ shape: 'full', reason: 'other' })

      const nonsense = await tagsFor(ALICE, { gameId: GAME_ID, protocol: 2, fallbackReason: 12345 })
      expect(nonsense).toMatchObject({ shape: 'full', reason: 'cold-start' })
    })
  })

  describe('replay delta (protocol 2)', () => {
    /** Rebuilds a viewer's state the way gameApi.ts's getGameStateRedacted does: replay what they may see, lay the overlay over what they may not. */
    function rebuild(genesis: GameState, base: GameState, delta: { actionHistoryAppend: RedactedLoggedAction[]; overlay?: InFlightOverlay }) {
      const next = extendReplay(genesis, base, delta.actionHistoryAppend as unknown as LoggedAction[])
      return applyInFlightOverlay(next, delta.overlay)
    }

    /** A viewer's base: the state replayed up to their safe prefix. */
    async function baseFor(userId: string, genesis: GameState): Promise<GameState> {
      const view = toClientGameState((await fullRead(userId)).state)
      return { ...replayActions(genesis, view.actionHistory), actionHistory: view.actionHistory }
    }

    it('sends no materialised state at all, and the caller rebuilds exactly what a full fetch would have given', async () => {
      const genesis = await seedRoundOne()
      const base = await baseFor(ALICE, genesis)
      await bobPicks()

      const delta = await stack.getGameState(ALICE, GAME_ID, base.actionHistory.length, 2)
      if (!delta.ok) throw new Error(delta.error)
      if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')
      expect(delta).not.toHaveProperty('state')

      const rebuilt = rebuild(genesis, base, delta)
      expect(hashGameStateView(rebuilt)).toBe(delta.stateHash)

      // ...and it matches what the state-carrying path would have said.
      expect(rebuilt).toEqual(toClientGameState((await fullRead(ALICE)).state))
      // Alice still cannot see what Bob picked — rebuilding is not a way around redaction.
      expect(rebuilt.game.picks['seat-bob']).toBeNull()
    })

    it("carries an overlay while a pick is pending, because the viewer's own replay cannot reach it", async () => {
      const genesis = await seedRoundOne()
      const prefixLength = (await baseFor(ALICE, genesis)).actionHistory.length
      await bobPicks()

      const delta = await stack.getGameState(ALICE, GAME_ID, prefixLength, 2)
      if (!delta.ok) throw new Error(delta.error)
      if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')
      // Bob's pick is masked, so it is not in Alice's appendable log at all —
      // the overlay is the only thing telling her the round moved.
      expect(delta.actionHistoryAppend).toEqual([])
      expect(delta.actionHistoryLength).toBe(0)
      expect(delta.overlay).toBeDefined()
      expect(delta.overlay!.pendingPlayerIds).toEqual(['seat-alice'])
      expect(delta.overlay!.game.picks['seat-bob']).toBeNull()
      expect(delta.overlay).not.toHaveProperty('actionHistory')
    })

    it('omits the overlay entirely once nothing is in flight', async () => {
      const genesis = await seedRoundOne()
      const prefixLength = (await baseFor(ALICE, genesis)).actionHistory.length

      const delta = await stack.getGameState(ALICE, GAME_ID, prefixLength, 2)
      if (!delta.ok) throw new Error(delta.error)
      if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')
      expect(delta.overlay).toBeUndefined()
    })

    it("includes the viewer's own pick in the append — only other players' picks are withheld", async () => {
      const genesis = await seedRoundOne()
      const base = await baseFor(BOB, genesis)
      await bobPicks()

      const delta = await stack.getGameState(BOB, GAME_ID, base.actionHistory.length, 2)
      if (!delta.ok) throw new Error(delta.error)
      if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')
      expect(delta.actionHistoryAppend.map((entry) => entry.action)).toEqual([{ type: 'PICK_NUMBER', playerId: 'seat-bob', value: BOB_PICK }])
      // Nothing Bob can't see is in flight, so his replay alone is the answer.
      expect(delta.overlay).toBeUndefined()
      expect(hashGameStateView(rebuild(genesis, base, delta))).toBe(delta.stateHash)
    })

    it('a client that asks from beyond the safe prefix gets a full state, not a delta it cannot use', async () => {
      await seedRoundOne()
      const beyond = await stack.getGameState(ALICE, GAME_ID, 9999, 2)
      if (!beyond.ok) throw new Error(beyond.error)
      expect(beyond).toHaveProperty('state')
      // A full protocol-2 response still carries the hash, so a client seeding
      // its base by replaying from genesis can check its engine agrees at once.
      expect(beyond).toHaveProperty('stateHash')
    })

    it('leaves a client that never asks for protocol 2 on the old shape', async () => {
      await seedRoundOne()
      const prefixLength = toClientGameState((await fullRead(ALICE)).state).actionHistory.length

      const old = await stack.getGameState(ALICE, GAME_ID, prefixLength)
      if (!old.ok) throw new Error(old.error)
      if (!('actionHistoryAppend' in old)) throw new Error('expected an incremental response')
      // The protocol-1 contract, unchanged: a materialised state and no hash.
      expect(old).toHaveProperty('state')
      expect(old).not.toHaveProperty('stateHash')
    })
  })

  describe('incremental actionHistory (sinceActionIndex, protocol 1)', () => {
    it("answers with just the entries logged since the caller's own cached prefix, splicing back to the same GameState a full fetch would give", async () => {
      await seedRoundOne({ hiddenInformationEnabled: false })
      const baselineClient = toClientGameState((await fullRead(ALICE)).state)

      const first = await stack.applyAction(ALICE, GAME_ID, { type: 'PICK_NUMBER', playerId: 'seat-alice', value: ALICE_PICK })
      if (!first.ok) throw new Error(first.error)
      await bobPicks()

      const delta = await stack.getGameState(ALICE, GAME_ID, baselineClient.actionHistory.length)
      if (!delta.ok) throw new Error(delta.error)
      if (!('actionHistoryAppend' in delta)) throw new Error('expected an incremental response')
      expect(delta.actionHistoryFrom).toBe(baselineClient.actionHistory.length)
      expect(delta.actionHistoryAppend.map((entry) => entry.action.type)).toEqual(['PICK_NUMBER', 'PICK_NUMBER'])

      const merged = applyRedactedGameStateDelta(baselineClient.actionHistory, delta)
      expect(merged).not.toBeNull()
      expect(toClientGameState(merged!)).toEqual(toClientGameState((await fullRead(ALICE)).state))
    })

    it('falls back to a full response, unchanged, when sinceActionIndex is out of range', async () => {
      await seedRoundOne()
      await bobPicks()
      const fullFetch = await fullRead(ALICE)

      // Absurdly far ahead of anything this game could actually have logged.
      const outOfRange = await stack.getGameState(ALICE, GAME_ID, 999999)
      if (!outOfRange.ok) throw new Error(outOfRange.error)
      if ('actionHistoryAppend' in outOfRange) throw new Error('expected a full response')
      expect(outOfRange.state).toEqual(fullFetch.state)
    })

    it("serves a hidden-information game's newly-safe entries once a round resolves, for a caller asking from its own already-truncated prefix", async () => {
      await seedRoundOne()
      await bobPicks()

      // Alice's own client-side state right now has Bob's still-secret pick
      // truncated out of actionHistory entirely (unredactedPrefix) — this is
      // the prefix length a real client would send as sinceActionIndex.
      const beforeResolveClient = toClientGameState((await fullRead(ALICE)).state)
      expect(beforeResolveClient.actionHistory).toHaveLength(0)

      const resolved = await stack.applyAction(ALICE, GAME_ID, { type: 'PICK_NUMBER', playerId: 'seat-alice', value: ALICE_PICK })
      if (!resolved.ok) throw new Error(resolved.error)

      const delta = await stack.getGameState(ALICE, GAME_ID, beforeResolveClient.actionHistory.length)
      if (!delta.ok) throw new Error(delta.error)
      if (!('actionHistoryAppend' in delta)) throw new Error('expected an incremental response')
      // Bob's pick (now safe to show) and Alice's own both arrive in this one
      // append, in the order they were actually logged.
      expect(delta.actionHistoryAppend.map((entry) => entry.action)).toEqual([
        { type: 'PICK_NUMBER', playerId: 'seat-bob', value: BOB_PICK },
        { type: 'PICK_NUMBER', playerId: 'seat-alice', value: ALICE_PICK },
      ])

      const merged = applyRedactedGameStateDelta(beforeResolveClient.actionHistory, delta)
      expect(merged).not.toBeNull()
      expect(toClientGameState(merged!)).toEqual(toClientGameState((await fullRead(ALICE)).state))
    })
  })
})
