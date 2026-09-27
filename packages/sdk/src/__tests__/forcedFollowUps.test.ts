// Invariant 4: one submitted action → exactly one actionHistory entry. Any
// forced single-option follow-up (GameDefinition.nextForcedAction) is
// dispatched inside the same applyAction call, converging to a fixed point,
// and folded into the triggering entry. The example game has no forced
// moves, so these tests stub the hook on the bound game object.

import type { GameAction } from '@game-platform/unique-pick/rules'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAction, applyActionWithSteps } from '../applyAction'
import { replayActions } from '../replay'
import { applyUndoAction } from '../undoRedo'
import { act, game, newGame, pick, pickAction, type GameState } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Whoever is still owed a round-1 pick is forced to pick their seat number, once p1 has picked. */
function forceEveryoneAfterP1(state: GameState): GameAction | null {
  if (state.turn !== 1 || state.game.picks.p1 == null) return null
  const next = state.pendingPlayerIds[0]
  return next ? { type: 'PICK_NUMBER', playerId: next, value: Number(next.slice(1)) } : null
}

/** Only p2 is forced, and only once p1 has picked. */
function forceP2AfterP1(state: GameState): GameAction | null {
  return state.turn === 1 && state.game.picks.p1 != null && state.game.picks.p2 === null ? { type: 'PICK_NUMBER', playerId: 'p2', value: 2 } : null
}

describe('forced follow-up folding', () => {
  it('folds a forced follow-up into the triggering action’s single log entry', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation(forceP2AfterP1)

    const state = pick(newGame({ players: 3 }), 'p1', 5)

    expect(state.game.picks).toEqual({ p1: 5, p2: 2, p3: null })
    expect(state.pendingPlayerIds).toEqual(['p3'])
    expect(state.actionHistory).toHaveLength(1)
    expect(state.actionHistory[0].action).toEqual({ type: 'PICK_NUMBER', playerId: 'p1', value: 5 })
  })

  it('keeps dispatching until nothing is forced, even through a round resolving', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation(forceEveryoneAfterP1)

    const state = pick(newGame({ players: 3 }), 'p1', 5)

    expect(state.game.rounds).toHaveLength(1)
    expect(state.game.rounds[0].picks).toEqual({ p1: 5, p2: 2, p3: 3 })
    expect(state.turn).toBe(2)
    expect(state.actionHistory).toHaveLength(1)
    // Logged against the round the cascade resolved, not the one it opened.
    expect(state.actionHistory[0].turn).toBe(1)
  })

  it('reports every folded step, in order, through applyActionWithSteps', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation(forceEveryoneAfterP1)

    const result = applyActionWithSteps(newGame({ players: 3 }), pickAction('p1', 5))
    if (!result.ok) throw new Error(result.error)

    expect(result.steps.map((step) => step.action)).toEqual([
      { type: 'PICK_NUMBER', playerId: 'p1', value: 5 },
      { type: 'PICK_NUMBER', playerId: 'p2', value: 2 },
      { type: 'PICK_NUMBER', playerId: 'p3', value: 3 },
    ])
    for (let i = 1; i < result.steps.length; i++) expect(result.steps[i].before).toBe(result.steps[i - 1].after)
  })

  it('replays the single entry to the identical state, cascade and all', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation(forceEveryoneAfterP1)
    const genesis = newGame({ players: 3 })

    const state = pick(genesis, 'p1', 5)

    expect(replayActions(genesis, state.actionHistory)).toEqual(state)
  })

  it('reverts the whole cascade with one undo', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation(forceEveryoneAfterP1)
    const genesis = newGame({ players: 3 })

    const undone = applyUndoAction(genesis, pick(genesis, 'p1', 5), 'p1')
    if (!undone.ok) throw new Error(undone.error)

    expect({ ...undone.state, actionHistory: [] }).toEqual(genesis)
  })

  it('runs after framework actions too', () => {
    vi.spyOn(game, 'nextForcedAction').mockImplementation(forceP2AfterP1)
    const picked = { ...newGame({ players: 3 }), game: { picks: { p1: 1, p2: null, p3: null }, scores: { p1: 0, p2: 0, p3: 0 }, rounds: [] } }

    const state = act(picked, { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true })

    expect(state.game.picks.p2).toBe(2)
    expect(state.actionHistory).toHaveLength(1)
  })

  it('never asks for a forced follow-up once the game is over', () => {
    const spy = vi.spyOn(game, 'nextForcedAction').mockReturnValue({ type: 'PICK_NUMBER', playerId: 'p1', value: 1 })

    const state = act(newGame(), { type: 'CONCEDE', playerId: 'p2' })

    expect(state.status).toBe('completed')
    expect(spy).not.toHaveBeenCalled()
  })

  it('stops (defensively) at a forced action the game rejects, keeping what came before', () => {
    vi.spyOn(game, 'nextForcedAction').mockReturnValue({ type: 'PICK_NUMBER', playerId: 'p2', value: 99 })

    const state = pick(newGame({ players: 3 }), 'p1', 5)

    expect(state.game.picks).toEqual({ p1: 5, p2: null, p3: null })
    expect(state.actionHistory).toHaveLength(1)
  })

  it('turns a nextForcedAction that never converges into an error instead of a hang', () => {
    // p1 flips their pick between 1 and 2 forever — each step legal, none a fixed point.
    const spy = vi
      .spyOn(game, 'nextForcedAction')
      .mockImplementation((state) => ({ type: 'PICK_NUMBER', playerId: 'p1', value: state.game.picks.p1 === 1 ? 2 : 1 }))

    const result = applyAction(newGame({ players: 3 }), pickAction('p2', 5))

    expect(result).toEqual({ ok: false, error: 'Forced follow-up actions did not converge.' })
    expect(spy.mock.calls.length).toBeGreaterThan(1000)
  })
})
