import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAction } from '../applyAction'
import { act, game, newGame, pick } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CONCEDE', () => {
  it('flags the player eliminated and conceded, and drops them from turn order and pending', () => {
    const state = act(newGame({ players: 3 }), { type: 'CONCEDE', playerId: 'p2' })

    expect(state.players.find((p) => p.id === 'p2')).toMatchObject({ eliminated: true, conceded: true })
    expect(state.players.filter((p) => p.eliminated).map((p) => p.id)).toEqual(['p2'])
    expect(state.turnOrder).toEqual(['p1', 'p3'])
    expect(state.pendingPlayerIds).toEqual(['p1', 'p3'])
    expect(state.status).toBe('active')
  })

  it('keeps the player seated — players never shrinks', () => {
    const state = act(newGame({ players: 3 }), { type: 'CONCEDE', playerId: 'p2' })
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('clears activePlayerId when the conceding player held it', () => {
    const state = act({ ...newGame({ players: 3 }), activePlayerId: 'p2' }, { type: 'CONCEDE', playerId: 'p2' })
    expect(state.activePlayerId).toBeNull()
  })

  it('leaves activePlayerId alone when someone else held it', () => {
    const state = act({ ...newGame({ players: 3 }), activePlayerId: 'p1' }, { type: 'CONCEDE', playerId: 'p2' })
    expect(state.activePlayerId).toBe('p1')
  })

  it('ends the game outright when only one player is left, naming them the winner', () => {
    const spy = vi.spyOn(game, 'onPlayerEliminated')

    const state = act(newGame(), { type: 'CONCEDE', playerId: 'p1' })

    expect(state.status).toBe('completed')
    expect(state.winnerPlayerIds).toEqual(['p2'])
    expect(state.phase).toBeNull()
    expect(state.activePlayerId).toBeNull()
    expect(state.pendingPlayerIds).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it("hands off to the game's onPlayerEliminated otherwise", () => {
    const spy = vi.spyOn(game, 'onPlayerEliminated')

    act(newGame({ players: 3 }), { type: 'CONCEDE', playerId: 'p2' })

    expect(spy).toHaveBeenCalledOnce()
    const [passed, playerId] = spy.mock.calls[0]
    expect(playerId).toBe('p2')
    // The framework's own bookkeeping is already done by then.
    expect(passed.turnOrder).toEqual(['p1', 'p3'])
    expect(passed.pendingPlayerIds).toEqual(['p1', 'p3'])
  })

  it('lets the game resolve a round the leaver was the only one holding open', () => {
    const state = act(pick(pick(newGame({ players: 3 }), 'p1', 2), 'p2', 3), { type: 'CONCEDE', playerId: 'p3' })

    expect(state.game.rounds).toEqual([{ round: 1, picks: { p1: 2, p2: 3 }, pointsByPlayerId: { p1: 2, p2: 3 } }])
    expect(state.turn).toBe(2)
    expect(state.pendingPlayerIds).toEqual(['p1', 'p2'])
  })

  it('is logged as one entry, like any other action', () => {
    const state = act(newGame({ players: 3 }), { type: 'CONCEDE', playerId: 'p2' })
    expect(state.actionHistory).toEqual([{ action: { type: 'CONCEDE', playerId: 'p2' }, turn: 1, timestamp: expect.any(String) }])
  })

  it('may be submitted by a player who is not pending', () => {
    const state = act(pick(newGame({ players: 3 }), 'p1', 2), { type: 'CONCEDE', playerId: 'p1' })
    expect(state.players[0].eliminated).toBe(true)
    expect(state.game.picks).toEqual({ p2: null, p3: null })
  })

  it.each([
    ['an unknown player', () => newGame(), 'p9', 'Unknown player: p9'],
    ['an already-eliminated player', () => act(newGame({ players: 3 }), { type: 'CONCEDE', playerId: 'p2' }), 'p2', 'Player is already eliminated'],
    ['a finished game', () => act(newGame(), { type: 'CONCEDE', playerId: 'p2' }), 'p1', 'Game is not active (status: completed)'],
  ])('rejects %s', (_label, build, playerId, error) => {
    expect(applyAction(build(), { type: 'CONCEDE', playerId })).toEqual({ ok: false, error })
  })
})
