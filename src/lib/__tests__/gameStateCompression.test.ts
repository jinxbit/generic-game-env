import { describe, expect, it } from 'vitest'
import { act, newGame, pickAll } from '@game-platform/unique-pick/testing'
import type { GameState } from '@game-platform/sdk'
import { compressGameStateForStorage, decompressGameStateFromStorage } from '../gameStateCompression'

/** A few rounds into a 6-player game, so there's a realistic amount of repetitive JSON to compress. */
function playedState(): GameState {
  let state = newGame({ players: 6, options: { targetScore: 30, maxRounds: 30 } })
  for (let round = 0; round < 5; round++) {
    state = pickAll(state, { p1: 1, p2: 2, p3: 3, p4: 3, p5: 4, p6: 5 })
  }
  return act(state, { type: 'CONCEDE', playerId: 'p6' })
}

describe('gameStateCompression', () => {
  it('round-trips a real game state through compress/decompress', async () => {
    const state = playedState()

    const compressed = await compressGameStateForStorage(state)
    expect(typeof compressed.__gz).toBe('string')

    expect(await decompressGameStateFromStorage(compressed)).toEqual(state)
  })

  it('is dramatically smaller than the pretty-printed JSON it replaces', async () => {
    const state = playedState()
    const pretty = JSON.stringify(state, null, 2)

    const compressed = await compressGameStateForStorage(state)

    expect(JSON.stringify(compressed).length).toBeLessThan(pretty.length / 2)
  })

  it('passes a legacy/client-trusted row (no __gz key) through unchanged', async () => {
    const state = playedState()
    expect(await decompressGameStateFromStorage(state)).toBe(state)
  })

  it('duplicates status/phase/turn/pendingPlayerIds/activePlayerId/turnOrder in plaintext, for the game_state_sync_meta trigger to read', async () => {
    const state = { ...playedState(), activePlayerId: 'p2' }

    const compressed = await compressGameStateForStorage(state)

    expect(compressed.status).toBe(state.status)
    expect(compressed.phase).toBe(state.phase)
    expect(compressed.turn).toBe(state.turn)
    expect(compressed.pendingPlayerIds).toEqual(state.pendingPlayerIds)
    expect(compressed.activePlayerId).toBe('p2')
    expect(compressed.turnOrder).toEqual(state.turnOrder)
  })
})
