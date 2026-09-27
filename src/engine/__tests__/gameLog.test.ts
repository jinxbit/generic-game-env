import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LoggedAction } from '../actions'
import { game } from '../game'
import { buildGameLog, buildGameLogFrom, PLAYER_PLACEHOLDER } from '../gameLog'
import type { GameState } from '../types'
import { redactStateForPlayer, toClientGameState } from '../redaction'
import { applyRedoAction, applyUndoAction } from '../undoRedo'
import { act, newGame, pick, pickAll } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

const messages = (genesis: GameState, state: GameState) => buildGameLog(genesis, state.actionHistory).map((event) => event.message)

function undo(genesis: GameState, state: GameState, playerId: string | null): GameState {
  const result = applyUndoAction(genesis, state, playerId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

describe('buildGameLog', () => {
  it('is empty for a fresh game', () => {
    expect(buildGameLog(newGame(), [])).toEqual([])
  })

  it('narrates game actions through the game, with the player placeholder and redacted form', () => {
    const genesis = newGame({ players: 3 })
    const [event] = buildGameLog(genesis, pick(genesis, 'p2', 4).actionHistory)

    expect(PLAYER_PLACEHOLDER).toBe('{player}')
    expect(event).toMatchObject({ playerId: 'p2', message: '{player} picked 4.', redactedMessage: '{player} picked a number.' })
  })

  it('narrates a changed pick differently', () => {
    const genesis = newGame({ players: 3 })
    const [, event] = buildGameLog(genesis, pick(pick(genesis, 'p1', 2), 'p1', 5).actionHistory)
    expect(event).toMatchObject({ message: '{player} changed their pick to 5.', redactedMessage: '{player} changed their pick.' })
  })

  it('notes the round reveal on the pick that resolves it', () => {
    const genesis = newGame()
    expect(messages(genesis, pickAll(genesis, { p1: 1, p2: 2 }))).toEqual(['{player} picked 1.', '{player} picked 2. Round 1 revealed.'])
  })

  it('mirrors each logged entry: turn, timestamp, entryIndex, and a sequential id', () => {
    const genesis = newGame()
    const state = pickAll(genesis, { p1: 1, p2: 2 })
    const events = buildGameLog(genesis, state.actionHistory)

    expect(events.map((event) => event.id)).toEqual(['evt_1', 'evt_2'])
    expect(events.map((event) => event.entryIndex)).toEqual([0, 1])
    expect(events.map((event) => event.turn)).toEqual([1, 1])
    expect(events.map((event) => event.timestamp)).toEqual(state.actionHistory.map((entry) => entry.timestamp))
  })

  it('adds a game-over line naming the winner', () => {
    const genesis = newGame({ options: { targetScore: 5, maxRounds: 10 } })
    const events = buildGameLog(genesis, pickAll(genesis, { p1: 5, p2: 1 }).actionHistory)

    expect(events.at(-1)).toMatchObject({ playerId: null, message: 'Game over — Alice wins.', entryIndex: 1 })
  })

  it('names every winner on a shared win', () => {
    const genesis = newGame({ options: { targetScore: 5, maxRounds: 1 } })
    expect(messages(genesis, pickAll(genesis, { p1: 3, p2: 3 })).at(-1)).toBe('Game over — Alice & Bob win.')
  })

  it('narrates a concede, and the game over it causes', () => {
    const genesis = newGame()
    expect(messages(genesis, act(genesis, { type: 'CONCEDE', playerId: 'p1' }))).toEqual(['{player} conceded.', 'Game over — Bob wins.'])
  })

  it('narrates undo and redo, with or without an acting player', () => {
    const genesis = newGame({ players: 3 })
    const undone = undo(genesis, pick(genesis, 'p1', 3), 'p1')
    const redone = applyRedoAction(genesis, undone, null)
    if (!redone.ok) throw new Error(redone.error)
    const undoneAgain = undo(genesis, redone.state, null)
    const redoneAgain = applyRedoAction(genesis, undoneAgain, 'p2')
    if (!redoneAgain.ok) throw new Error(redoneAgain.error)

    expect(messages(genesis, redoneAgain.state).slice(1)).toEqual([
      '{player} undid the last action.',
      'An action was redone.',
      'The last action was undone.',
      '{player} redid an action.',
    ])
  })

  it('narrates later entries against the post-undo state', () => {
    const genesis = newGame({ players: 3 })
    const state = pick(undo(genesis, pick(genesis, 'p1', 3), 'p1'), 'p1', 4)
    // After the undo p1 has no pick, so this is a fresh pick, not a change.
    expect(messages(genesis, state).at(-1)).toBe('{player} picked 4.')
  })

  it('narrates admin mode and tags every entry submitted while it was on', () => {
    const genesis = newGame({ players: 3 })
    let state = act(genesis, { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true })
    state = pick(state, 'p2', 3)
    state = act(state, { type: 'SET_ADMIN_MODE', playerId: null, enabled: false })
    state = pick(state, 'p3', 4)
    const events = buildGameLog(genesis, state.actionHistory)

    expect(events.map((event) => event.message)).toEqual(['{player} turned admin mode on.', '{player} picked 3.', 'Admin mode turned off.', '{player} picked 4.'])
    // SET_ADMIN_MODE itself is never tagged, turning it on or off.
    expect(events.map((event) => event.adminMode ?? false)).toEqual([false, true, false, false])
  })

  it('gives each forced follow-up its own line under the same entry', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation((state) =>
      state.game.picks.p1 != null && state.game.picks.p2 === null ? { type: 'PICK_NUMBER', playerId: 'p2', value: 2 } : null,
    )
    const genesis = newGame({ players: 3 })
    const events = buildGameLog(genesis, pick(genesis, 'p1', 5).actionHistory)

    expect(events.map((event) => [event.playerId, event.message, event.entryIndex])).toEqual([
      ['p1', '{player} picked 5.', 0],
      ['p2', '{player} picked 2.', 0],
    ])
  })
})

describe('buildGameLogFrom', () => {
  it('returns the replayed final state alongside the log', () => {
    const genesis = newGame({ players: 3 })
    const state = act(pickAll(genesis, { p1: 1, p2: 2, p3: 2 }), { type: 'CONCEDE', playerId: 'p3' })

    const result = buildGameLogFrom(genesis, state.actionHistory)

    expect(result.ok).toBe(true)
    expect(result.state).toEqual(state)
  })

  it('stops at an entry that fails to reapply rather than throwing', () => {
    const genesis = newGame()
    const history: LoggedAction[] = [
      ...pick(genesis, 'p1', 3).actionHistory,
      { action: { type: 'PICK_NUMBER', playerId: 'p2', value: 42 }, turn: 1, timestamp: '' },
      { action: { type: 'PICK_NUMBER', playerId: 'p2', value: 1 }, turn: 1, timestamp: '' },
    ]

    const result = buildGameLogFrom(genesis, history)

    expect(result.ok).toBe(false)
    expect(result.events).toHaveLength(1)
    expect(result.state.game.picks.p1).toBe(3)
  })
})

describe('buildGameLogFrom with an undone hidden entry', () => {
  it('narrates the placeholder and keeps going instead of stopping', () => {
    const genesis = newGame({ players: 3 })
    let state = pick(genesis, 'p1', 2)
    const undone = applyUndoAction(genesis, state, 'p2')
    if (!undone.ok) throw new Error(undone.error)
    state = act(undone.state, { type: 'PICK_NUMBER', playerId: 'p2', value: 4 })
    const view = toClientGameState(redactStateForPlayer(state, 'p3'))
    const built = buildGameLogFrom(genesis, view.actionHistory)
    expect(built.ok).toBe(true)
    expect(built.events.some((e) => e.message.includes('made a move'))).toBe(true)
  })
})
