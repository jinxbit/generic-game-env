// The game registry (../registry.ts) and how the engine uses it: every state
// runs under the rules of its own `gameType` at its own `rulesVersion`.
//
// The registry is module state shared by every test in this file (and the
// real Unique Pick registration from the test setup), so each test that
// registers something does so under its own throwaway id.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameActionBase } from '../actions'
import { applyAction } from '../applyAction'
import { createNewGame } from '../createGame'
import type { GameDefinition } from '../gameDefinition'
import { definitionFor, findGameDefinition, getGameDefinition, listGames, registerGame } from '../registry'
import { replayActions } from '../replay'
import { seatPlayers } from '../testing'
import type { GameState } from '../types'
import { act, game as uniquePick, newGame, pick, pickAction } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

// newGame() registers Unique Pick itself, in case this runs without the app's test setup.
newGame()

/** A copy of Unique Pick under another id — a distinct definition object with identical rules. */
function copyOf(id: string, rulesVersion = 1): GameDefinition {
  return { ...uniquePick, id, rulesVersion } as GameDefinition
}

// A second, trivial game: players take turns adding their `step` to a shared
// counter; first to push it to 3 or more wins.
interface CounterData {
  count: number
}
interface CounterOptions {
  step: number
}
interface AddAction extends GameActionBase {
  type: 'ADD'
}
type CounterState = GameState<CounterData, CounterOptions>

function counterGame(id: string): GameDefinition<CounterData, CounterOptions, AddAction> {
  const next = (state: CounterState, playerId: string) => {
    const order = state.turnOrder
    return order[(order.indexOf(playerId) + 1) % order.length]
  }
  return {
    id,
    rulesVersion: 1,
    title: 'Counter',
    turnLabel: 'Turn',
    minPlayers: 2,
    maxPlayers: 4,
    defaultOptions: { step: 1 },
    normalizeOptions: (raw) => ({ step: typeof (raw as CounterOptions | null)?.step === 'number' ? (raw as CounterOptions).step : 1 }),
    describeOptions: (options) => `Step ${options.step}`,
    setup: (lobby) => ({ ...lobby, status: 'active', game: { count: 0 }, turn: 1, phase: 'add', activePlayerId: lobby.turnOrder[0], pendingPlayerIds: [lobby.turnOrder[0]] }),
    applyAction(state, action) {
      if (action.type !== 'ADD') return { ok: false, error: `Unknown action: ${action.type}` }
      if (action.playerId !== state.activePlayerId) return { ok: false, error: 'Not your turn.' }
      const count = state.game.count + state.options.step
      if (count >= 3) return { ok: true, state: { ...state, game: { count }, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds: [action.playerId] } }
      const player = next(state, action.playerId)
      return { ok: true, state: { ...state, game: { count }, turn: state.turn + 1, activePlayerId: player, pendingPlayerIds: [player] } }
    },
    onPlayerEliminated: (state) => state,
    nextForcedAction: () => null,
    redactGame: (state) => state.game,
    isActionSecret: () => false,
    describeAction: () => ({ message: '{player} added.' }),
    describePhase: () => 'Adding',
  }
}

describe('registerGame', () => {
  it('is idempotent for the same definition object', () => {
    const definition = copyOf('test-idempotent')
    registerGame(definition)
    expect(() => registerGame(definition)).not.toThrow()
    expect(getGameDefinition('test-idempotent')).toBe(definition)
    expect(listGames().filter((d) => d.id === 'test-idempotent')).toHaveLength(1)
  })

  it('throws for a different definition under an id+version that is already taken', () => {
    registerGame(copyOf('test-conflict'))
    expect(() => registerGame(copyOf('test-conflict'))).toThrow('Game "test-conflict" rules version 1 is already registered.')
  })

  it('re-registering the real game object is harmless', () => {
    expect(() => registerGame(uniquePick)).not.toThrow()
    expect(getGameDefinition('unique-pick')).toBe(uniquePick)
  })

  it.each(['', 'Upper', 'has space', 'under_score', '-leading-dash', 'a'.repeat(65), 'émoji'])('rejects the id %j', (id) => {
    expect(() => registerGame(copyOf(id))).toThrow(/must be lowercase letters, digits and dashes/)
  })

  it.each(['t', '0-test', 'test-x-1', 't'.repeat(64)])('accepts the id %j', (id) => {
    expect(() => registerGame(copyOf(id))).not.toThrow()
    expect(getGameDefinition(id).id).toBe(id)
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects rulesVersion %s', (rulesVersion) => {
    expect(() => registerGame(copyOf('test-bad-version', rulesVersion))).toThrow('Game "test-bad-version" rulesVersion must be a positive integer.')
  })
})

