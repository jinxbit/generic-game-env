// @vitest-environment node
//
// Random draws and the reveal lock, end to end through the real Edge
// Functions (the in-process stack, ../supabaseStack/): a rule-enforced game's
// seed lives only in `game_secrets` (supabase/migrations/0002_game_secrets.sql),
// every number it produced is recorded in the log so a client replays the
// game without it, and lockRevealedInformationEnabled refuses an undo that
// would take back what a player has seen, short of the owner's admin-mode
// override.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { replayActions, seededSource, type GameState } from '@game-platform/sdk'
import { buildGenesisState } from '../../lib/gameGenesis.ts'
import type { GameRow, GameSettings, PlayerRow } from '../../lib/dbTypes.ts'
import { stripTimestamps } from '../fixtures/productionGames/loadFixtures.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { pickAction, testGameRow, testGameSettings, testPlayers } from '../supabaseStack/sampleGame.ts'
import { CHANCE_GAME_TYPE, registerChanceGame, type ChanceData } from '../../../packages/sdk/src/__tests__/chanceGame.ts'

registerChanceGame()

const GAME_ID = '3f1c2d4e-0000-4000-8000-00000000c0de'
const ALICE = 'auth-user-alice' // room owner, seated
const BOB = 'auth-user-bob'
const CAROL = 'auth-user-carol'

const PLAYERS = testPlayers(GAME_ID, [
  { id: 'seat-alice', userId: ALICE, name: 'Alice' },
  { id: 'seat-bob', userId: BOB, name: 'Bob' },
  { id: 'seat-carol', userId: CAROL, name: 'Carol' },
])
const USER_FOR_SEAT: Record<string, string> = { 'seat-alice': ALICE, 'seat-bob': BOB, 'seat-carol': CAROL }

/** Puts a lobby room with everyone seated and ready into the stack, then starts it through the real start-game function. */
async function startRoom(stack: ProductionStack, options: { gameType?: string; settings?: Partial<GameSettings>; playMode?: GameRow['play_mode'] } = {}): Promise<GameRow> {
  const game = testGameRow({
    id: GAME_ID,
    createdBy: ALICE,
    playerCount: PLAYERS.length,
    status: 'lobby',
    gameType: options.gameType ?? CHANCE_GAME_TYPE,
    playMode: options.playMode,
    settings: testGameSettings({ rulesVersion: 1, ...options.settings }),
  })
  for (const userId of [ALICE, BOB, CAROL]) stack.addUser(userId)
  stack.db.seed('games', game as unknown as Record<string, unknown>)
  for (const player of PLAYERS) stack.db.seed('players', player as unknown as Record<string, unknown>)
  const started = await stack.startGame(ALICE, GAME_ID)
  if (!started.ok) throw new Error(`start-game refused: ${started.error}`)
  return { ...game, status: 'active' }
}

async function play(stack: ProductionStack, seat: string, value: number): Promise<GameState<ChanceData>> {
  const result = await stack.applyAction(USER_FOR_SEAT[seat], GAME_ID, pickAction(seat, value))
  if (!result.ok) throw new Error(`apply-action refused: ${result.error}`)
  return result.state as GameState<ChanceData>
}

function seedOf(stack: ProductionStack): string {
  return stack.db.table<{ game_id: string; random_seed: string }>('game_secrets').find((row) => row.game_id === GAME_ID)!.random_seed
}

