// @vitest-environment node
//
// The view log (packages/sdk/src/viewLog.ts) end to end through the real
// Edge Functions: a card game whose hands stay secret most of the game, read
// by every player the way the client does it (src/lib/viewLogClient.ts).
// Every player must keep the whole log and an exact view of the game through
// undo and redo, history review must reproduce every past view, and the wire
// must stay small — the two things the replay protocol could not do together
// for long-lived secrets.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { replayActions, viewOf, type GameState } from '@game-platform/sdk'
import { buildGenesisState } from '../../lib/gameGenesis.ts'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import type { GameRow } from '../../lib/dbTypes.ts'
import { applyViewLogResponse, isViewLogState, viewLogReviewState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { pickAction, testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'
import { HAND_GAME_TYPE, nextHandAction, registerHandGame, type HandState } from '../../../packages/sdk/src/__tests__/handGame.ts'

registerHandGame()

const GAME_ID = '3f1c2d4e-0000-4000-8000-0000000071e1'
const USERS = ['auth-user-a', 'auth-user-b', 'auth-user-c', 'auth-user-d']
const PLAYERS = testPlayers(
  GAME_ID,
  USERS.map((userId, i) => ({ id: `seat-${i}`, userId, name: `Player ${i}` })),
)
const userOf = (seat: string) => USERS[Number(seat.split('-')[1])]

async function startRoom(stack: ProductionStack, gameType = HAND_GAME_TYPE): Promise<GameRow> {
  const game = testGameRow({ id: GAME_ID, createdBy: USERS[0], playerCount: PLAYERS.length, status: 'lobby', gameType, settings: testGameSettings({ rulesVersion: 1, hiddenInformationEnabled: true }) })
  for (const userId of USERS) stack.addUser(userId)
  stack.db.seed('games', game as unknown as Record<string, unknown>)
  for (const player of PLAYERS) stack.db.seed('players', player as unknown as Record<string, unknown>)
  const started = await stack.startGame(USERS[0], GAME_ID)
  if (!started.ok) throw new Error(`start-game refused: ${started.error}`)
  return { ...game, status: 'active' }
}

async function trueState(stack: ProductionStack): Promise<GameState> {
  return decompressGameStateFromStorage(stack.db.table<{ state: StoredGameState }>('game_state')[0].state)
}

/** One player's client, speaking protocol 3 exactly as gameApi.ts does. */
class Client {
  state: GameState | null = null
  bytes = 0
  reads = 0
  readonly stack: ProductionStack
  readonly seat: string
  constructor(stack: ProductionStack, seat: string) {
    this.stack = stack
    this.seat = seat
  }
  async read(): Promise<void> {
    const previous = this.state
    const cursor = previous && isViewLogState(previous) ? { sinceActionIndex: previous.actionHistory.length, viewLog: true } : {}
    const response = await this.stack.rawInvoke(userOf(this.seat), 'get-game-state', { gameId: GAME_ID, protocol: 3, ...cursor })
    this.bytes += JSON.stringify(response.body).length
    this.reads++
    const body = response.body as { ok: true } & ViewLogResponse
    expect(body.viewLog).toBe(true)
    const applied = applyViewLogResponse(previous, body)
    if (!applied.ok) throw new Error(`${this.seat} could not apply a view-log response: ${applied.reason}`)
    this.state = applied.state
  }
}

describe('the view log through the Edge Functions', () => {
  let stack: ProductionStack
  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('gives every player an exact view and the whole log of a card game, through undo and redo, cheaply', async () => {
    const game = await startRoom(stack)
    const clients = PLAYERS.map((p) => new Client(stack, p.id))
    let moves = 0
    for (;;) {
      const truth = await trueState(stack)
      if (moves === 6 || moves === 20) {
        expect(await stack.undoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
      }
      const action = nextHandAction((await trueState(stack)) as HandState)
      if (!action) break
      const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
      if (!result.ok) throw new Error(result.error)
      moves++
      const now = await trueState(stack)
      for (const client of clients) {
        await client.read()
        const { actionHistory, ...view } = client.state!
        expect(view).toEqual(viewOf(now, client.seat))
        expect(actionHistory).toHaveLength(now.actionHistory.length)
      }
      void truth
    }
    const final = await trueState(stack)
    expect(final.status).toBe('completed')

    // History review: every past view, from the viewer's genesis view and the
    // patches, equals the server's view of the true state at that point.
    const genesis = buildGenesisState(game, PLAYERS, final.setupRandom)
    const historyResponse = await stack.rawInvoke(USERS[1], 'get-game-state', { gameId: GAME_ID, protocol: 3, history: true })
    const history = historyResponse.body as { genesisView: never; entries: never }
    for (const index of [0, 1, 5, 17, final.actionHistory.length]) {
      const { actionHistory, ...view } = viewLogReviewState(history, clients[1].state!, index)
      void actionHistory
      expect(view).toEqual(viewOf(replayActions(genesis, final.actionHistory.slice(0, index)), 'seat-1'))
    }

    const perRead = clients.reduce((sum, c) => sum + c.bytes, 0) / clients.reduce((sum, c) => sum + c.reads, 0)
    console.log(`view log: ${moves} moves, ${Math.round(perRead)} bytes per read on average`)
    // The replay protocol averaged ~2,000 bytes per read on this game (almost
    // every read carrying the whole masked state); the view log sends what
    // changed.
    expect(perRead).toBeLessThan(1000)
  })

  it('narrates every entry to every player, revealing a secret entry once it stops being secret', async () => {
    await startRoom(stack, 'unique-pick')
    const bob = new Client(stack, 'seat-1')
    const pick = async (seat: string, value: number) => {
      const result = await stack.applyAction(userOf(seat), GAME_ID, pickAction(seat, value))
      if (!result.ok) throw new Error(result.error)
      await bob.read()
    }
    await pick('seat-0', 1)
    const lines = () => (bob.state!.actionHistory as unknown as { lines: { message: string }[] }[]).map((entry) => entry.lines[0].message)
    expect(lines()).toEqual(['{player} picked a number.'])
    await pick('seat-1', 2)
    await pick('seat-2', 3)
    await pick('seat-3', 4) // resolves the round
    expect(lines()).toEqual(['{player} picked 1.', '{player} picked 2.', '{player} picked 3.', expect.stringMatching(/^\{player\} picked 4\./)])
  })

  it("answers a game whose log predates the view log in the replay protocol's shape", async () => {
    await startRoom(stack, 'unique-pick')
    await stack.applyAction(USERS[0], GAME_ID, pickAction('seat-0', 1))
    // Strip the recorded views, as if the entry were written before the view log existed.
    const row = stack.db.table<{ game_id: string; state: StoredGameState; version: number }>('game_state')[0]
    const state = await decompressGameStateFromStorage(row.state)
    stack.db.replaceRow('game_state', { ...row, state: { ...state, actionHistory: state.actionHistory.map((entry) => ({ ...entry, views: undefined, lines: undefined })) } } as unknown as Record<string, unknown>)
    const response = await stack.rawInvoke(USERS[1], 'get-game-state', { gameId: GAME_ID, protocol: 3 })
    expect(response.body).not.toHaveProperty('viewLog')
    expect(response.body).toHaveProperty('state')
  })

  it('keeps the view log out of every response to an admin, who sees the true state', async () => {
    await startRoom(stack)
    stack.addUser('auth-user-admin', { isAdmin: true })
    await stack.applyAction(USERS[0], GAME_ID, { type: 'DRAW_HAND', playerId: 'seat-0' })
    const response = await stack.rawInvoke('auth-user-admin', 'get-game-state', { gameId: GAME_ID, protocol: 3 })
    expect(response.body).not.toHaveProperty('viewLog')
  })
})
