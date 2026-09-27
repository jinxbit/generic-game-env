// @vitest-environment node
//
// apply-action/undo-action/redo-action hand the acting player back the very
// state their own write produced — so without redaction on the write path,
// a game with GameSettings.hiddenInformationEnabled on would leak every
// *other* player's still-secret pick straight back to the acting player's
// browser, bypassing get-game-state's redaction (getGameState.test.ts)
// entirely. This exercises that write-side redaction (redactedResponseState,
// ../../../supabase/functions/_shared/gameEnforcement.ts) against the real
// Edge Function handlers via the production-simulating stack
// (src/test/supabaseStack/).
//
// Needs three seats, not two: in a two-player game, the acting player is
// always the *last* to pick, so by the time their own submission's response
// comes back the round has already resolved and nothing is masked — the leak
// only shows up while at least one other player is still pending after the
// acting player's own submission.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveHistory, toClientGameState, applyInFlightOverlay, extendReplay, replayActions, type RedactedGameState, type RedactedLoggedAction, type InFlightOverlay, type Action, type LoggedAction, type GameState } from '@game-platform/sdk'
import { hashGameStateView } from '../../lib/gameStateHash.ts'
import { buildGenesisState } from '../../lib/gameGenesis.ts'
import type { GameSettings } from '../../lib/dbTypes.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { gameData, pickAction, testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-000000000003'
const ALICE = 'auth-user-alice' // room owner, seated
const BOB = 'auth-user-bob' // seated
const CHARLIE = 'auth-user-charlie' // seated

const PLAYERS = testPlayers(GAME_ID, [
  { id: 'seat-alice', userId: ALICE, name: 'Alice' },
  { id: 'seat-bob', userId: BOB, name: 'Bob' },
  { id: 'seat-charlie', userId: CHARLIE, name: 'Charlie' },
])

const PICKS: Record<string, number> = { 'seat-alice': 2, 'seat-bob': 4, 'seat-charlie': 5 }

function pick(seat: string): PickNumberAction {
  return pickAction(seat, PICKS[seat])
}

function gameRow(settings: GameSettings) {
  return testGameRow({ id: GAME_ID, createdBy: ALICE, settings, playerCount: PLAYERS.length, roomCode: 'WRTST', name: 'write-path redaction self-test' })
}

