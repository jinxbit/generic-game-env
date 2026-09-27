import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newGame, pickAll } from '../../engine/__tests__/helpers'
import { MAX_ENTRIES, loadCachedGameState, saveCachedGameState } from '../gameStateCache'

/** Reaches into the raw fake IndexedDB store to corrupt a single field of an already-saved entry — the only way to exercise loadCachedGameState's invalidation checks, since saveCachedGameState itself always writes a consistent entry. */
async function corruptStoredEntry(gameId: string, userId: string, patch: Record<string, unknown>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const openRequest = indexedDB.open('riseAndFall', 1)
    openRequest.onsuccess = () => {
      const db = openRequest.result
      const tx = db.transaction('gameStateCache', 'readwrite')
      const store = tx.objectStore('gameStateCache')
      const getRequest = store.get(`${gameId}:${userId}`)
      getRequest.onsuccess = () => {
        store.put({ ...getRequest.result, ...patch })
      }
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    openRequest.onerror = () => reject(openRequest.error)
  })
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  globalThis.IDBKeyRange = IDBKeyRange
})

describe('gameStateCache', () => {
  it('round-trips a real game state through save/load', async () => {
    const state = pickAll(newGame(), { p1: 2, p2: 4 })

    await saveCachedGameState('game_1', 'auth_1', 1, state)
    const loaded = await loadCachedGameState('game_1', 'auth_1')

    expect(loaded).toEqual(state)
  })

  it('returns null for a game/user pair that was never saved', async () => {
    expect(await loadCachedGameState('game_missing', 'auth_1')).toBeNull()
  })

  it('scopes entries to userId: a different signed-in user gets nothing back', async () => {
    const state = newGame()

    await saveCachedGameState('game_1', 'auth_1', 1, state)

    expect(await loadCachedGameState('game_1', 'auth_2')).toBeNull()
  })

  it('falls back to null when the stored buildId does not match __BUILD_ID__', async () => {
    const state = newGame()
    await saveCachedGameState('game_1', 'auth_1', 1, state)

    await corruptStoredEntry('game_1', 'auth_1', { buildId: 'some-older-build' })

    expect(await loadCachedGameState('game_1', 'auth_1')).toBeNull()
  })

  it('falls back to null when the stateHash does not match (corrupted/partial entry)', async () => {
    const state = newGame()
    await saveCachedGameState('game_1', 'auth_1', 1, state)

    await corruptStoredEntry('game_1', 'auth_1', { stateHash: 'deadbeef' })

    expect(await loadCachedGameState('game_1', 'auth_1')).toBeNull()
  })

  it('degrades silently to "no cache" when IndexedDB is unavailable', async () => {
    // @ts-expect-error simulating an environment with no IndexedDB (private browsing, blocked site data)
    delete globalThis.indexedDB

    const state = newGame()
    await expect(saveCachedGameState('game_1', 'auth_1', 1, state)).resolves.toBeUndefined()
    await expect(loadCachedGameState('game_1', 'auth_1')).resolves.toBeNull()
  })

  it('evicts the oldest entries once the store exceeds MAX_ENTRIES', async () => {
    const state = newGame()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now++)

    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      await saveCachedGameState(`game_${i}`, 'auth_1', 1, state)
    }

    expect(await loadCachedGameState('game_0', 'auth_1')).toBeNull()
    expect(await loadCachedGameState('game_4', 'auth_1')).toBeNull()
    expect(await loadCachedGameState(`game_${MAX_ENTRIES + 4}`, 'auth_1')).toEqual(state)

    vi.restoreAllMocks()
  })

  it('re-saving the same game/user overwrites rather than growing the store', async () => {
    const state = newGame()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now++)

    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      await saveCachedGameState('game_1', 'auth_1', i, state)
    }

    const loaded = await loadCachedGameState('game_1', 'auth_1')
    expect(loaded).toEqual(state)

    vi.restoreAllMocks()
  })
})
