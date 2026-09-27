import { describe, expect, it } from 'vitest'
import { currentActorId, pendingActorIds } from '../turnOrder'
import { act, newGame, pick } from './helpers'

describe('pendingActorIds', () => {
  it("is the game's pendingPlayerIds while active", () => {
    const state = pick(newGame({ players: 3 }), 'p2', 1)
    expect(pendingActorIds(state)).toEqual(['p1', 'p3'])
  })

  it('is empty once the game is over, whatever pendingPlayerIds says', () => {
    const completed = act(newGame(), { type: 'CONCEDE', playerId: 'p1' })
    expect(pendingActorIds({ ...completed, pendingPlayerIds: ['p2'] })).toEqual([])
  })
})

describe('currentActorId', () => {
  it('is the first pending player', () => {
    expect(currentActorId(pick(newGame({ players: 3 }), 'p1', 1))).toBe('p2')
  })

  it('is null when nobody is pending', () => {
    expect(currentActorId(act(newGame(), { type: 'CONCEDE', playerId: 'p1' }))).toBeNull()
    expect(currentActorId({ ...newGame(), pendingPlayerIds: [] })).toBeNull()
  })
})
