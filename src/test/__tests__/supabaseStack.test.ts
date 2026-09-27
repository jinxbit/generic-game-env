// @vitest-environment node
//
// Self-test for the production-simulating Supabase stack
// (src/test/supabaseStack/). Everything the recorded-game replays in
// ./productionGames.test.ts rely on is proven here against games this file
// plays itself: that the real Edge Functions run, that their authorization
// branches fire, that game_state's compare-and-swap, RLS and triggers behave
// the way supabase/migrations/0001_baseline.sql says, and that a game
// reconstructed from an export is the same game.
//
// Runs in the `node` environment rather than the project-wide jsdom one:
// nothing here touches the DOM, and the Edge Functions are Deno server code,
// so a browser-shaped global scope only adds noise (auth-js warns about
// multiple clients per "browser context", which is exactly what several
// simulated players are).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Action, GameState } from '@game-platform/sdk'
import { buildGenesisState } from '../../lib/gameGenesis.ts'
import type { GameSettings } from '../../lib/dbTypes.ts'
import { encodeGameStateExport, decodeGameStateExport } from '../../lib/gameStateExport.ts'
import type { CompressedGameState } from '../../lib/gameStateCompression.ts'
import { buildFixture, stripTimestamps } from '../fixtures/productionGames/loadFixtures.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { gameData, nextLegalAction, pickAction, testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'
import { normalizeForComparison, replayFixtureThroughStack } from '../supabaseStack/replayFixture.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-000000000001'
const ALICE = 'auth-user-alice' // room owner, seated
const BOB = 'auth-user-bob' // seated
const CAROL = 'auth-user-carol' // unseated stranger

const PLAYERS = testPlayers(GAME_ID, [
  { id: 'seat-alice', userId: ALICE, name: 'Alice' },
  { id: 'seat-bob', userId: BOB, name: 'Bob' },
])

const userIdForSeat: Record<string, string> = { 'seat-alice': ALICE, 'seat-bob': BOB }

function gameRow(settings: GameSettings = testGameSettings(), playMode: 'live' | 'async' | 'hotseat' = 'live') {
  return testGameRow({ id: GAME_ID, createdBy: ALICE, settings, playerCount: PLAYERS.length, playMode })
}

async function seed(stack: ProductionStack, settings = testGameSettings(), playMode: 'live' | 'async' | 'hotseat' = 'live'): Promise<GameState> {
  const game = gameRow(settings, playMode)
  const genesis = buildGenesisState(game, PLAYERS)
  await stack.seedStartedGame({ game, players: PLAYERS, genesis })
  return genesis
}

/**
 * Plays the game forward through the real apply-action Edge Function, one
 * legal action at a time, each submitted by the signed-in user who actually
 * holds that seat — i.e. the way a live game is played, not the way a test
 * fixture is assembled.
 */
async function playThroughStack(stack: ProductionStack, from: GameState, maxActions: number): Promise<{ state: GameState; version: number; actions: Action[] }> {
  let state = from
  let version = 0
  const actions: Action[] = []
  for (let i = 0; i < maxActions; i++) {
    const action = nextLegalAction(state)
    if (!action) break
    // nextLegalAction only ever returns seat-owned picks, never the
    // nullable-playerId pointer moves.
    const result = await stack.applyAction(userIdForSeat[action.playerId ?? ''], GAME_ID, action)
    if (!result.ok) throw new Error(`apply-action rejected ${action.type} by ${action.playerId}: ${result.error}`)
    expect(result.version).toBe(version + 1)
    state = result.state
    version = result.version
    actions.push(action)
  }
  return { state, version, actions }
}

