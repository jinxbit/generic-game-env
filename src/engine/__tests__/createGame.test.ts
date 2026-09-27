import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../createGame'
import { game } from '../game'
import { DEFAULT_GAME_OPTIONS } from '../../game/rules'

const seeds = [
  { id: 'p1', authUserId: 'auth_1', displayName: 'Alice', color: '#ef4444' },
  { id: 'p2', authUserId: null, displayName: 'Bob', color: '#3b82f6' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNewGame', () => {
  it('hands the game a lobby envelope with players seated in order and nothing logged', () => {
    const setup = vi.spyOn(game, 'setup')
    createNewGame({ gameId: 'g1', playMode: 'async', players: seeds })

    const [lobby, options] = setup.mock.calls[0]
    expect(lobby).toEqual({
      gameId: 'g1',
      playMode: 'async',
      status: 'lobby',
      hiddenInformationEnabled: false,
      turn: 0,
      phase: null,
      activePlayerId: null,
      pendingPlayerIds: [],
      turnOrder: ['p1', 'p2'],
      players: [
        { id: 'p1', authUserId: 'auth_1', displayName: 'Alice', color: '#ef4444', eliminated: false, conceded: false },
        { id: 'p2', authUserId: null, displayName: 'Bob', color: '#3b82f6', eliminated: false, conceded: false },
      ],
      winnerPlayerIds: [],
      actionHistory: [],
      adminModeActive: false,
    })
    expect(options).toEqual(game.defaultOptions)
  })

  it("returns whatever the game's setup returns — active, with options and game data", () => {
    const genesis = createNewGame({ gameId: 'g1', playMode: 'live', players: seeds, hiddenInformationEnabled: true })

    expect(genesis.status).toBe('active')
    expect(genesis.hiddenInformationEnabled).toBe(true)
    expect(genesis.options).toEqual(DEFAULT_GAME_OPTIONS)
    expect(genesis.game).toBeDefined()
    expect(genesis.actionHistory).toEqual([])
  })

  it('passes explicit options through to setup', () => {
    const genesis = createNewGame({ gameId: 'g1', playMode: 'live', players: seeds, options: { targetScore: 7, maxRounds: 2 } })
    expect(genesis.options).toEqual({ targetScore: 7, maxRounds: 2 })
  })

  it('is deterministic', () => {
    const params = { gameId: 'g1', playMode: 'live' as const, players: seeds }
    expect(createNewGame(params)).toEqual(createNewGame(params))
  })
})
