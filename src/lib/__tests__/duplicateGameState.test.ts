import { describe, expect, it } from 'vitest'
import { replayActions } from '@game-platform/sdk'
import { act, newGame, pick } from '@game-platform/unique-pick/testing'
import { remapGameStatePlayerIds } from '../duplicateGameState'

describe('remapGameStatePlayerIds', () => {
  const playerIdMap = { p1: 'new-p1', p2: 'new-p2', p3: 'new-p3' }

  it('rewrites every player-id reference onto the new roster, and sets gameId/authUserId', () => {
    const genesis = newGame({ players: 3 })
    // A resolved round (rounds[].picks/pointsByPlayerId, scores), an open
    // round with one pick in (picks, pendingPlayerIds) and a concede
    // (turnOrder, eliminated) cover every place the game keys by player id.
    let state = pick(pick(pick(genesis, 'p1', 1), 'p2', 2), 'p3', 2)
    state = pick(state, 'p2', 4)
    state = act(state, { type: 'CONCEDE', playerId: 'p3' })

    const remapped = remapGameStatePlayerIds(state, { newGameId: 'game_2', playerIdMap, hostUserId: 'host_1' })

    expect(remapped.gameId).toBe('game_2')
    expect(remapped.players.map((p) => p.id)).toEqual(['new-p1', 'new-p2', 'new-p3'])
    expect(remapped.players.every((p) => p.authUserId === 'host_1')).toBe(true)
    expect(remapped.turnOrder).toEqual(['new-p1', 'new-p2'])
    expect(remapped.pendingPlayerIds).toEqual(['new-p1'])
    expect(remapped.game.scores).toEqual({ 'new-p1': 1, 'new-p2': 0, 'new-p3': 0 })
    expect(remapped.game.picks).toEqual({ 'new-p1': null, 'new-p2': 4 })
    expect(Object.keys(remapped.game.rounds[0].picks).sort()).toEqual(['new-p1', 'new-p2', 'new-p3'])
    expect(remapped.actionHistory.map((entry) => ('playerId' in entry.action ? entry.action.playerId : null))).toEqual(['new-p1', 'new-p2', 'new-p3', 'new-p2', 'new-p3'])

    // Source state is untouched.
    expect(state.gameId).toBe('game_1')
    expect(state.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('remaps winnerPlayerIds and activePlayerId', () => {
    const state = { ...act(newGame(), { type: 'CONCEDE', playerId: 'p2' }), activePlayerId: 'p1' }
    expect(state.winnerPlayerIds).toEqual(['p1'])

    const remapped = remapGameStatePlayerIds(state, { newGameId: 'game_2', playerIdMap, hostUserId: 'host_1' })

    expect(remapped.winnerPlayerIds).toEqual(['new-p1'])
    expect(remapped.activePlayerId).toBe('new-p1')
  })

  it('stays replayable from a genesis built for the new roster', () => {
    const state = pick(pick(newGame(), 'p1', 3), 'p2', 5)
    const remapped = remapGameStatePlayerIds(state, { newGameId: 'game_2', playerIdMap, hostUserId: 'host_1' })
    const newGenesis = remapGameStatePlayerIds(newGame(), { newGameId: 'game_2', playerIdMap, hostUserId: 'host_1' })

    expect(replayActions(newGenesis, remapped.actionHistory)).toEqual(remapped)
  })
})