describe('production Supabase stack', () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('plays a whole game through the real Edge Functions, and the stored state stays the authority', async () => {
    const genesis = await seed(stack)
    const { state, version, actions } = await playThroughStack(stack, genesis, 200)

    // Every one of those actions a separate authenticated call into
    // apply-action, and the game actually reached its end.
    expect(state.status).toBe('completed')
    expect(state.winnerPlayerIds.length).toBeGreaterThan(0)
    expect(state.turn).toBeGreaterThanOrEqual(2)
    expect(state.actionHistory).toHaveLength(actions.length)

    // What the function returned is what a fresh client read gets back.
    const read = await stack.readGameState(BOB, GAME_ID)
    expect(read?.version).toBe(version)
    expect(stripTimestamps(read!.state)).toEqual(stripTimestamps(state))
  })

  it('stores an enforced game gzipped, with the plaintext keys game_state_sync_meta reads', async () => {
    const genesis = await seed(stack)
    const { state, version } = await playThroughStack(stack, genesis, 3)
    expect(state.status).toBe('active')

    // Written by writeGameStateCAS, so compressed — the plaintext
    // duplication has to survive, or the meta trigger goes blind.
    const stored = stack.db.table<{ state: CompressedGameState }>('game_state')[0].state
    expect(stored.__gz).toBeTypeOf('string')
    expect(stored).toMatchObject({ status: state.status, phase: state.phase, turn: state.turn, pendingPlayerIds: state.pendingPlayerIds })

    const meta = stack.db.table<{ status: string; phase: string | null; turn: number; version: number; pending_player_ids: string[] }>('game_state_meta')[0]
    expect(meta).toMatchObject({ version, status: 'active', phase: state.phase, turn: state.turn, pending_player_ids: state.pendingPlayerIds })
    // Never 'unknown' — that was the symptom when the trigger couldn't read a gzipped state.
    expect(meta.status).not.toBe('unknown')
  })

  it('projects no pending players into game_state_meta once the game is over', async () => {
    const genesis = await seed(stack)
    const { state } = await playThroughStack(stack, genesis, 200)
    expect(state.status).toBe('completed')

    const meta = stack.db.table<{ status: string; phase: string | null; pending_player_ids: string[] }>('game_state_meta')[0]
    expect(meta).toMatchObject({ status: 'completed', phase: null, pending_player_ids: [] })
  })

  it("refuses one player's attempt to act on another's behalf", async () => {
    const genesis = await seed(stack)
    const action = nextLegalAction(genesis)!
    expect(action.playerId).toBe('seat-alice')

    const result = await stack.applyAction(BOB, GAME_ID, action)
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect((await stack.readGameState(ALICE, GAME_ID))?.version).toBe(0)
  })

  it('refuses an unauthenticated caller', async () => {
    const genesis = await seed(stack)
    const action = nextLegalAction(genesis)!

    const { error } = await stack.anonClient().functions.invoke('apply-action', { body: { gameId: GAME_ID, action } })
    expect((error as { context?: Response }).context?.status).toBe(401)
  })

  it('rejects an illegal action with the engine’s own message, and leaves the row untouched', async () => {
    await seed(stack)
    const result = await stack.applyAction(ALICE, GAME_ID, pickAction('seat-alice', 99))
    expect(result).toMatchObject({ ok: false, status: 400 })
    if (!result.ok) expect(result.error).toMatch(/whole number from 1 to/)
    expect((await stack.readGameState(ALICE, GAME_ID))?.version).toBe(0)
  })

  it('serializes concurrent submissions of the same action with a 409, not a lost update', async () => {
    const genesis = await seed(stack)
    const action = nextLegalAction(genesis)!

    const [first, second] = await Promise.all([stack.applyAction(ALICE, GAME_ID, action), stack.applyAction(ALICE, GAME_ID, action)])
    const statuses = [first.status, second.status].sort()
    expect(statuses).toEqual([200, 409])
    // Exactly one of them landed.
    expect((await stack.readGameState(ALICE, GAME_ID))?.version).toBe(1)
  })

  it('undoes and redoes through the real undo-action/redo-action functions', async () => {
    const genesis = await seed(stack)
    const { state, version } = await playThroughStack(stack, genesis, 3)

    const undone = await stack.undoAction(BOB, GAME_ID)
    if (!undone.ok) throw new Error(undone.error)
    expect(undone.version).toBe(version + 1)
    expect(undone.state.actionHistory.at(-1)?.action.type).toBe('UNDO_ACTION')

    const redone = await stack.redoAction(BOB, GAME_ID)
    if (!redone.ok) throw new Error(redone.error)
    expect(redone.state.actionHistory.at(-1)?.action.type).toBe('REDO_ACTION')
    // Redo puts the game back exactly where it was, modulo the two markers
    // the undo/redo pair appended to the log.
    expect(stripTimestamps({ ...redone.state, actionHistory: state.actionHistory })).toEqual(stripTimestamps(state))
  })

  it('takes a concede from the conceding seat, and ends a two-player game on the spot', async () => {
    await seed(stack)
    // Bob can't concede on Alice's behalf...
    const refused = await stack.applyAction(BOB, GAME_ID, { type: 'CONCEDE', playerId: 'seat-alice' })
    expect(refused).toMatchObject({ ok: false, status: 403 })

    // ...but can for himself, and with one player left the game is over.
    const conceded = await stack.applyAction(BOB, GAME_ID, { type: 'CONCEDE', playerId: 'seat-bob' })
    expect(conceded.ok).toBe(true)

    const read = await stack.readGameState(BOB, GAME_ID)
    expect(read?.state).toMatchObject({ status: 'completed', winnerPlayerIds: ['seat-alice'] })
    expect(read?.state.players.find((player) => player.id === 'seat-bob')).toMatchObject({ eliminated: true, conceded: true })
  })

  describe('row level security', () => {
    it('blocks a seated player from writing an enforced game’s state directly (section 7)', async () => {
      const genesis = await seed(stack)
      const { state, version } = await playThroughStack(stack, genesis, 3)

      // gameApi.ts's writeGameState, verbatim in shape. RLS hides the row from
      // the UPDATE rather than erroring, so this reads as "someone else got
      // there first" — zero rows changed.
      const { data, error } = await stack
        .clientFor(ALICE)
        .from('game_state')
        .update({ state: { ...state, turn: 999 }, turn: 999, active_player_id: null, version: version + 1 })
        .eq('game_id', GAME_ID)
        .eq('version', version)
        .select('version')
      expect(error).toBeNull()
      expect(data).toEqual([])
      expect((await stack.readGameState(ALICE, GAME_ID))?.state.turn).toBe(state.turn)
    })

    it('still allows a direct write when the game did not opt into enforcement', async () => {
      const genesis = await seed(stack, testGameSettings({ ruleEnforcementEnabled: false }))

      const { data, error } = await stack
        .clientFor(ALICE)
        .from('game_state')
        .update({ state: { ...genesis, turn: 7 }, turn: 7, active_player_id: null, version: 1 })
        .eq('game_id', GAME_ID)
        .eq('version', 0)
        .select('version')
      expect(error).toBeNull()
      expect(data).toEqual([{ version: 1 }])
      expect(stack.db.table<{ turn: number }>('game_state_meta')[0].turn).toBe(7)
    })

    it('lets a signed-in stranger read a started game’s state, but not a lobby one (section 8)', async () => {
      await seed(stack)
      stack.addUser(CAROL)
      // Any signed-in user may read a non-lobby game's state, seated or not —
      // that is what makes a room spectatable.
      expect(await stack.readGameState(CAROL, GAME_ID)).not.toBeNull()

      // The same row is invisible to that stranger while the room is still in
      // the lobby, and stays readable for the players seated in it.
      const lobbyGame = stack.db.table<{ id: string; status: string }>('games').find((row) => row.id === GAME_ID)!
      lobbyGame.status = 'lobby'
      stack.db.replaceRow('games', lobbyGame)
      expect(await stack.readGameState(CAROL, GAME_ID)).toBeNull()
      expect(await stack.readGameState(ALICE, GAME_ID)).not.toBeNull()
    })

    it('blocks direct game_state reads entirely for a hiddenInformationEnabled game — seated player included (section 8)', async () => {
      await seed(stack, testGameSettings({ hiddenInformationEnabled: true }))
      stack.addUser(CAROL)
      stack.addUser('auth-user-admin', { isAdmin: true })

      // A seated player gets nothing beyond what get-game-state would give
      // them: RLS can't redact within a row, so the raw row is off-limits to
      // everyone but the service role, not just to a non-seated stranger.
      expect(await stack.readGameState(ALICE, GAME_ID)).toBeNull()
      expect(await stack.readGameState(BOB, GAME_ID)).toBeNull()
      expect(await stack.readGameState(CAROL, GAME_ID)).toBeNull()

      // The redacted read path is untouched — it's the service role client
      // underneath, which bypasses RLS regardless of this policy.
      const viaRedactedPath = await stack.getGameState(ALICE, GAME_ID)
      expect(viaRedactedPath.ok).toBe(true)

      // "admins can read any game state" is a separate, additive permissive
      // policy — untouched by this lockdown.
      expect(await stack.readGameState('auth-user-admin', GAME_ID)).not.toBeNull()
    })

    it('leaves direct game_state reads unchanged for a game that has not opted into hidden information', async () => {
      await seed(stack, testGameSettings({ hiddenInformationEnabled: false }))
      stack.addUser(CAROL)

      expect(await stack.readGameState(ALICE, GAME_ID)).not.toBeNull()
      expect(await stack.readGameState(CAROL, GAME_ID)).not.toBeNull()
    })

    it('keeps profiles own-row only', async () => {
      await seed(stack)
      const { data } = await stack.clientFor(ALICE).from('profiles').select('user_id')
      expect(data).toEqual([{ user_id: ALICE }])
    })
  })

  describe('triggers (0001_baseline.sql)', () => {
    it('never lets a signed-in user grant themselves is_admin, on insert or update (profiles_enforce_is_admin_unchanged)', async () => {
      stack.addUser(CAROL)
      stack.addUser('auth-user-dave')
      // addUser seeds a profile row directly; drop Dave's so the insert path can be exercised.
      stack.db.deleteProfileFor('auth-user-dave')

      const insert = await stack.clientFor('auth-user-dave').from('profiles').insert({ user_id: 'auth-user-dave', is_admin: true })
      expect(insert.error?.message).toMatch(/is_admin can only be granted by an administrator/)
      expect(stack.db.table<{ user_id: string }>('profiles').some((row) => row.user_id === 'auth-user-dave')).toBe(false)

      // An ordinary own-row insert, without the flag, is still fine.
      const plainInsert = await stack.clientFor('auth-user-dave').from('profiles').insert({ user_id: 'auth-user-dave', display_name: 'Dave' })
      expect(plainInsert.error).toBeNull()

      const update = await stack.clientFor(CAROL).from('profiles').update({ is_admin: true }).eq('user_id', CAROL)
      expect(update.error?.message).toMatch(/is_admin can only be changed by an administrator/)
      expect(stack.db.table<{ user_id: string; is_admin: boolean }>('profiles').find((row) => row.user_id === CAROL)?.is_admin).toBe(false)

      // Other own-row edits are unaffected, as is the service role.
      const rename = await stack.clientFor(CAROL).from('profiles').update({ display_name: 'Carol' }).eq('user_id', CAROL)
      expect(rename.error).toBeNull()
      stack.db.update({ role: 'service_role', userId: null }, 'profiles', (row) => row.user_id === CAROL, { is_admin: true })
      expect(stack.db.table<{ user_id: string; is_admin: boolean }>('profiles').find((row) => row.user_id === CAROL)?.is_admin).toBe(true)
    })

    it('polices room status transitions, names and config (games triggers, section 3)', async () => {
      stack.addUser(ALICE)
      const owner = stack.clientFor(ALICE)
      const { data: room, error } = await owner
        .from('games')
        .insert({ room_code: 'TRIG01', name: 'Trigger room', play_mode: 'live', created_by: ALICE, settings: testGameSettings() })
        .select()
        .single()
      expect(error).toBeNull()
      expect(room).toMatchObject({ status: 'lobby', config_version: 0 })

      // Editing settings in the lobby bumps config_version.
      const edited = await owner.from('games').update({ settings: testGameSettings({ hiddenInformationEnabled: true }) }).eq('id', room.id).select('config_version').single()
      expect(edited.data).toEqual({ config_version: 1 })

      // The name is immutable.
      const renamed = await owner.from('games').update({ name: 'Another name' }).eq('id', room.id)
      expect(renamed.error?.message).toMatch(/Room name cannot be changed/)

      // A rule-enforced room can't be started by a direct client write.
      const started = await owner.from('games').update({ status: 'active' }).eq('id', room.id)
      expect(started.error?.message).toMatch(/start-game Edge Function/)

      // lobby -> canceled is legal; canceled -> lobby is not.
      expect((await owner.from('games').update({ status: 'canceled' }).eq('id', room.id)).error).toBeNull()
      const reopened = await owner.from('games').update({ status: 'lobby' }).eq('id', room.id)
      expect(reopened.error?.message).toMatch(/Invalid room status transition: canceled -> lobby/)

      // Config can't change outside the lobby.
      const lateEdit = await owner.from('games').update({ max_players: 3 }).eq('id', room.id)
      expect(lateEdit.error?.message).toMatch(/Configuration can only change/)
    })

    it('only lets the owner delete a room once it is canceled, unless they are an admin (section 3)', async () => {
      await seed(stack)
      stack.addUser('auth-user-admin', { isAdmin: true })

      // An active room is not in a deletable state for its owner: RLS filters
      // it out of the DELETE, silently.
      const early = await stack.clientFor(ALICE).from('games').delete().eq('id', GAME_ID).select('id')
      expect(early.data).toEqual([])
      expect(stack.db.table('games')).toHaveLength(1)

      // Cancel first, then it goes — and takes its rows with it.
      expect((await stack.clientFor(ALICE).from('games').update({ status: 'canceled' }).eq('id', GAME_ID)).error).toBeNull()
      const deleted = await stack.clientFor(ALICE).from('games').delete().eq('id', GAME_ID).select('id')
      expect(deleted.data).toEqual([{ id: GAME_ID }])
      expect(stack.db.table('game_state')).toEqual([])
      expect(stack.db.table('game_state_meta')).toEqual([])
      expect(stack.db.table('players')).toEqual([])

      // An admin may delete a room in any state.
      await seed(stack)
      const byAdmin = await stack.clientFor('auth-user-admin').from('games').delete().eq('id', GAME_ID).select('id')
      expect(byAdmin.data).toEqual([{ id: GAME_ID }])
    })

    it('stamps a new seat ready for the current config, and only accepts readiness for the current one (players triggers, section 4)', async () => {
      stack.addUser(ALICE)
      stack.addUser(BOB)
      const { data: room } = await stack
        .clientFor(ALICE)
        .from('games')
        .insert({ room_code: 'TRIG02', name: 'Readiness room', play_mode: 'live', created_by: ALICE, settings: testGameSettings() })
        .select()
        .single()
      await stack.clientFor(ALICE).from('games').update({ settings: testGameSettings({ skipHotseatPassGate: true }) }).eq('id', room.id)

      const { data: seat } = await stack
        .clientFor(BOB)
        .from('players')
        .insert({ game_id: room.id, user_id: BOB, display_name: 'Bob', seat_index: 1, color: '#2563eb', ready_for_version: 42 })
        .select()
        .single()
      expect(seat.ready_for_version).toBe(1)

      const stale = await stack.clientFor(BOB).from('players').update({ ready_for_version: 0 }).eq('id', seat.id)
      expect(stale.error?.message).toMatch(/ready_for_version must match/)
    })
  })

  /**
   * Hotseat is scoped out of the owner-override check: one shared
   * `auth.uid()` covers every local seat, so undoing one seat's pick and then
   * acting for the other is ordinary hotseat play, not one human discarding
   * another's undone move. apply-action/index.ts skips requiresOwnerOverride
   * for a hotseat game (`ctx.game.play_mode === 'hotseat'`) — the same
   * condition isAuthorizedToActAs and redactedResponseState key their own
   * hotseat carve-outs on.
   */
  it('lets a hotseat player act for their other seat after undoing the first one’s pick', async () => {
    // Both seats belong to one signed-in human, which is what hotseat means.
    const hotseatPlayers = PLAYERS.map((player) => ({ ...player, user_id: ALICE }))
    const game = gameRow(testGameSettings(), 'hotseat')
    const genesis = buildGenesisState(game, hotseatPlayers)
    await stack.seedStartedGame({ game, players: hotseatPlayers, genesis })

    const picked = await stack.applyAction(ALICE, GAME_ID, pickAction('seat-alice', 3))
    if (!picked.ok) throw new Error(picked.error)

    const undone = await stack.undoAction(ALICE, GAME_ID)
    if (!undone.ok) throw new Error(undone.error)

    // The same human, now playing their other seat. Nobody else's move is
    // being discarded — there is nobody else.
    const accepted = await stack.applyAction(ALICE, GAME_ID, pickAction('seat-bob', 2))
    if (!accepted.ok) throw new Error(accepted.error)
    expect(gameData(accepted.state).picks['seat-bob']).toBe(2)
    expect(accepted.state.pendingPlayerIds).toEqual(['seat-alice'])
  })

  /**
   * requiresOwnerOverride (supabase/functions/_shared/gameEnforcement.ts):
   * submitting a new action while the undo pointer sits behind another
   * player's undone move would discard that move for good, which takes the
   * room owner or an admin *with* room admin mode switched on.
   */
  describe("discarding another player's undone move", () => {
    async function bobPicksThenAliceUndoes() {
      await seed(stack)
      const bobPicked = await stack.applyAction(BOB, GAME_ID, pickAction('seat-bob', 4))
      if (!bobPicked.ok) throw new Error(bobPicked.error)
      const undone = await stack.undoAction(ALICE, GAME_ID)
      if (!undone.ok) throw new Error(undone.error)
      expect(undone.state.pendingPlayerIds).toEqual(['seat-alice', 'seat-bob'])
    }

    it('is refused without room admin mode, even for the room owner', async () => {
      await bobPicksThenAliceUndoes()
      const result = await stack.applyAction(ALICE, GAME_ID, pickAction('seat-alice', 2))
      expect(result).toMatchObject({ ok: false, status: 403 })
    })

    it('is allowed for the owner once room admin mode is on — and admin mode itself is never reverted by a bare Undo', async () => {
      await bobPicksThenAliceUndoes()
      const adminOn = await stack.applyAction(ALICE, GAME_ID, { type: 'SET_ADMIN_MODE', playerId: null, enabled: true })
      if (!adminOn.ok) throw new Error(adminOn.error)
      expect(adminOn.state.adminModeActive).toBe(true)

      const result = await stack.applyAction(ALICE, GAME_ID, pickAction('seat-alice', 2))
      if (!result.ok) throw new Error(result.error)
      expect(gameData(result.state).picks).toEqual({ 'seat-alice': 2, 'seat-bob': null })
      expect(result.state.actionHistory.at(-1)?.viaAdminMode).toBe(true)
    })

    it('refuses SET_ADMIN_MODE from anyone but the owner or an admin', async () => {
      await seed(stack)
      const result = await stack.applyAction(BOB, GAME_ID, { type: 'SET_ADMIN_MODE', playerId: null, enabled: true })
      expect(result).toMatchObject({ ok: false, status: 403 })
    })
  })

  describe('fixture reconstruction', () => {
    it('rebuilds a game’s room and genesis from nothing but its export, options included', async () => {
      const settings = testGameSettings({ gameOptions: { targetScore: 7, maxRounds: 4 } })
      const genesis = await seed(stack, settings)
      const { state } = await playThroughStack(stack, genesis, 3)

      const fixture = buildFixture('self-test-rebuild', await decodeGameStateExport(await encodeGameStateExport(state)))
      expect(fixture.game.settings.gameOptions).toEqual({ targetScore: 7, maxRounds: 4 })
      expect(fixture.players.map((player) => [player.id, player.user_id])).toEqual(PLAYERS.map((player) => [player.id, player.user_id]))
      expect(stripTimestamps(fixture.genesis)).toEqual(stripTimestamps(genesis))
    })

    it('replays a game from its own export, exactly as a recorded fixture is replayed', async () => {
      const genesis = await seed(stack)
      const { state } = await playThroughStack(stack, genesis, 5)
      // Put a pointer move in the history too, so the replay exercises
      // undo-action/redo-action and not just apply-action.
      const undone = await stack.undoAction(ALICE, GAME_ID)
      if (!undone.ok) throw new Error(undone.error)
      const redone = await stack.redoAction(ALICE, GAME_ID)
      if (!redone.ok) throw new Error(redone.error)
      const finalState = redone.state
      expect(finalState.actionHistory).toHaveLength(state.actionHistory.length + 2)

      const fixture = buildFixture('self-test-roundtrip', await decodeGameStateExport(await encodeGameStateExport(finalState)))

      // A second, empty stack — the game is rebuilt from its export alone,
      // with nothing carried over from the stack that played it.
      stack.dispose()
      const replay = await createProductionStack()
      try {
        await replay.seedStartedGame({ game: fixture.game, players: fixture.players, genesis: fixture.genesis })
        const outcome = await replayFixtureThroughStack(replay, fixture)
        expect(outcome.version).toBe(finalState.actionHistory.length)
        expect(outcome.actionDurationsMs).toHaveLength(finalState.actionHistory.length)
        const stored = await replay.readGameState(fixture.players[0].user_id, fixture.game.id)
        expect(normalizeForComparison(stored!.state)).toEqual(normalizeForComparison(finalState))
      } finally {
        replay.dispose()
      }
    })

    it('refuses to load an export whose history no longer replays to itself', async () => {
      const genesis = await seed(stack)
      const { state } = await playThroughStack(stack, genesis, 2)
      const tampered: GameState = { ...state, game: { ...state.game, scores: { ...state.game.scores, 'seat-alice': 99 } } }
      expect(() => buildFixture('self-test-tampered', { exportedAt: new Date(0).toISOString(), gameState: tampered })).toThrow(/disagrees on game/)
    })
  })
})
