// @vitest-environment node
//
// Rise & Fall (packages/rise-and-fall) end to end through the real Edge
// Functions, rule-enforced with hidden information on: board setup, then
// rounds, every player reading the game through the view log. In the
// simultaneous select-cards phase each client must see exactly its own
// redacted view — its own pick, never anyone else's — through undo and redo.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { viewOf, type GameState } from '@game-platform/sdk'
import type { GameAction, GameData, GameOptions } from '@game-platform/rise-and-fall/rules'
import { simplestMove } from '@game-platform/rise-and-fall/testing'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import { applyViewLogResponse, isViewLogState, type ViewLogResponse } from '../../lib/viewLogClient.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'

const GAME_ID = '3f1c2d4e-0000-4000-8000-0000000a2f00'
const USERS = ['auth-user-a', 'auth-user-b', 'auth-user-c']
const PLAYERS = testPlayers(
  GAME_ID,
  USERS.map((userId, i) => ({ id: `seat-${i}`, userId, name: `Player ${i}` })),
)
const userOf = (seat: string) => USERS[Number(seat.split('-')[1])]

type RfState = GameState<GameData, GameOptions>

async function startRoom(stack: ProductionStack, gameOptions: Partial<GameOptions>): Promise<void> {
  const game = testGameRow({
    id: GAME_ID,
    createdBy: USERS[0],
    playerCount: PLAYERS.length,
    status: 'lobby',
    gameType: 'rise-and-fall',
    settings: testGameSettings({ hiddenInformationEnabled: true, gameOptions }),
  })
  for (const userId of USERS) stack.addUser(userId)
  stack.db.seed('games', game as unknown as Record<string, unknown>)
  for (const player of PLAYERS) stack.db.seed('players', player as unknown as Record<string, unknown>)
  const started = await stack.startGame(USERS[0], GAME_ID)
  if (!started.ok) throw new Error(`start-game refused: ${started.error}`)
}

async function trueState(stack: ProductionStack): Promise<RfState> {
  return (await decompressGameStateFromStorage(stack.db.table<{ state: StoredGameState }>('game_state')[0].state)) as RfState
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

async function submit(stack: ProductionStack, truth: RfState): Promise<void> {
  const action = simplestMove(truth as never)
  if (!action) throw new Error(`No move in phase ${truth.phase}`)
  const result = await stack.applyAction(userOf(action.playerId), GAME_ID, action)
  if (!result.ok) throw new Error(`${action.type}: ${result.error}`)
}

describe('Rise & Fall through the Edge Functions', () => {
  let stack: ProductionStack
  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('plays setup and rounds with every view exact, hiding picks until all are made, through undo and redo', async () => {
    await startRoom(stack, { mapMode: 'template', mapTemplateId: 'classic' })
    const genesis = await trueState(stack)
    expect(genesis.gameType).toBe('rise-and-fall')
    expect(genesis.phase).toBe('placeUnits')
    const clients = PLAYERS.map((p) => new Client(stack, p.id))

    let checkedHiddenPick = false
    for (let moves = 0; moves < 60; moves++) {
      const truth = await trueState(stack)
      if (truth.status !== 'active') break

      // One pick made, others still choosing: the picker sees theirs, nobody else does.
      if (truth.phase === 'selectCards' && truth.pendingPlayerIds.length === PLAYERS.length - 1 && !checkedHiddenPick) {
        checkedHiddenPick = true
        const picker = PLAYERS.map((p) => p.id).find((id) => !truth.pendingPlayerIds.includes(id))!
        const card = truth.game.chosenCardIdByPlayerId[picker]
        expect(card).toBeTruthy()
        for (const client of clients) {
          await client.read()
          const seen = (client.state as RfState).game.chosenCardIdByPlayerId[picker]
          expect(seen).toBe(client.seat === picker ? card : null)
          const last = client.state!.actionHistory.at(-1)!
          if (client.seat !== picker) expect(last.action).toEqual({ type: 'HIDDEN_ACTION', playerId: picker })
        }
        // Undo the pick and make it again: the server replays, views stay exact.
        expect(await stack.undoAction(userOf(picker), GAME_ID)).toMatchObject({ ok: true })
        expect(await stack.redoAction(userOf(picker), GAME_ID)).toMatchObject({ ok: true })
        expect((await trueState(stack)).game).toEqual(truth.game)
      }

      await submit(stack, truth)
      if (moves % 6 === 0) {
        const now = await trueState(stack)
        for (const client of clients) {
          await client.read()
          const { actionHistory, ...view } = client.state!
          expect(view).toEqual(viewOf(now, client.seat))
          expect(actionHistory).toHaveLength(now.actionHistory.length)
        }
      }
    }
    expect(checkedHiddenPick).toBe(true)
    const final = await trueState(stack)
    expect(final.turn).toBeGreaterThan(1)
  })

  it('checks tile placements on the server during a map built together', async () => {
    await startRoom(stack, {})
    const genesis = await trueState(stack)
    expect(genesis.phase).toBe('placeTiles')
    const offBoard: GameAction = { type: 'PLACE_TILE', playerId: 'seat-0', anchor: { q: 40, r: 40 }, rotationSteps: 0 }
    const illegal = await stack.applyAction(userOf('seat-0'), GAME_ID, offBoard)
    expect(illegal).toMatchObject({ ok: false })
    for (let i = 0; i < 4; i++) await submit(stack, await trueState(stack))
    const after = await trueState(stack)
    expect(after.actionHistory.filter((entry) => entry.action.type === 'PLACE_TILE').length).toBeGreaterThanOrEqual(4)
  })

  it('refuses a move made for another seat', async () => {
    await startRoom(stack, { mapMode: 'template', mapTemplateId: 'classic' })
    const truth = await trueState(stack)
    const forSeat0: GameAction = { type: 'PLACE_UNIT', playerId: truth.pendingPlayerIds[0], unitKind: 'city', coord: { q: 0, r: 0 } }
    const result = await stack.applyAction(USERS[1], GAME_ID, forSeat0)
    expect(result.ok).toBe(false)
  })
})
