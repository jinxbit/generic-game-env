// @vitest-environment node
//
// Incorporated (packages/incorporated) end to end through the real Edge
// Functions, rule-enforced with hidden information on: the server rolls the
// dice and shuffles from its secret seed, every player reads the game through
// the view log, and each view must equal the server's own redaction of the
// true state — opponents' cash, the payoff deck and the next Outlook card
// hidden — through undo and redo.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { viewOf, type GameState } from '@game-platform/sdk'
import type { GameAction, GameData } from '@game-platform/incorporated/rules'
import { simplestMove } from '@game-platform/incorporated/testing'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import type { GameRow } from '../../lib/dbTypes.ts'
import { applyViewLogResponse, isViewLogState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-00000000c0de'
const USERS = ['auth-user-a', 'auth-user-b', 'auth-user-c', 'auth-user-d']
const PLAYERS = testPlayers(
  GAME_ID,
  USERS.map((userId, i) => ({ id: `seat-${i}`, userId, name: `Player ${i}` })),
)
const userOf = (seat: string) => USERS[Number(seat.split('-')[1])]

async function startRoom(stack: ProductionStack): Promise<GameRow> {
  const game = testGameRow({
    id: GAME_ID,
    createdBy: USERS[0],
    playerCount: PLAYERS.length,
    status: 'lobby',
    gameType: 'incorporated',
    settings: testGameSettings({ rulesVersion: 1, hiddenInformationEnabled: true, gameOptions: { factionTweaks: true } }),
  })
  for (const userId of USERS) stack.addUser(userId)
  stack.db.seed('games', game as unknown as Record<string, unknown>)
  for (const player of PLAYERS) stack.db.seed('players', player as unknown as Record<string, unknown>)
  const started = await stack.startGame(USERS[0], GAME_ID)
  if (!started.ok) throw new Error(`start-game refused: ${started.error}`)
  return { ...game, status: 'active' }
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

/** A move that uses the server's dice now and then: a Power Play where one is open. */
function nextMove(state: GameState<GameData>): GameAction {
  const g = state.game
  const prompt = g.prompt
  if (prompt?.kind === 'lobbyTurn') {
    const zone = (Object.keys(g.battlegrounds) as (keyof typeof g.battlegrounds)[]).find((z) => g.battlegrounds[z] && !g.lobbyUsed[`POWER_PLAY:${z}`])
    if (zone) return { type: 'LOBBY', playerId: prompt.playerId, event: { kind: 'powerPlay', zone, camp: 'SCO' } }
  }
  return simplestMove(state as never)
}

describe('Incorporated through the Edge Functions', () => {
  let stack: ProductionStack
  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('keeps every player’s view exact and private, through undo and redo', async () => {
    await startRoom(stack)
    const clients = PLAYERS.map((p) => new Client(stack, p.id))
    for (let moves = 0; moves < 70; moves++) {
      if (moves === 10) {
        expect(await stack.undoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
      }
      const truth = await trueState(stack)
      if (truth.status !== 'active') break
      const action = nextMove(truth)
      const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
      if (!result.ok) throw new Error(`${action.type}: ${result.error}`)
      const now = await trueState(stack)
      for (const client of clients) {
        await client.read()
        const { actionHistory, ...view } = client.state!
        expect(view).toEqual(viewOf(now, client.seat))
        expect(actionHistory).toHaveLength(now.actionHistory.length)
        const game = view.game as GameData
        for (const id of now.game.seatOrder) expect(game.players[id].cash === null).toBe(id !== client.seat)
        expect(game.payoffDeck.every((card) => card === null)).toBe(true)
      }
    }
    const final = await trueState(stack)
    expect(final.game.round).toBeGreaterThan(1)
    // The server rolled: a Power Play's die is on the log.
    expect(final.actionHistory.some((entry) => (entry.random?.length ?? 0) > 0)).toBe(true)
  })

  it('refuses a move made for another seat (by anyone but the room owner)', async () => {
    await startRoom(stack)
    const truth = await trueState(stack)
    const action = nextMove(truth)
    const other = PLAYERS.find((p) => p.id !== action.playerId && p.user_id !== USERS[0])!
    const result = await stack.applyAction(other.user_id!, GAME_ID, action)
    expect(result.ok).toBe(false)
  })
})
