import { describe, expect, it } from 'vitest'
import { act, newGame, pickAll } from '../../engine/__tests__/helpers'
import type { GameState } from '../../engine/types'
import { GAME_STATE_EXPORT_SCHEMA, GAME_STATE_EXPORT_VERSION, decodeGameStateExport, encodeGameStateExport } from '../gameStateExport'

/** A few rounds into a 6-player game, so there's a realistic amount of repetitive JSON to compress. */
function playedState(): GameState {
  let state = newGame({ players: 6, playMode: 'hotseat', options: { targetScore: 30, maxRounds: 30 } })
  for (let round = 0; round < 5; round++) {
    state = pickAll(state, { p1: 1, p2: 2, p3: 3, p4: 3, p5: 4, p6: 5 })
  }
  return act(state, { type: 'CONCEDE', playerId: 'p6' })
}

describe('gameStateExport', () => {
  it('round-trips a real game state through encode/decode', async () => {
    const state = playedState()

    const encoded = await encodeGameStateExport(state)
    const parsed = JSON.parse(encoded)
    expect(parsed.schema).toBe(GAME_STATE_EXPORT_SCHEMA)
    expect(parsed.version).toBe(GAME_STATE_EXPORT_VERSION)
    expect(typeof parsed.gameStateZipped).toBe('string')

    const envelope = await decodeGameStateExport(encoded)
    expect(envelope.schema).toBe(GAME_STATE_EXPORT_SCHEMA)
    expect(envelope.gameState).toEqual(state)
  })

  it('is dramatically smaller than the pretty-printed JSON it replaces', async () => {
    const state = playedState()
    const pretty = JSON.stringify(state, null, 2)

    const encoded = await encodeGameStateExport(state)

    expect(encoded.length).toBeLessThan(pretty.length / 2)
  })

  it('rejects text that is not valid JSON', async () => {
    await expect(decodeGameStateExport('not json at all')).rejects.toThrow(/recognized game state export/)
  })

  it('rejects an object whose schema does not match', async () => {
    await expect(decodeGameStateExport('{"not": "an export"}')).rejects.toThrow(/schema/)
  })
})