describe('random draws through the Edge Functions', () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('keeps the seed server-side, and records every draw so a client replays the game without it', async () => {
    const game = await startRoom(stack)
    const seed = seedOf(stack)
    expect(seed).toMatch(/^[0-9a-f]{32}$/)

    await play(stack, 'seat-alice', 1)
    const state = await play(stack, 'seat-bob', 2)
    expect(state.setupRandom?.length).toBeGreaterThan(0)
    expect(state.actionHistory.every((entry) => entry.random?.length === 1)).toBe(true)

    // No player can read the secret, and it's nowhere in what they can read.
    const { data } = await stack.clientFor(ALICE).from('game_secrets').select()
    expect(data ?? []).toEqual([])
    const read = await stack.readGameState(BOB, GAME_ID)
    expect(JSON.stringify(read)).not.toContain(seed)
    expect(JSON.stringify(stack.db.table('games'))).not.toContain(seed)

    // A client rebuilds genesis from the row + recorded setup draws, and
    // replays the log from the recorded move draws: the server's state exactly.
    const genesis = buildGenesisState(game, PLAYERS as PlayerRow[], read!.state.setupRandom)
    expect(stripTimestamps(replayActions(genesis, read!.state.actionHistory))).toEqual(stripTimestamps(read!.state))
  })

  it('draws the same numbers for a move made again after an undo — no rerolling by undo', async () => {
    await startRoom(stack)
    const first = await play(stack, 'seat-alice', 1)
    const undone = await stack.undoAction(ALICE, GAME_ID)
    expect(undone.ok).toBe(true)
    const again = await play(stack, 'seat-alice', 4)
    expect(again.game.bonuses).toEqual(first.game.bonuses)
  })

  it('creates the seed on first use for a room that was never started through start-game', async () => {
    // A duplicated room arrives already active, its genesis (setup draws
    // and all) copied from the source game rather than built by start-game.
    for (const userId of [ALICE, BOB, CAROL]) stack.addUser(userId)
    const game = testGameRow({ id: GAME_ID, createdBy: ALICE, playerCount: PLAYERS.length, gameType: CHANCE_GAME_TYPE, settings: testGameSettings({ rulesVersion: 1 }) })
    await stack.seedStartedGame({ game, players: PLAYERS, genesis: buildGenesisState(game, PLAYERS, seededSource('the source game', 'setup')) })
    expect(stack.db.table('game_secrets')).toHaveLength(0)
    await play(stack, 'seat-alice', 1)
    expect(stack.db.table('game_secrets')).toHaveLength(1)
  })
})

describe('lockRevealedInformationEnabled through undo-action', () => {
  let stack: ProductionStack

  beforeEach(async () => {
    stack = await createProductionStack()
  })
  afterEach(() => {
    stack.dispose()
  })

  it('refuses undoing a move whose random draws a player has seen, except to the owner in admin mode', async () => {
    await startRoom(stack, { settings: { lockRevealedInformationEnabled: true } })
    await play(stack, 'seat-alice', 1)

    const byBob = await stack.undoAction(BOB, GAME_ID)
    expect(byBob).toMatchObject({ ok: false, status: 403 })
    const byOwner = await stack.undoAction(ALICE, GAME_ID)
    expect(byOwner).toMatchObject({ ok: false, status: 403 })

    const adminOn = await stack.applyAction(ALICE, GAME_ID, { type: 'SET_ADMIN_MODE', playerId: 'seat-alice', enabled: true })
    expect(adminOn.ok).toBe(true)
    expect(await stack.undoAction(ALICE, GAME_ID)).toMatchObject({ ok: true })
  })

  it('refuses undoing the move that revealed hidden information, but not a still-secret one', async () => {
    await startRoom(stack, { gameType: 'unique-pick', settings: { hiddenInformationEnabled: true, lockRevealedInformationEnabled: true } })
    await play(stack, 'seat-alice', 1)
    // Alice's pick is still secret: undoing it reveals nothing.
    expect(await stack.undoAction(ALICE, GAME_ID)).toMatchObject({ ok: true })
    await play(stack, 'seat-alice', 1)
    await play(stack, 'seat-bob', 2)
    await play(stack, 'seat-carol', 3) // resolves the round, revealing every pick
    expect(await stack.undoAction(CAROL, GAME_ID)).toMatchObject({ ok: false, status: 403 })
  })

  it('never locks without the option', async () => {
    await startRoom(stack)
    await play(stack, 'seat-alice', 1)
    expect(await stack.undoAction(BOB, GAME_ID)).toMatchObject({ ok: true })
  })

  it('never locks in hotseat, where one device plays every seat', async () => {
    await startRoom(stack, { playMode: 'hotseat', settings: { ruleEnforcementEnabled: true, lockRevealedInformationEnabled: true } })
    await play(stack, 'seat-alice', 1)
    expect(await stack.undoAction(ALICE, GAME_ID)).toMatchObject({ ok: true })
  })
})