describe('apply-action/undo-action/redo-action write-path redaction', () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  /** Seeds a started game on its first round, all three seats pending. */
  async function seedRoundOne(settingsOverrides: Partial<GameSettings> = {}): Promise<GameState> {
    const game = gameRow(testGameSettings({ hiddenInformationEnabled: true, ...settingsOverrides }))
    const genesis = buildGenesisState(game, PLAYERS)
    await stack.seedStartedGame({ game, players: PLAYERS, genesis })
    expect(genesis.pendingPlayerIds).toEqual(['seat-alice', 'seat-bob', 'seat-charlie'])
    return genesis
  }

  /** The raw Edge Function response body, bypassing gameApi.ts/the stack's own toClientGameState collapse — this is what actually crossed the wire. */
  async function rawApplyAction(userId: string, action: Action) {
    const { data, error } = await stack.clientFor(userId).functions.invoke('apply-action', { body: { gameId: GAME_ID, action } })
    if (error) throw new Error(`apply-action rejected: ${error.message}`)
    return data as { ok: true; state: RedactedGameState; version: number }
  }

  it("hides another still-pending player's secret pick from the acting player's own apply-action response, and reveals it once the round resolves", async () => {
    await seedRoundOne()

    // Bob picks first — pending: Alice, Charlie.
    const bobChose = await stack.applyAction(BOB, GAME_ID, pick('seat-bob'))
    if (!bobChose.ok) throw new Error(bobChose.error)
    expect(bobChose.state.pendingPlayerIds).toEqual(['seat-alice', 'seat-charlie'])

    // Alice submits her own pick next — pending: Charlie only, so the round
    // is still open. This response must not carry Bob's real pick back to
    // Alice's own browser, in the state or in the log.
    const aliceResponse = await rawApplyAction(ALICE, pick('seat-alice'))
    expect(aliceResponse.state.pendingPlayerIds).toEqual(['seat-charlie'])
    expect(gameData(aliceResponse.state).picks['seat-bob']).toBeNull()
    expect(aliceResponse.state.actionHistory.map((entry) => entry.action)).toEqual([
      { type: 'HIDDEN_ACTION', playerId: 'seat-bob' },
      pick('seat-alice'),
    ])
    // Alice's own pick is never hidden from herself.
    expect(gameData(aliceResponse.state).picks['seat-alice']).toBe(PICKS['seat-alice'])

    // Charlie's own submission resolves the round — nothing left pending, so
    // this same response now reveals every pick, Bob's included.
    const charlieResponse = await rawApplyAction(CHARLIE, pick('seat-charlie'))
    expect(charlieResponse.state.turn).toBe(2)
    expect(gameData(charlieResponse.state).rounds[0].picks).toEqual(PICKS)
    expect(charlieResponse.state.actionHistory.map((entry) => entry.action)).toEqual([pick('seat-bob'), pick('seat-alice'), pick('seat-charlie')])
  })

  it('hides a changed pick too, not just the first one', async () => {
    await seedRoundOne()
    const bobChose = await stack.applyAction(BOB, GAME_ID, pick('seat-bob'))
    if (!bobChose.ok) throw new Error(bobChose.error)
    const bobChanged = await stack.applyAction(BOB, GAME_ID, pickAction('seat-bob', 1))
    if (!bobChanged.ok) throw new Error(bobChanged.error)
    expect(gameData(bobChanged.state).picks['seat-bob']).toBe(1)

    const aliceResponse = await rawApplyAction(ALICE, pick('seat-alice'))
    expect(gameData(aliceResponse.state).picks['seat-bob']).toBeNull()
    expect(aliceResponse.state.actionHistory.slice(0, 2).map((entry) => entry.action.type)).toEqual(['HIDDEN_ACTION', 'HIDDEN_ACTION'])
  })

  describe('replay delta on the write path (protocol 2)', () => {
    /** Rebuilds the acting player's state the way gameApi.ts's applyReplayDelta does. */
    function rebuild(genesis: GameState, base: GameState, delta: { actionHistoryAppend: RedactedLoggedAction[]; overlay?: InFlightOverlay }) {
      const next = extendReplay(genesis, base, delta.actionHistoryAppend as unknown as LoggedAction[])
      return applyInFlightOverlay(next, delta.overlay)
    }

    /** The acting player's own base: the state replayed up to their safe prefix. */
    async function baseFor(userId: string, genesis: GameState): Promise<GameState> {
      const full = await stack.getGameState(userId, GAME_ID)
      if (!full.ok) throw new Error(full.error)
      if ('actionHistoryAppend' in full) throw new Error('expected a full response')
      const view = toClientGameState(full.state)
      return { ...replayActions(genesis, view.actionHistory), actionHistory: view.actionHistory }
    }

    it('sends no state back on a move, and the acting player rebuilds exactly what the old full response carried', async () => {
      const genesis = await seedRoundOne()
      const base = await baseFor(ALICE, genesis)

      const bobChose = await stack.applyAction(BOB, GAME_ID, pick('seat-bob'))
      if (!bobChose.ok) throw new Error(bobChose.error)

      const delta = await stack.applyAction(ALICE, GAME_ID, pick('seat-alice'), base.actionHistory.length, 2)
      if (!delta.ok) throw new Error(delta.error)
      if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')
      expect(delta).not.toHaveProperty('state')

      const rebuilt = rebuild(genesis, base, delta)
      expect(hashGameStateView(rebuilt)).toBe(delta.stateHash)
      // Charlie is still pending, so redaction is live — and Alice rebuilding
      // the state herself is not a way around it.
      expect(rebuilt.pendingPlayerIds).toEqual(['seat-charlie'])
      expect(gameData(rebuilt).picks['seat-bob']).toBeNull()
      expect(gameData(rebuilt).picks['seat-alice']).toBe(PICKS['seat-alice'])

      // ...and it agrees with what a plain read would have said.
      const read = await stack.getGameState(ALICE, GAME_ID)
      if (!read.ok) throw new Error(read.error)
      if ('actionHistoryAppend' in read) throw new Error('expected a full response')
      expect(rebuilt).toEqual(toClientGameState(read.state))
    })

    it('carries the entries a move made newly visible, not just the one submitted', async () => {
      // The acting player's own submission can resolve the round, which
      // unmasks every other player's pick at once — so the append is longer
      // than the single action they sent. respondWithState's clamp is what
      // gets this right; a naive "return the action I just applied" would not.
      const genesis = await seedRoundOne()
      for (const [user, seat] of [[BOB, 'seat-bob'], [ALICE, 'seat-alice']] as const) {
        const result = await stack.applyAction(user, GAME_ID, pick(seat))
        if (!result.ok) throw new Error(result.error)
      }

      const base = await baseFor(CHARLIE, genesis)
      expect(base.actionHistory).toHaveLength(0)
      const delta = await stack.applyAction(CHARLIE, GAME_ID, pick('seat-charlie'), base.actionHistory.length, 2)
      if (!delta.ok) throw new Error(delta.error)
      if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')

      expect(delta.actionHistoryAppend).toHaveLength(3)
      const rebuilt = rebuild(genesis, base, delta)
      expect(hashGameStateView(rebuilt)).toBe(delta.stateHash)
      expect(rebuilt.turn).toBe(2)
      expect(gameData(rebuilt).rounds[0].picks).toEqual(PICKS)
    })

    it('undo and redo answer in the same shape', async () => {
      const genesis = await seedRoundOne()
      const chose = await stack.applyAction(BOB, GAME_ID, pick('seat-bob'))
      if (!chose.ok) throw new Error(chose.error)

      const undoBase = await baseFor(BOB, genesis)
      const undone = await stack.undoAction(BOB, GAME_ID, undoBase.actionHistory.length, 2)
      if (!undone.ok) throw new Error(undone.error)
      if (!('stateHash' in undone)) throw new Error('expected a protocol-2 delta from undo-action')
      expect(undone).not.toHaveProperty('state')
      expect(hashGameStateView(rebuild(genesis, undoBase, undone))).toBe(undone.stateHash)

      const redoBase = await baseFor(BOB, genesis)
      const redone = await stack.redoAction(BOB, GAME_ID, redoBase.actionHistory.length, 2)
      if (!redone.ok) throw new Error(redone.error)
      if (!('stateHash' in redone)) throw new Error('expected a protocol-2 delta from redo-action')
      expect(hashGameStateView(rebuild(genesis, redoBase, redone))).toBe(redone.stateHash)
    })

    it('leaves a client that never asks for protocol 2 on the old full-state shape', async () => {
      await seedRoundOne()
      const { data } = await stack.clientFor(BOB).functions.invoke('apply-action', { body: { gameId: GAME_ID, action: pick('seat-bob') } })
      const body = data as Record<string, unknown>
      expect(body).toHaveProperty('state')
      expect(body).not.toHaveProperty('stateHash')
      expect(body).not.toHaveProperty('actionHistoryAppend')
    })
  })

  it("doesn't change behavior for a game without hiddenInformationEnabled — apply-action's response still carries the real pick straight through", async () => {
    await seedRoundOne({ hiddenInformationEnabled: false })
    const bobChose = await stack.applyAction(BOB, GAME_ID, pick('seat-bob'))
    if (!bobChose.ok) throw new Error(bobChose.error)

    // gameApi.ts's applyActionEnforced (and this stack's applyAction, the
    // same way) always collapses the wire response back to a plain
    // GameState — for a non-opted-in game nothing was ever masked, so the
    // real pick comes straight through.
    const aliceChose = await stack.applyAction(ALICE, GAME_ID, pick('seat-alice'))
    if (!aliceChose.ok) throw new Error(aliceChose.error)
    expect(gameData(aliceChose.state).picks['seat-bob']).toBe(PICKS['seat-bob'])
  })
})

