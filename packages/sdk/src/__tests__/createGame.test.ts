import { DEFAULT_GAME_OPTIONS } from '@game-platform/unique-pick/rules'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../createGame'
import { registerGame } from '../registry'
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

    // The lobby, and the Random setup may draw from.
    expect(setup.mock.calls[0]).toHaveLength(2)
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

  it('carries lockRevealedInformationEnabled onto genesis only when on, so older genesis states are unchanged', () => {
    expect(createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds, lockRevealedInformationEnabled: true }).lockRevealedInformationEnabled).toBe(true)
    expect('lockRevealedInformationEnabled' in createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'live', players: seeds })).toBe(false)
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

describe('createNewGame with assets', () => {
  // The example game with one asset kind: a "board" is any positive number, for 2–3 players.
  const withAssets = {
    ...game,
    id: 'unique-pick-assets',
    assetKinds: {
      board: {
        label: 'Board',
        normalize: (raw: unknown) => (typeof raw === 'number' && raw > 0 ? raw : null),
        playerRange: () => ({ min: 2, max: 3 }),
      },
    },
  }
  registerGame(withAssets)

  it('hands setup each payload the game accepts, normalized, and keeps them on the state', () => {
    const setup = vi.spyOn(withAssets, 'setup')
    const state = createNewGame({ gameId: 'g1', gameType: withAssets.id, playMode: 'async', players: seeds, assets: { board: 7, unknownKind: 1 } })
    expect(setup.mock.calls[0][0].assets).toEqual({ board: 7 })
    expect(state.assets).toEqual({ board: 7 })
  })

  it('drops a payload the game rejects, and leaves the key off entirely when nothing survives', () => {
    const state = createNewGame({ gameId: 'g1', gameType: withAssets.id, playMode: 'async', players: seeds, assets: { board: -1 } })
    expect('assets' in state).toBe(false)
    expect('assets' in createNewGame({ gameId: 'g1', gameType: 'unique-pick', playMode: 'async', players: seeds, assets: { board: 7 } })).toBe(false)
  })

  it('rejects an asset kind id that is not a slug at registration', () => {
    expect(() => registerGame({ ...withAssets, id: 'bad-kind-game', assetKinds: { 'Not A Slug': withAssets.assetKinds.board } })).toThrow(/asset kind/)
  })
})
