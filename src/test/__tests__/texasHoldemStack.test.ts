// @vitest-environment node
//
// Texas Hold'em (packages/texas-holdem) end to end through the real Edge
// Functions, rule-enforced with hidden information on: the server deals every
// card from its secret seed, every player reads the game through the view
// log, and each view must equal the server's own redaction of the true state
// — their own hole cards face up, everyone else's hidden, and no recorded
// draw anywhere — through undo and redo, over several hands.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { viewOf, type GameState } from '@game-platform/sdk'
import { amountToCall, canRaise, minRaiseTo, type GameAction, type GameData } from '@game-platform/texas-holdem/rules'
import { simplestMove } from '@game-platform/texas-holdem/testing'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import { applyViewLogResponse, isViewLogState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-0000000f01d5'
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
    gameType: 'texas-holdem',
    settings: testGameSettings({ rulesVersion: 1, hiddenInformationEnabled: true, gameOptions: { startingStack: 5000, bigBlind: 20, blindsDoubleEvery: 0 } }),
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

/**
 * Calls and checks, with a minimum raise every few moves and a fold now and
 * then. The server's seed differs every run, so the stacks are deep enough
 * that nobody can bust in the moves played: the game always spans several
 * hands, some settled by folds and some at a showdown.
 */
function nextMove(state: GameState<GameData>, n: number): GameAction {
  const g = state.game
  const actor = g.toActId!
  if (canRaise(g, actor) && n % 4 === 1) return { type: 'BET', playerId: actor, amount: minRaiseTo(g, actor) }
  if (amountToCall(g, actor) > 0 && n % 9 === 4) return { type: 'FOLD', playerId: actor }
  return simplestMove(state as never)
}

describe("Texas Hold'em through the Edge Functions", () => {
  let stack: ProductionStack
  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('keeps every player’s view exact and their hole cards private, through undo and redo', async () => {
    await startRoom(stack)
    const clients = PLAYERS.map((p) => new Client(stack, p.id))
    for (const client of clients) await client.read()
    for (let moves = 0; moves < 60; moves++) {
      if (moves === 7) {
        expect(await stack.undoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
      }
      const truth = await trueState(stack)
      const action = nextMove(truth, moves)
      const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
      if (!result.ok) throw new Error(`${action.type}: ${result.error}`)
      const now = await trueState(stack)
      for (const client of clients) {
        await client.read()
        const { actionHistory, ...view } = client.state!
        expect(view).toEqual(viewOf(now, client.seat))
        expect(actionHistory).toHaveLength(now.actionHistory.length)
        expect(actionHistory.every((entry) => entry.random === undefined)).toBe(true)
        const game = view.game as GameData
        for (const id of now.game.seatOrder) {
          const hole = game.players[id].hole
          if (id === client.seat) expect(hole).toEqual(now.game.players[id].hole)
          else expect(hole.every((card) => card === null)).toBe(true)
        }
      }
    }
    const final = await trueState(stack)
    expect(final.status).toBe('active')
    expect(final.game.hand).toBeGreaterThan(2)
    // The server dealt: board cards and new hands drew from its seed.
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
