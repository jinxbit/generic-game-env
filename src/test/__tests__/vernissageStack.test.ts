// @vitest-environment node
//
// Vernissage (packages/vernissage) end to end through the real Edge
// Functions, rule-enforced with hidden information on: the server shuffles
// the decks and rolls the fate die and the Trial dice from its secret seed,
// and every player reads the game through the view log. Each view must equal
// the server's own redaction of the true state — other hands, the face-down
// piles and decks hidden, the bought pile shown to its buyer alone — through
// undo and redo, to the end of the game.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { viewOf, type GameState } from '@game-platform/sdk'
import type { GameData } from '@game-platform/vernissage/rules'
import { simplestMove } from '@game-platform/vernissage/testing'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import { applyViewLogResponse, isViewLogState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-0000000fe41e'
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
    gameType: 'vernissage',
    settings: testGameSettings({ rulesVersion: 1, hiddenInformationEnabled: true, gameOptions: { mightVariant: true } }),
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

describe('Vernissage through the Edge Functions', () => {
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
    let sawPileChoice = false
    for (let moves = 0; moves < 600; moves++) {
      if (moves === 9) {
        expect(await stack.undoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(USERS[0], GAME_ID)).toMatchObject({ ok: true })
      }
      const truth = await trueState(stack)
      if (truth.status !== 'active') break
      const action = simplestMove(truth as never)
      const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
      if (!result.ok) throw new Error(`${action.type}: ${result.error}`)
      const now = await trueState(stack)
      const check = moves % 12 === 0 || now.game.step === 'choose'
      if (!check) continue
      for (const client of clients) {
        await client.read()
        const { actionHistory, ...view } = client.state!
        expect(view).toEqual(viewOf(now, client.seat))
        expect(actionHistory).toHaveLength(now.actionHistory.length)
        if (now.status !== 'active') continue
        const game = view.game as GameData
        for (const id of now.game.seatOrder) {
          expect(game.players[id].hand.every((c) => c === null)).toBe(id !== client.seat)
        }
        expect(game.greyDeck.every((c) => c === null)).toBe(true)
        for (let i = 0; i < game.piles.length; i++) {
          const visible = now.game.step === 'choose' && now.game.choosing === i && now.game.turnPlayerId === client.seat
          if (visible) sawPileChoice = true
          expect(game.piles[i].every((c) => (visible ? c !== null : c === null))).toBe(true)
        }
      }
    }
    const final = await trueState(stack)
    expect(final.status).toBe('completed')
    expect(final.game.finalAssets).not.toBeNull()
    expect(sawPileChoice).toBe(true)
    // The server drew: the fate die came from its seed.
    expect(final.actionHistory.filter((e) => e.action.type === 'ROLL_FATE').every((e) => e.random?.length === 1)).toBe(true)
  })

  it('refuses a move made for another seat', async () => {
    await startRoom(stack)
    const truth = await trueState(stack)
    const result = await stack.applyAction(USERS[1], GAME_ID, { type: 'ROLL_FATE', playerId: truth.pendingPlayerIds[0] })
    expect(result.ok).toBe(false)
  })
})