describe("undo-action leaves the Redo button usable for a viewer whose actionHistory redacts the undone pick", () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it("keeps a bystander's own client-side actionHistory agreeing with the server about whether a redo is available, after another player's still-secret pick gets undone", async () => {
    const game = gameRow(testGameSettings({ hiddenInformationEnabled: true }))
    await stack.seedStartedGame({ game, players: PLAYERS, genesis: buildGenesisState(game, PLAYERS) })

    // Alice picks — pending: Bob, Charlie. Nothing else is secret from either
    // of them besides Alice's own pick.
    const aliceChose = await stack.applyAction(ALICE, GAME_ID, pick('seat-alice'))
    if (!aliceChose.ok) throw new Error(aliceChose.error)
    expect(aliceChose.state.pendingPlayerIds).toEqual(['seat-bob', 'seat-charlie'])

    // Bob undoes Alice's still-secret pick. undo-action's own response is
    // redacted+collapsed for the caller too, same as apply-action's — so even
    // Bob's own undo response must agree a redo is available, despite
    // Alice's pick still being masked from him.
    const bobUndo = await stack.undoAction(BOB, GAME_ID)
    if (!bobUndo.ok) throw new Error(bobUndo.error)
    expect(resolveHistory(bobUndo.state.actionHistory).canRedo).toBe(true)

    // Bob's own client re-fetches through get-game-state and collapses the
    // response the same way gameApi.ts's getGameStateRedacted does
    // (toClientGameState) — the collapsed actionHistory must agree that a
    // redo is available. Truncating the whole raw history at Alice's
    // still-masked (but already undone) pick would silently drop the real
    // UNDO_ACTION entry right after it too, and read back false —
    // permanently disabling Bob's own Redo button (GamePage.tsx's
    // historyPointer.canRedo).
    const bobRead = await stack.getGameState(BOB, GAME_ID)
    if (!bobRead.ok) throw new Error(bobRead.error)
    if ('actionHistoryAppend' in bobRead) throw new Error('expected a full response — no sinceActionIndex was sent')
    const bobClient = toClientGameState(bobRead.state)
    expect(resolveHistory(bobClient.actionHistory).canRedo).toBe(true)
  })

  it('keeps the protocol-2 delta path consistent across that undo, and falls back to a full state once a redo re-masks the prefix', async () => {
    const game = gameRow(testGameSettings({ hiddenInformationEnabled: true }))
    const genesis = buildGenesisState(game, PLAYERS)
    await stack.seedStartedGame({ game, players: PLAYERS, genesis })

    const aliceChose = await stack.applyAction(ALICE, GAME_ID, pick('seat-alice'))
    if (!aliceChose.ok) throw new Error(aliceChose.error)

    // Charlie's cached base: nothing yet (Alice's pick is secret from him).
    const charlieRead = await stack.getGameState(CHARLIE, GAME_ID)
    if (!charlieRead.ok || 'actionHistoryAppend' in charlieRead) throw new Error('expected a full response')
    const charlieBase = toClientGameState(charlieRead.state)
    expect(charlieBase.actionHistory).toEqual([])

    // Bob undoes Alice's pick. Charlie's delta now carries the (still masked,
    // now undone) entry and the UNDO_ACTION after it, and his rebuild agrees
    // with the server.
    const bobUndo = await stack.undoAction(BOB, GAME_ID)
    if (!bobUndo.ok) throw new Error(bobUndo.error)
    const delta = await stack.getGameState(CHARLIE, GAME_ID, 0, 2)
    if (!delta.ok) throw new Error(delta.error)
    if (!('stateHash' in delta)) throw new Error('expected a protocol-2 delta')
    expect(delta.actionHistoryAppend.map((entry) => entry.action.type)).toEqual(['HIDDEN_ACTION', 'UNDO_ACTION'])
    const rebuilt = applyInFlightOverlay(extendReplay(genesis, charlieBase, delta.actionHistoryAppend as unknown as LoggedAction[]), delta.overlay)
    expect(hashGameStateView(rebuilt)).toBe(delta.stateHash)
    expect(resolveHistory(rebuilt.actionHistory).canRedo).toBe(true)

    // A redo puts Alice's secret pick back in effect, so Charlie's safe
    // prefix moves back behind it — a cursor past it gets a full state.
    const bobRedo = await stack.redoAction(BOB, GAME_ID)
    if (!bobRedo.ok) throw new Error(bobRedo.error)
    const afterRedo = await stack.getGameState(CHARLIE, GAME_ID, rebuilt.actionHistory.length, 2)
    if (!afterRedo.ok) throw new Error(afterRedo.error)
    expect(afterRedo).toHaveProperty('state')
    if (!('state' in afterRedo)) throw new Error('unreachable')
    expect(toClientGameState(afterRedo.state).actionHistory).toEqual([])
  })
})
