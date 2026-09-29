import { describe, expect, it } from 'vitest'
import type { AnyGameDefinition } from '../gameDefinition'
import { moveReviewStops, nextStop, previousStop, sinceLastTurnStop, stopsByRound, turnReviewStops, type ReviewEntry } from '../reviewStops'

const entry = (playerId: string | null, turn: number, type = 'MOVE'): ReviewEntry => ({ action: { type, playerId }, turn })
// Round 1: a, b; round 2: a, b, a.
const log = [entry('a', 1), entry('b', 1), entry('a', 2), entry('b', 2), entry('a', 2)]

describe('review stops', () => {
  it('fall back to one stop per round, from genesis to now', () => {
    expect(stopsByRound(log)).toEqual([0, 2])
    expect(turnReviewStops(null, log)).toEqual([0, 2, 5])
    expect(turnReviewStops(null, [])).toEqual([0])
  })

  it('use the game’s own turns, cleaned up: sorted, unique, in bounds, with genesis and now', () => {
    const game = { reviewStops: () => [3, 1, 1, 99, -1, 2.5] } as unknown as AnyGameDefinition
    expect(turnReviewStops(game, log)).toEqual([0, 1, 3, 5])
    const broken = { reviewStops: () => { throw new Error('boom') } } as unknown as AnyGameDefinition
    expect(turnReviewStops(broken, log)).toEqual([0, 2, 5])
  })

  it('step a move at a time', () => {
    expect(moveReviewStops(log)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('open right after the viewer’s own last move, on a stop', () => {
    const stops = [0, 1, 2, 3, 4, 5]
    expect(sinceLastTurnStop(stops, log, 'b')).toBe(4)
    expect(sinceLastTurnStop(stops, log, 'a')).toBe(5)
    expect(sinceLastTurnStop([0, 2, 5], log, 'b')).toBe(5)
    expect(sinceLastTurnStop(stops, log, null)).toBe(0)
    expect(sinceLastTurnStop(stops, log, 'nobody')).toBe(0)
  })

  it('step between stops', () => {
    const stops = [0, 2, 5]
    expect(previousStop(stops, 5)).toBe(2)
    expect(previousStop(stops, 3)).toBe(2)
    expect(previousStop(stops, 0)).toBeNull()
    expect(nextStop(stops, 2)).toBe(5)
    expect(nextStop(stops, 5)).toBeNull()
  })

  it('read a redacted log’s placeholders like any entry', () => {
    const redacted = [entry('a', 1), entry('b', 1, 'HIDDEN_ACTION')]
    expect(sinceLastTurnStop(moveReviewStops(redacted), redacted, 'b')).toBe(2)
  })
})
