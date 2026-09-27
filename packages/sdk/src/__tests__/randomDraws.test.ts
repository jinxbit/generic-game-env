import { describe, expect, it } from 'vitest'
import { applyAction } from '../applyAction'
import { createNewGame } from '../createGame'
import { redactStateForPlayer } from '../redaction'
import { replayActions } from '../replay'
import { seededSource } from '../random'
import { seatPlayers } from '../testing'
import { applyRedoAction, applyUndoAction, isUndoLockedByReveal } from '../undoRedo'
import type { GameState } from '../types'
import { CHANCE_GAME_TYPE, registerChanceGame, type ChanceData } from './chanceGame'
import { newGame, pick, pickAction, withoutTimestamps } from './helpers'

registerChanceGame()

function chanceGenesis(overrides: { lockRevealedInformationEnabled?: boolean; seed?: string } = {}): GameState<ChanceData> {
  return createNewGame({
    gameId: 'g1',
    gameType: CHANCE_GAME_TYPE,
    playMode: 'live',
    players: seatPlayers(6),
    lockRevealedInformationEnabled: overrides.lockRevealedInformationEnabled,
    setupRandom: seededSource(overrides.seed ?? 'seed', 'setup'),
  }) as GameState<ChanceData>
}

function rebuildGenesis(state: GameState): GameState {
  return createNewGame({ gameId: 'g1', gameType: CHANCE_GAME_TYPE, playMode: 'live', players: seatPlayers(6), lockRevealedInformationEnabled: state.lockRevealedInformationEnabled, setupRandom: state.setupRandom })
}

function move(state: GameState, playerId: string, value: number, seed = 'seed'): GameState<ChanceData> {
  const result = applyAction(state, pickAction(playerId, value), { random: seededSource(seed, 'move', state.actionHistory.length) })
  if (!result.ok) throw new Error(result.error)
  return result.state as GameState<ChanceData>
}

describe('random draws at setup', () => {
  it("records setup's draws on the state, and a rebuild from them is the same genesis", () => {
    const genesis = chanceGenesis()
    expect(genesis.setupRandom?.length).toBeGreaterThan(0)
    expect([...genesis.turnOrder].sort()).toEqual(seatPlayers(6).map((p) => p.id))
    expect(rebuildGenesis(genesis)).toEqual(genesis)
    expect(chanceGenesis({ seed: 'other' }).turnOrder).not.toEqual(genesis.turnOrder)
  })

  it('refuses to rebuild from numbers that are not the ones setup drew', () => {
    const genesis = chanceGenesis()
    expect(() => rebuildGenesis({ ...genesis, setupRandom: [] })).toThrow()
    expect(() => rebuildGenesis({ ...genesis, setupRandom: [...genesis.setupRandom!, 7] })).toThrow(/fewer random numbers/)
  })

  it("adds no setupRandom to a game whose setup draws nothing", () => {
    expect('setupRandom' in newGame()).toBe(false)
  })
})

describe('random draws in a move', () => {
  it('records the numbers on the log entry, and replay reproduces them without any source', () => {
    const genesis = chanceGenesis()
    let state = move(genesis, 'p1', 3)
    state = move(state, 'p2', 4)
    expect(state.actionHistory[0].random).toHaveLength(1)
    expect(state.game.bonuses).toHaveLength(2)

    expect(withoutTimestamps(replayActions(rebuildGenesis(state), state.actionHistory))).toEqual(withoutTimestamps(state))
  })

  it('rejects a move that draws when no source was given — never rolls on its own', () => {
    const result = applyAction(chanceGenesis(), pickAction('p1', 3))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/chance/)
  })

  it('refuses a replay whose recorded numbers were tampered with in count', () => {
    const state = move(chanceGenesis(), 'p1', 3)
    const tampered = [{ ...state.actionHistory[0], random: [] }]
    expect(() => replayActions(rebuildGenesis(state), tampered)).toThrow(/Replay failed/)
  })

  it('logs no random field for a move that draws nothing', () => {
    expect('random' in pick(newGame(), 'p1', 3).actionHistory[0]).toBe(false)
  })

  it('undo and redo replay the recorded numbers', () => {
    const genesis = chanceGenesis()
    const state = move(move(genesis, 'p1', 3), 'p2', 4)
    const undone = applyUndoAction(genesis, state, null)
    if (!undone.ok) throw new Error(undone.error)
    expect((undone.state as GameState<ChanceData>).game.bonuses).toEqual(state.game.bonuses.slice(0, 1))
    const redone = applyRedoAction(genesis, undone.state, null)
    if (!redone.ok) throw new Error(redone.error)
    expect((redone.state as GameState<ChanceData>).game.bonuses).toEqual(state.game.bonuses)
  })
})