describe('getGameDefinition / findGameDefinition', () => {
  const v1 = copyOf('test-versions', 1)
  const v3 = copyOf('test-versions', 3)
  const v2 = copyOf('test-versions', 2)
  // Registered out of order on purpose: "latest" is by version, not registration order.
  registerGame(v1)
  registerGame(v3)
  registerGame(v2)

  it('returns the newest version when none is asked for', () => {
    expect(getGameDefinition('test-versions')).toBe(v3)
  })

  it('returns exactly the version asked for', () => {
    expect(getGameDefinition('test-versions', 1)).toBe(v1)
    expect(getGameDefinition('test-versions', 2)).toBe(v2)
    expect(getGameDefinition('test-versions', 3)).toBe(v3)
  })

  it('throws for an unknown game', () => {
    expect(() => getGameDefinition('no-such-game')).toThrow('Unknown game type "no-such-game" — it isn\'t registered in this deployment.')
  })

  it('throws for a known game at an unregistered version', () => {
    expect(() => getGameDefinition('test-versions', 4)).toThrow('Game "test-versions" rules version 4 isn\'t registered in this deployment.')
  })

  it('findGameDefinition returns null instead of throwing', () => {
    expect(findGameDefinition('no-such-game')).toBeNull()
    expect(findGameDefinition('test-versions', 4)).toBeNull()
    expect(findGameDefinition('test-versions', 2)).toBe(v2)
    expect(findGameDefinition('test-versions')).toBe(v3)
  })

  it('definitionFor reads the state’s own gameType and rulesVersion', () => {
    expect(definitionFor({ gameType: 'test-versions', rulesVersion: 2 })).toBe(v2)
    expect(definitionFor(newGame())).toBe(uniquePick)
  })

  it('listGames holds the newest version of each game, once', () => {
    const games = listGames()
    expect(games.filter((d) => d.id === 'test-versions')).toEqual([v3])
    expect(games).toContain(uniquePick)
    expect(new Set(games.map((d) => d.id)).size).toBe(games.length)
  })
})

describe('several games side by side', () => {
  const counter = counterGame('test-counter')
  registerGame(counter)

  it('runs each state under its own game’s rules', () => {
    const counterApply = vi.spyOn(counter, 'applyAction')
    const pickApply = vi.spyOn(uniquePick, 'applyAction')

    const counterGenesis = createNewGame({ gameId: 'c1', gameType: 'test-counter', playMode: 'live', players: seatPlayers(2), options: { step: 2 } }) as CounterState
    const pickGenesis = newGame()

    const added = act(counterGenesis, { type: 'ADD', playerId: 'p1' })
    const picked = pick(pickGenesis, 'p1', 3)

    expect(added.gameType).toBe('test-counter')
    expect(added.game).toEqual({ count: 2 })
    expect(added.activePlayerId).toBe('p2')
    expect(picked.game.picks.p1).toBe(3)
    expect(counterApply).toHaveBeenCalledTimes(1)
    expect(pickApply).toHaveBeenCalledTimes(1)

    // Each game rejects the other's actions — they reach the right rules.
    expect(applyAction(counterGenesis, pickAction('p1', 3))).toEqual({ ok: false, error: 'Unknown action: PICK_NUMBER' })
    expect(applyAction(pickGenesis, { type: 'ADD', playerId: 'p1' } as AddAction).ok).toBe(false)
  })

  it('handles framework actions and replay for any game', () => {
    const genesis = createNewGame({ gameId: 'c2', gameType: 'test-counter', playMode: 'live', players: seatPlayers(3) }) as CounterState
    let state = act(genesis, { type: 'ADD', playerId: 'p1' })
    state = act(state, { type: 'CONCEDE', playerId: 'p3' })
    state = act(state, { type: 'ADD', playerId: 'p2' })
    state = act(state, { type: 'ADD', playerId: 'p1' })

    expect(state.status).toBe('completed')
    expect(state.winnerPlayerIds).toEqual(['p1'])
    expect(replayActions(genesis, state.actionHistory)).toEqual(state)
  })
})

describe('rules-version pinning', () => {
  it('stamps gameType and the newest rulesVersion on a new game', () => {
    registerGame(copyOf('test-stamp', 1))
    registerGame(copyOf('test-stamp', 2))
    const genesis = createNewGame({ gameId: 'g1', gameType: 'test-stamp', playMode: 'live', players: seatPlayers(2) })
    expect(genesis.gameType).toBe('test-stamp')
    expect(genesis.rulesVersion).toBe(2)

    const pinned = createNewGame({ gameId: 'g1', gameType: 'test-stamp', rulesVersion: 1, playMode: 'live', players: seatPlayers(2) })
    expect(pinned.rulesVersion).toBe(1)
  })

  it('keeps an existing game on the rules it started with after a newer version is registered', () => {
    registerGame(copyOf('test-pinned', 1))
    const genesis = createNewGame({ gameId: 'g1', gameType: 'test-pinned', playMode: 'live', players: seatPlayers(3) })
    const played = pick(pick(genesis as ReturnType<typeof newGame>, 'p1', 2), 'p2', 3)

    // v2 rejects every pick — if the old game reached it, it would fail.
    const v2: GameDefinition = { ...copyOf('test-pinned', 2), applyAction: () => ({ ok: false, error: 'v2 rules' }) }
    registerGame(v2)

    expect(played.rulesVersion).toBe(1)
    expect(replayActions(genesis, played.actionHistory)).toEqual(played)
    expect(pick(played, 'p3', 4).game.rounds).toHaveLength(1)

    const fresh = createNewGame({ gameId: 'g2', gameType: 'test-pinned', playMode: 'live', players: seatPlayers(3) })
    expect(fresh.rulesVersion).toBe(2)
    expect(applyAction(fresh, pickAction('p1', 2))).toEqual({ ok: false, error: 'v2 rules' })
  })

  it('fails loudly for a state whose rules version is no longer registered', () => {
    const orphan = { ...newGame(), rulesVersion: 99 }
    expect(() => applyAction(orphan, pickAction('p1', 2))).toThrow('Game "unique-pick" rules version 99 isn\'t registered in this deployment.')
  })
})
