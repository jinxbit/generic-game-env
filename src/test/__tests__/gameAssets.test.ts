// @vitest-environment node
//
// Game assets (supabase/migrations/0003_game_assets.sql, src/lib/roomAssets.ts)
// against the production-like stack: who may read, create and publish an
// asset; a room's copied asset changing only in the lobby; and the
// start-game Edge Function starting a game from a chosen asset, or picking a
// random public one that fits the seated count — written back to the room,
// so undo and redo rebuild the same genesis.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type GameState } from '@game-platform/sdk'
import { extractSavedMap, type GameData, type GameOptions, type SavedMap } from '@game-platform/rise-and-fall/rules'
import { newGame, play, simplestMove } from '@game-platform/rise-and-fall/testing'
import type { GameAssetRow, GameRow } from '../../lib/dbTypes.ts'
import { decompressGameStateFromStorage, type StoredGameState } from '../../lib/gameStateCompression.ts'
import type { RoomAssets } from '../../lib/roomAssets.ts'
import { createProductionStack, type ProductionStack } from '../supabaseStack/index.ts'
import { testGameSettings } from '../supabaseStack/sampleGame.ts'

const OWNER = 'auth-owner'
const GUEST = 'auth-guest'
const ADMIN = 'auth-admin'

/** A real map: a game of `players` built together, to the end of tile placement. */
function builtMap(players: number): SavedMap {
  let s = newGame({ players })
  while (s.phase === 'placeTiles') s = play(s, simplestMove(s)!)
  return extractSavedMap(s)!
}

async function trueState(stack: ProductionStack, gameId: string): Promise<GameState<GameData, GameOptions>> {
  const row = stack.db.table<{ game_id: string; state: StoredGameState }>('game_state').find((r) => r.game_id === gameId)!
  return (await decompressGameStateFromStorage(row.state)) as GameState<GameData, GameOptions>
}

/** A lobby room with the owner and guest seated and ready, starting from `assets`. */
async function lobbyRoom(stack: ProductionStack, assets: RoomAssets): Promise<GameRow> {
  const { data: game, error } = await stack
    .clientFor(OWNER)
    .from('games')
    .insert({
      room_code: 'ASSET1',
      name: 'Asset room',
      game_type: 'rise-and-fall',
      play_mode: 'live',
      created_by: OWNER,
      min_players: 2,
      max_players: 2,
      settings: testGameSettings({ rulesVersion: 1 }),
      assets,
    })
    .select()
    .single()
  if (error) throw error
  const room = game as GameRow
  for (const [seat, userId] of [OWNER, GUEST].entries()) {
    const { error: seatError } = await stack
      .clientFor(userId)
      .from('players')
      .insert({ game_id: room.id, user_id: userId, display_name: userId, avatar_url: null, seat_index: seat, color: ['#ef4444', '#3b82f6'][seat] })
    if (seatError) throw seatError
  }
  return room
}

async function insertAsset(stack: ProductionStack, userId: string, fields: Partial<GameAssetRow>) {
  return stack
    .clientFor(userId)
    .from('game_assets')
    .insert({ game_type: 'rise-and-fall', kind: 'map', name: 'Map', visibility: 'private', min_players: 2, max_players: 2, created_by: userId, ...fields })
    .select()
    .single()
}

