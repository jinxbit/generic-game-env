import { DEFAULT_GAME_OPTIONS } from '@game-platform/unique-pick/rules'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../createGame'
import { game, newGame } from './helpers'

const seeds = [
  { id: 'p1', authUserId: 'auth_1', displayName: 'Alice', color: '#ef4444' },
  { id: 'p2', authUserId: null, displayName: 'Bob', color: '#3b82f6' },
]

// newGame() registers the example game; make sure it is before any direct createNewGame call.
newGame()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createNewGame', () => {
  it('hands the game a lobby envelope with players seated in order, options normalized and nothing logged', () => {
    const setup = vi.spyOn(game, 'setup')
    createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'async', players: seeds })

    expect(setup.mock.calls[0]).toHaveLength(1)
    const [lobby] = setup.mock.calls[0]
    expect(lobby).toEqual({
      gameId: 'g1',
      gameType: 'unique-pick',
      rulesVersion: game.rulesVersion,
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
      options: game.defaultOptions,
      actionHistory: [],
      adminModeActive: false,
    })
  })

  it("carries the room's random seed onto the lobby and genesis, and adds no key for a seedless game", () => {
    const setup = vi.spyOn(game, 'setup')
    const genesis = createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds, randomSeed: 'abc123' })
    expect(setup.mock.calls[0][0].randomSeed).toBe('abc123')
    expect(genesis.randomSeed).toBe('abc123')

    expect('randomSeed' in createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds })).toBe(false)
  })

  it("returns whatever the game's setup returns — active, with options and game data", () => {
    const genesis = createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds, hiddenInformationEnabled: true })

    expect(genesis.status).toBe('active')
    expect(genesis.gameType).toBe('unique-pick')
    expect(genesis.rulesVersion).toBe(game.rulesVersion)
    expect(genesis.hiddenInformationEnabled).toBe(true)
    expect(genesis.options).toEqual(DEFAULT_GAME_OPTIONS)
    expect(genesis.game).toBeDefined()
    expect(genesis.actionHistory).toEqual([])
  })

  it('passes explicit options through to setup', () => {
    const genesis = createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds, options: { targetScore: 7, maxRounds: 2 } })
    expect(genesis.options).toEqual({ targetScore: 7, maxRounds: 2 })
  })

  it("runs raw options through the game's normalizeOptions before setup sees them", () => {
    const normalize = vi.spyOn(game, 'normalizeOptions')
    const genesis = createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds, options: { targetScore: 999 } })

    expect(normalize).toHaveBeenCalledWith({ targetScore: 999 })
    expect(genesis.options).toEqual({ targetScore: 30, maxRounds: DEFAULT_GAME_OPTIONS.maxRounds })
  })

  it('throws for a game type that isn’t registered', () => {
    expect(() => createNewGame({ gameId: 'g1', gameType: 'no-such-game', playMode: 'live', players: seeds })).toThrow(/Unknown game type "no-such-game"/)
  })

  it('is deterministic', () => {
    const params = { gameId: 'g1', gameType: 'unique-pick', playMode: 'live' as const, players: seeds }
    expect(createNewGame(params)).toEqual(createNewGame(params))
  })
})
