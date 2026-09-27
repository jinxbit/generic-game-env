import { describe, expect, it } from 'vitest'
import { resolveHistory } from '../historyFold'
import type { GameState } from '../types'
import { applyRedoAction, applyUndoAction } from '../undoRedo'
import { act, newGame, pick } from './helpers'

function undo(genesis: GameState, state: GameState, playerId: string | null = 'p1'): GameState {
  const result = applyUndoAction(genesis, state, playerId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

function redo(genesis: GameState, state: GameState, playerId: string | null = 'p1'): GameState {
  const result = applyRedoAction(genesis, state, playerId)
  if (!result.ok) throw new Error(result.error)
  return result.state
}

/** Everything but the log, which undo/redo only ever append to. */
function gameplay(state: GameState): Omit<GameState, 'actionHistory'> {
  const { actionHistory, ...rest } = state
  void actionHistory
  return rest
}

describe('applyUndoAction', () => {
  it('refuses when there is nothing to undo', () => {
    const genesis = newGame()
    expect(applyUndoAction(genesis, genesis, 'p1')).toEqual({ ok: false, error: 'Nothing left to undo.' })
  })

  it('reverts the last entry, appending an UNDO_ACTION rather than removing anything', () => {
    const genesis = newGame({ players: 3 })
    const picked = pick(genesis, 'p1', 3)

    const undone = undo(genesis, picked)

    expect(gameplay(undone)).toEqual(gameplay(genesis))
    expect(undone.actionHistory).toHaveLength(2)
    expect(undone.actionHistory[0]).toBe(picked.actionHistory[0])
    expect(undone.actionHistory[1]).toMatchObject({ action: { type: 'UNDO_ACTION', playerId: 'p1' }, turn: 1 })
  })

  it('accepts a null playerId (nobody in particular acting)', () => {
    const genesis = newGame()
    const undone = undo(genesis, pick(genesis, 'p1', 3), null)
    expect(undone.actionHistory[1].action).toEqual({ type: 'UNDO_ACTION', playerId: null })
  })

  it('reopens a resolved round', () => {
    const genesis = newGame()
    const resolved = pick(pick(genesis, 'p1', 1), 'p2', 2)
    expect(resolved.turn).toBe(2)

    const undone = undo(genesis, resolved)

    expect(undone.turn).toBe(1)
    expect(undone.game.rounds).toEqual([])
    expect(undone.game.picks).toEqual({ p1: 1, p2: null })
    expect(undone.pendingPlayerIds).toEqual(['p2'])
    // Stamped with the turn the undo was submitted in.
    expect(undone.actionHistory[2].turn).toBe(2)
  })

  it('un-eliminates a player whose concede is undone', () => {
    const genesis = newGame({ players: 3 })
    const undone = undo(genesis, act(genesis, { type: 'CONCEDE', playerId: 'p2' }))
    expect(undone.players[1].eliminated).toBe(false)
    expect(undone.turnOrder).toEqual(['p1', 'p2', 'p3'])
  })

  it('reopens a finished game', () => {
    const genesis = newGame()
    const undone = undo(genesis, act(genesis, { type: 'CONCEDE', playerId: 'p2' }))
    expect(undone.status).toBe('active')
    expect(undone.winnerPlayerIds).toEqual([])
  })

  it('undoes one entry per call, in reverse order', () => {
    const genesis = newGame({ players: 3 })
    const one = pick(genesis, 'p1', 3)
    const two = pick(one, 'p2', 4)

    const back1 = undo(genesis, two)
    expect(gameplay(back1)).toEqual(gameplay(one))
    const back2 = undo(genesis, back1)
    expect(gameplay(back2)).toEqual(gameplay(genesis))
    expect(applyUndoAction(genesis, back2, 'p1').ok).toBe(false)
  })
})

describe('applyRedoAction', () => {
  it('refuses when there is nothing to redo', () => {
    const genesis = newGame()
    expect(applyRedoAction(genesis, pick(genesis, 'p1', 3), 'p1')).toEqual({ ok: false, error: 'Nothing left to redo.' })
  })

  it('re-applies the most recently undone entry', () => {
    const genesis = newGame({ players: 3 })
    const picked = pick(genesis, 'p1', 3)

    const redone = redo(genesis, undo(genesis, picked))

    expect(gameplay(redone)).toEqual(gameplay(picked))
    expect(redone.actionHistory.map((entry) => entry.action.type)).toEqual(['PICK_NUMBER', 'UNDO_ACTION', 'REDO_ACTION'])
    expect(resolveHistory(redone.actionHistory).canRedo).toBe(false)
  })

  it('has nothing to redo once a new action branches off an undo', () => {
    const genesis = newGame({ players: 3 })
    const branched = pick(undo(genesis, pick(genesis, 'p1', 3)), 'p1', 5)

    expect(branched.game.picks.p1).toBe(5)
    expect(applyRedoAction(genesis, branched, 'p1')).toEqual({ ok: false, error: 'Nothing left to redo.' })
  })
})