describe('game assets', () => {
  let stack: ProductionStack
  const map2 = builtMap(2)
  const map3 = builtMap(3)

  beforeEach(async () => {
    stack = await createProductionStack()
    stack.addUser(OWNER)
    stack.addUser(GUEST)
    stack.addUser(ADMIN, { isAdmin: true })
  })
  afterEach(() => {
    stack.dispose()
  })

  it('lets anyone keep private assets, and only an admin publish one', async () => {
    const mine = await insertAsset(stack, OWNER, { name: 'Mine', data: map2 })
    expect(mine.error).toBeNull()
    expect((await insertAsset(stack, OWNER, { name: 'Sneaky', visibility: 'public', data: map2 })).error?.code).toBe('42501')
    const published = await insertAsset(stack, ADMIN, { name: 'Curated', visibility: 'public', data: map2 })
    expect(published.error).toBeNull()

    const names = async (userId: string) => ((await stack.clientFor(userId).from('game_assets').select('name')).data ?? []).map((row) => row.name).sort()
    expect(await names(OWNER)).toEqual(['Curated', 'Mine'])
    expect(await names(GUEST)).toEqual(['Curated'])
    expect(await names(ADMIN)).toEqual(['Curated', 'Mine'])

    // The owner can't publish their own, or touch someone else's.
    const id = (mine.data as GameAssetRow).id
    expect((await stack.clientFor(OWNER).from('game_assets').update({ visibility: 'public' }).eq('id', id).select()).error?.code).toBe('42501')
    expect((await stack.clientFor(GUEST).from('game_assets').delete().eq('id', id).select()).data).toEqual([])
    // An admin can publish it.
    expect((await stack.clientFor(ADMIN).from('game_assets').update({ visibility: 'public' }).eq('id', id).select()).data).toHaveLength(1)
    expect(await names(GUEST)).toEqual(['Curated', 'Mine'])
  })

  it('enforces the table’s checks', async () => {
    expect((await insertAsset(stack, OWNER, { name: '', data: map2 })).error?.code).toBe('23514')
    expect((await insertAsset(stack, OWNER, { kind: 'Not A Slug', data: map2 })).error?.code).toBe('23514')
    expect((await insertAsset(stack, OWNER, { min_players: 3, max_players: 2, data: map2 })).error?.code).toBe('23514')
  })

  it('starts a game from a chosen map, and lets the room’s assets change only in the lobby', async () => {
    const room = await lobbyRoom(stack, {})
    const owner = stack.clientFor(OWNER)
    const before = stack.db.table<GameRow>('games')[0].config_version
    const chosen: RoomAssets = { map: { mode: 'chosen', assetId: null, name: 'Built', data: map2 } }
    expect((await owner.from('games').update({ assets: chosen }).eq('id', room.id)).error).toBeNull()
    // Changing the assets is a configuration change: everyone re-confirms Ready.
    const after = stack.db.table<GameRow>('games')[0].config_version
    expect(after).toBe(before + 1)
    await stack.clientFor(GUEST).from('players').update({ ready_for_version: after }).eq('game_id', room.id).eq('user_id', GUEST)

    expect(await stack.startGame(OWNER, room.id)).toMatchObject({ ok: true })
    const genesis = await trueState(stack, room.id)
    expect(genesis.phase).toBe('placeUnits')
    expect(genesis.assets).toEqual({ map: map2 })

    const locked = await owner.from('games').update({ assets: {} }).eq('id', room.id)
    expect(locked.error?.message).toMatch(/Configuration can only change/)
  })

  it('picks a random public map that fits at Start, writes it to the room, and rebuilds from it on undo', async () => {
    await insertAsset(stack, ADMIN, { name: 'For three', visibility: 'public', min_players: 3, max_players: 3, data: map3 })
    await insertAsset(stack, OWNER, { name: 'Private two', data: map2 })
    const fits = await insertAsset(stack, ADMIN, { name: 'Public two', visibility: 'public', data: map2 })
    const room = await lobbyRoom(stack, { map: { mode: 'random' } })

    expect(await stack.startGame(OWNER, room.id)).toMatchObject({ ok: true })
    const row = stack.db.table<GameRow>('games')[0]
    expect(row.assets).toEqual({ map: { mode: 'random', assetId: (fits.data as GameAssetRow).id, name: 'Public two', data: map2 } })
    const genesis = await trueState(stack, room.id)
    expect(genesis.assets).toEqual({ map: map2 })

    // A move, undone on the server, rebuilds genesis from the row — same map.
    const move = simplestMove(genesis as never)!
    expect(await stack.applyAction(OWNER, room.id, move)).toMatchObject({ ok: true })
    expect(await stack.undoAction(OWNER, room.id)).toMatchObject({ ok: true })
    expect((await trueState(stack, room.id)).game.board).toEqual(genesis.game.board)
  })

  it('builds the map as usual when no public map fits', async () => {
    await insertAsset(stack, ADMIN, { name: 'For three', visibility: 'public', min_players: 3, max_players: 3, data: map3 })
    const room = await lobbyRoom(stack, { map: { mode: 'random' } })
    expect(await stack.startGame(OWNER, room.id)).toMatchObject({ ok: true })
    expect(stack.db.table<GameRow>('games')[0].assets).toEqual({ map: { mode: 'random' } })
    const genesis = await trueState(stack, room.id)
    expect(genesis.phase).toBe('placeTiles')
    expect(genesis.assets).toBeUndefined()
  })
})
