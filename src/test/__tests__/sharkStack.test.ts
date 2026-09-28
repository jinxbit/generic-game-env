// @vitest-environment node
//
// Shark (packages/shark) end to end through the real Edge Functions,
// rule-enforced with hidden information on: the server rolls the dice from
// its secret seed, every player reads the game through the view log — which,
// since nothing in Shark is secret, must equal the whole true state — through
// undo and redo, until the game ends.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { viewOf, type GameState } from '@game-platform/sdk'
import type { GameData } from '@game-platform/shark/rules'
import { simplestMove } from '@game-platform/shark/testing'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import { applyViewLogResponse, isViewLogState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-00000005a4c0'
const USERS = ['auth-user-a', 'auth-user-b', 'auth-user-c']
const PLAYERS = testPlayers(
  GAME_ID,
  USERS.map((userId, i) => ({ id: `seat-${i}`, userId, name: `Player ${i}` })),
)
const userOf = (seat: string) => USERS[Number(seat.split('-')[1])]

async function startRoom(stack: ProductionStack): Promise<void> {
  const game = testGameRow({
    id: GAME_ID,
    createdBy: USERS[0],
    playerCount: PLAYERS.length,
    status: 'lobby',
    gameType: 'shark',
    settings: testGameSettings({ rulesVersion: 2, hiddenInformationEnabled: true, gameOptions: { startingCash: 5000 } }),
  })
  for (const userId of USERS) stack.addUser(userId)
  stack.db.seed('games', game as unknown as Record<string, unknown>)
  for (const player of PLAYERS) stack.db.seed('players', player as unknown as Record<string, unknown>)
  const started = await stack.startGame(USERS[0], GAME_ID)
  if (!started.ok) throw new Error(`start-game refused: ${started.error}`)
}

async function trueState(stack: ProductionStack): Promise<GameState<GameData>> {
  return (await decompressGameStateFromStorage(stack.db.table<{ state: StoredGameState }>('game_state')[0].state)) as GameState<GameData>
}

/** One player's client, reading through the view log as gameApi.ts does. */
class Client {
  state: GameState | null = null
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
    const body = response.body as { ok: true } & ViewLogResponse
    const applied = applyViewLogResponse(previous, body)
    if (!applied.ok) throw new Error(`${this.seat} could not apply a view-log response: ${applied.reason}`)
    this.state = applied.state
  }
}

describe('Shark through the Edge Functions', () => {
  let stack: ProductionStack
  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('rolls on the server and keeps every view exact, through undo and redo, to the end', async () => {
    await startRoom(stack)
    const genesis = await trueState(stack)
    expect(genesis.rulesVersion).toBe(2)
    expect(genesis.game.players['seat-0'].shares).toEqual({ blue: 1, green: 1, red: 1, yellow: 1 })
    const clients = PLAYERS.map((p) => new Client(stack, p.id))
    for (let moves = 0; moves < 400; moves++) {
      if (moves === 7) {
        const before = await trueState(stack)
        expect(await stack.undoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        // Redo replays the recorded dice: the same roll comes back.
        expect((await trueState(stack)).game).toEqual(before.game)
      }
      const truth = await trueState(stack)
      if (truth.status !== 'active') break
      const action = simplestMove(truth as never)
      const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
      if (!result.ok) throw new Error(`${action.type}: ${result.error}`)
      if (moves % 10 === 0) {
        const now = await trueState(stack)
        for (const client of clients) {
          await client.read()
          const { actionHistory, ...view } = client.state!
          expect(view).toEqual(viewOf(now, client.seat))
          expect(view.game).toEqual(now.game)
          expect(actionHistory).toHaveLength(now.actionHistory.length)
        }
      }
    }
    const final = await trueState(stack)
    expect(final.status).toBe('completed')
    expect(final.game.finalWealth).not.toBeNull()
    expect(final.actionHistory.filter((entry) => entry.action.type === 'ROLL').every((entry) => entry.random?.length === 2)).toBe(true)
  })

  it('refuses a move made for another seat', async () => {
    await startRoom(stack)
    const truth = await trueState(stack)
    const result = await stack.applyAction(USERS[1], GAME_ID, { type: 'ROLL', playerId: truth.pendingPlayerIds[0] })
    expect(result.ok).toBe(false)
  })
})
