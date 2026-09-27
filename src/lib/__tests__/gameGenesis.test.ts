import { describe, expect, it } from 'vitest'
import { applyAction, registerGame, replayActions, type GameDefinition } from '@game-platform/sdk'
import { DEFAULT_GAME_OPTIONS, gameDefinition, PICK_PHASE, type GameState, type PickNumberAction } from '@game-platform/unique-pick/rules'
import { buildGenesisState } from '../gameGenesis'
import type { GameRow, GameSettings, PlayerRow } from '../dbTypes'

function makeGame(overrides: Partial<GameRow> = {}, settingsOverrides: Partial<GameSettings> = {}): GameRow {
  return {
    id: 'game_1',
    room_code: 'ABCDE',
    name: 'Test room',
    game_type: 'unique-pick',
    play_mode: 'hotseat',
    status: 'lobby',
    min_players: 2,
    max_players: 4,
    created_by: 'auth_1',
    created_at: '',
    updated_at: '',
    settings: {
      skipHotseatPassGate: false,
      ruleEnforcementEnabled: false,
      hiddenInformationEnabled: false,
      ...settingsOverrides,
    },
    config_version: 0,
    visibility: 'private',
    ...overrides,
  }
}

function makePlayers(): PlayerRow[] {
  return [
    { id: 'p1', game_id: 'game_1', user_id: 'auth_1', display_name: 'Alice', avatar_url: null, seat_index: 0, color: '#ef4444', is_active: true, joined_at: '', ready_for_version: 0 },
    { id: 'p2', game_id: 'game_1', user_id: 'auth_2', display_name: 'Bob', avatar_url: null, seat_index: 1, color: '#3b82f6', is_active: true, joined_at: '', ready_for_version: 0 },
  ]
}

describe('buildGenesisState', () => {
  it('is deterministic: the same game/players always rebuild the same genesis', () => {
    const game = makeGame()
    const players = makePlayers()
    // Genesis's actionHistory is always empty, so there's no wall-clock
    // timestamp anywhere on it left to strip before comparing.
    expect(buildGenesisState(game, players)).toEqual(buildGenesisState(game, players))
  })

  it("returns an active game ready for the first move, with the game's own setup applied", () => {
    const genesis = buildGenesisState(makeGame(), makePlayers())

    expect(genesis.status).toBe('active')
    expect(genesis.gameId).toBe('game_1')
    expect(genesis.playMode).toBe('hotseat')
    expect(genesis.turn).toBe(1)
    expect(genesis.phase).toBe(PICK_PHASE)
    expect(genesis.pendingPlayerIds).toEqual(['p1', 'p2'])
    expect(genesis.actionHistory).toEqual([])
  })

  it('maps each player row onto a GameState player', () => {
    const genesis = buildGenesisState(makeGame(), makePlayers())
    expect(genesis.players).toEqual([
      { id: 'p1', authUserId: 'auth_1', displayName: 'Alice', color: '#ef4444', eliminated: false, conceded: false },
      { id: 'p2', authUserId: 'auth_2', displayName: 'Bob', color: '#3b82f6', eliminated: false, conceded: false },
    ])
  })

  it('preserves seat order as turn order', () => {
    const genesis = buildGenesisState(makeGame(), makePlayers().reverse())
    expect(genesis.turnOrder).toEqual(['p2', 'p1'])
  })

  it("carries the game row's settings.gameOptions into GameState.options", () => {
    const genesis = buildGenesisState(makeGame({}, { gameOptions: { targetScore: 20, maxRounds: 3 } }), makePlayers())
    expect(genesis.options).toEqual({ targetScore: 20, maxRounds: 3 })
  })

  it("falls back to the game's default options when settings omit them", () => {
    const genesis = buildGenesisState(makeGame(), makePlayers())
    expect(genesis.options).toEqual(DEFAULT_GAME_OPTIONS)
  })

  // get-game-state (supabase/functions/) decides whether to redact off
  // GameState, not the games row, so this needs to land on genesis too.
  it("carries the game row's settings.hiddenInformationEnabled into GameState", () => {
    const genesis = buildGenesisState(makeGame({}, { ruleEnforcementEnabled: true, hiddenInformationEnabled: true }), makePlayers())
    expect(genesis.hiddenInformationEnabled).toBe(true)
  })

  it('undo mechanism: replaying genesis + history.slice(0, -1) reconstructs the pre-action state', () => {
    // Undo does exactly this: rebuild genesis (since it isn't stored) and
    // replay every logged action except the last one.
    const genesis = buildGenesisState(makeGame(), makePlayers())

    const pick: PickNumberAction = { type: 'PICK_NUMBER', playerId: 'p1', value: 3 }
    const step1 = applyAction(genesis, pick)
    if (!step1.ok) throw new Error(step1.error)
    expect((step1.state as GameState).game.picks.p1).toBe(3)

    const rebuiltGenesis = buildGenesisState(makeGame(), makePlayers())
    const undone = replayActions(rebuiltGenesis, step1.state.actionHistory.slice(0, -1))

    expect(undone).toEqual(genesis)
  })

  it("stamps the row's game_type and the newest rules version when settings pin none", () => {
    const genesis = buildGenesisState(makeGame(), makePlayers())
    expect(genesis.gameType).toBe('unique-pick')
    expect(genesis.rulesVersion).toBe(gameDefinition.rulesVersion)
  })

  it('normalizes stored options through the game', () => {
    const genesis = buildGenesisState(makeGame({}, { gameOptions: { targetScore: 999, maxRounds: 'lots' } }), makePlayers())
    expect(genesis.options).toEqual({ targetScore: 30, maxRounds: DEFAULT_GAME_OPTIONS.maxRounds })
  })

  it("rebuilds under the row's pinned settings.rulesVersion, even once a newer version is registered", () => {
    const copy = (rulesVersion: number): GameDefinition => ({ ...gameDefinition, id: 'test-genesis-versions', rulesVersion }) as GameDefinition
    registerGame(copy(1))
    registerGame(copy(2))
    const game = makeGame({ game_type: 'test-genesis-versions' }, { rulesVersion: 1 })

    expect(buildGenesisState(game, makePlayers()).rulesVersion).toBe(1)
    expect(buildGenesisState(makeGame({ game_type: 'test-genesis-versions' }), makePlayers()).rulesVersion).toBe(2)
  })

  it('throws for a game type this deployment has not registered', () => {
    expect(() => buildGenesisState(makeGame({ game_type: 'retired-game' }), makePlayers())).toThrow(/Unknown game type "retired-game"/)
  })
})
