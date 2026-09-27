import { describe, expect, it } from 'vitest'
import { applyAction } from '../applyAction'
import { resolveHistory } from '../historyFold'
import { applyUndoAction } from '../undoRedo'
import { act, newGame, pick } from './helpers'

const on = { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true } as const
const off = { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: false } as const

describe('SET_ADMIN_MODE', () => {
  it('starts off at genesis', () => {
    expect(newGame().adminModeActive).toBe(false)
  })

  it('toggles adminModeActive on and back off, logging each flip', () => {
    const turnedOn = act(newGame(), on)
    expect(turnedOn.adminModeActive).toBe(true)

    const turnedOff = act(turnedOn, off)
    expect(turnedOff.adminModeActive).toBe(false)
    expect(turnedOff.actionHistory.map((entry) => entry.action)).toEqual([on, off])
  })

  it('touches nothing else', () => {
    const genesis = newGame()
    expect(act(genesis, on)).toEqual({ ...genesis, adminModeActive: true, actionHistory: [expect.objectContaining({ action: on })] })
  })

  it('rejects a redundant flip', () => {
    expect(applyAction(newGame(), off)).toEqual({ ok: false, error: 'Admin mode is already off.' })
    expect(applyAction(act(newGame(), on), on)).toEqual({ ok: false, error: 'Admin mode is already on.' })
  })

  it('treats an absent flag as off', () => {
    const { adminModeActive, ...legacy } = newGame()
    void adminModeActive
    expect(applyAction(legacy, off).ok).toBe(false)
    expect(applyAction(legacy, on).ok).toBe(true)
  })

  it('is allowed after the game has ended', () => {
    const completed = act(newGame(), { type: 'CONCEDE', playerId: 'p2' })
    expect(act(completed, on).adminModeActive).toBe(true)
  })

  it('is not reverted by a bare undo — the undo reaches the gameplay action underneath', () => {
    const genesis = newGame({ players: 3 })
    const state = act(pick(genesis, 'p1', 3), on)

    const undone = applyUndoAction(genesis, state, 'p1')
    if (!undone.ok) throw new Error(undone.error)

    expect(undone.state.adminModeActive).toBe(true)
    expect(undone.state.game.picks.p1).toBeNull()
  })

  it('gives undo nothing to revert on its own', () => {
    const genesis = newGame()
    const state = act(genesis, on)

    expect(resolveHistory(state.actionHistory).canUndo).toBe(false)
    expect(applyUndoAction(genesis, state, 'p1')).toEqual({ ok: false, error: 'Nothing left to undo.' })
  })
})