describe('redaction of random draws', () => {
  it('withholds the numbers of an entry that is secret from the viewer, along with its action', () => {
    const state = move({ ...chanceGenesis(), hiddenInformationEnabled: true }, 'p1', 3)
    const forBob = redactStateForPlayer(state, 'p2')
    expect(forBob.actionHistory[0].action.type).toBe('HIDDEN_ACTION')
    expect('random' in forBob.actionHistory[0]).toBe(false)
  })

  it('withholds the numbers from every redacted viewer, even on an entry they may see — they could recompute what redaction hides', () => {
    const state = move({ ...chanceGenesis(), hiddenInformationEnabled: true }, 'p1', 3)
    const forAlice = redactStateForPlayer(state, 'p1')
    expect(forAlice.actionHistory[0].action).toEqual(state.actionHistory[0].action)
    expect('random' in forAlice.actionHistory[0]).toBe(false)
  })
})

describe('redaction of setup draws', () => {
  it("never sends a redacted viewer the numbers setup drew — setup may deal secrets", () => {
    const genesis = { ...chanceGenesis(), hiddenInformationEnabled: true }
    expect(genesis.setupRandom?.length).toBeGreaterThan(0)
    expect('setupRandom' in redactStateForPlayer(genesis, 'p1')).toBe(false)
  })
})

describe('isUndoLockedByReveal', () => {
  it('is never locked when the game was created without the option', () => {
    let state: GameState = newGame()
    state = pick(pick(state as never, 'p1', 3), 'p2', 4)
    expect(isUndoLockedByReveal(newGame(), state)).toBe(false)
  })

  it('locks undoing the move that revealed hidden information, but not a still-secret one', () => {
    const genesis = { ...newGame({ players: 3 }), lockRevealedInformationEnabled: true }
    const oneIn = pick(genesis, 'p1', 3)
    // p1's pick is still secret from everyone else: undoing it reveals nothing.
    expect(isUndoLockedByReveal(genesis, oneIn)).toBe(false)
    const twoIn = pick(oneIn, 'p2', 4)
    expect(isUndoLockedByReveal(genesis, twoIn)).toBe(false)
    // p3's pick resolves the round and reveals every pick; undoing it would
    // put p1's and p2's back under wraps.
    const resolved = pick(twoIn, 'p3', 5)
    expect(isUndoLockedByReveal(genesis, resolved)).toBe(true)
  })

  it('locks undoing a move whose random draws a player has seen', () => {
    const genesis = chanceGenesis({ lockRevealedInformationEnabled: true })
    // Chance Pick's bonus roll lands in p1's own pick entry, which p1 sees.
    expect(isUndoLockedByReveal(genesis, move(genesis, 'p1', 3))).toBe(true)
    expect(isUndoLockedByReveal(chanceGenesis(), move(chanceGenesis(), 'p1', 3))).toBe(false)
  })

  it('is not locked with nothing to undo', () => {
    const genesis = chanceGenesis({ lockRevealedInformationEnabled: true })
    expect(isUndoLockedByReveal(genesis, genesis)).toBe(false)
  })
})
