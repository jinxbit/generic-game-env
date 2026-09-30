// @vitest-environment node
//
// Bauernschlau (packages/bauernschlau) end to end through the real Edge
// Functions, rule-enforced with hidden information on: the server draws sheep
// from its secret seed, every player reads the game through the view log, and
// each view must equal the server's own redaction of the true state — the bag
// and other players' face-down sheep hidden, their own shown — through undo
// and redo, until the game ends.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { viewOf, type GameState } from '@game-platform/sdk'
import type { GameData } from '@game-platform/bauernschlau/rules'
import { simplestMove } from '@game-platform/bauernschlau/testing'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import { applyViewLogResponse, isViewLogState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-0000000b5c01'
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
    gameType: 'bauernschlau',
    settings: testGameSettings({ rulesVersion: 3, hiddenInformationEnabled: true, gameOptions: { multiRoundScoring: true } }),
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
    expect(body.viewLog).toBe(true)
    const applied = applyViewLogResponse(previous, body)
    if (!applied.ok) throw new Error(`${this.seat} could not apply a view-log response: ${applied.reason}`)
    this.state = applied.state
  }
}

describe('Bauernschlau through the Edge Functions', () => {
  let stack: ProductionStack
  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('keeps every player’s view exact and private, through undo and redo, to the end', async () => {
    await startRoom(stack)
    const clients = PLAYERS.map((p) => new Client(stack, p.id))
    let sawHidden = false
    for (let moves = 0; moves < 400; moves++) {
      if (moves === 4) {
        expect(await stack.undoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
      }
      const truth = await trueState(stack)
      if (truth.status !== 'active') break
      const action = simplestMove(truth as never)
      const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
      if (!result.ok) throw new Error(`${action.type}: ${result.error}`)
      // Reading after every move is slow; a sample keeps the check honest and the test quick.
      if (moves > 40 && moves % 15 !== 0) continue
      const now = await trueState(stack)
      for (const client of clients) {
        await client.read()
        const { actionHistory, ...view } = client.state!
        expect(view).toEqual(viewOf(now, client.seat))
        expect(actionHistory).toHaveLength(now.actionHistory.length)
        if (now.status !== 'active') continue
        const game = view.game as GameData
        expect(game.bag.every((sheep) => sheep === null)).toBe(true)
        game.sheep.forEach((placed) => {
          if (!placed || placed.faceUp) return
          expect(placed.sheep === null).toBe(placed.placedBy !== client.seat)
          if (placed.sheep === null) sawHidden = true
        })
      }
    }
    const final = await trueState(stack)
    expect(final.status).toBe('completed')
    expect(final.game.finalScores).not.toBeNull()
    expect(sawHidden).toBe(true)
    // The server drew the sheep: the draws are on the log.
    expect(final.actionHistory.some((entry) => (entry.random?.length ?? 0) > 0)).toBe(true)
  })

  it('refuses a move made for another seat (by anyone but the room owner)', async () => {
    await startRoom(stack)
    const truth = await trueState(stack)
    const action = simplestMove(truth as never)
    const other = PLAYERS.find((p) => p.id !== action.playerId && p.user_id !== USERS[0])!
    const result = await stack.applyAction(other.user_id!, GAME_ID, action)
    expect(result.ok).toBe(false)
  })
})
