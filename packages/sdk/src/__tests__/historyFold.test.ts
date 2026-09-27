import { describe, expect, it } from 'vitest'
import type { Action, LoggedAction } from '../actions'
import { redoableTail, resolveHistory } from '../historyFold'
import { pickAction } from './helpers'

// Hand-built logs: resolveHistory is pure bookkeeping over entries and never
// applies them, so the actions needn't be legal in sequence.
const entry = (action: Action): LoggedAction => ({ action, turn: 1, timestamp: '' })
const pickBy = (playerId: string, value: number) => entry(pickAction(playerId, value))
const undo = () => entry({ type: 'UNDO_ACTION', playerId: 'p1' })
const redo = () => entry({ type: 'REDO_ACTION', playerId: 'p1' })
const admin = (enabled: boolean) => entry({ type: 'SET_ADMIN_MODE', playerId: 'p1', enabled })

describe('resolveHistory', () => {
  it('has nothing to undo or redo in an empty log', () => {
    expect(resolveHistory([])).toEqual({ effective: [], canUndo: false, canRedo: false })
  })

  it('keeps every entry of a log with no undo/redo in it', () => {
    const a = pickBy('p1', 1)
    const b = pickBy('p2', 2)
    expect(resolveHistory([a, b])).toEqual({ effective: [a, b], canUndo: true, canRedo: false })
  })

  it('moves the pointer back one entry per UNDO_ACTION', () => {
    const a = pickBy('p1', 1)
    const b = pickBy('p2', 2)
    expect(resolveHistory([a, b, undo()])).toEqual({ effective: [a], canUndo: true, canRedo: true })
    expect(resolveHistory([a, b, undo(), undo()])).toEqual({ effective: [], canUndo: false, canRedo: true })
  })

  it('never moves the pointer below zero', () => {
    const a = pickBy('p1', 1)
    expect(resolveHistory([a, undo(), undo(), undo(), redo()]).effective).toEqual([a])
  })

  it('moves the pointer forward one entry per REDO_ACTION, never past the tip', () => {
    const a = pickBy('p1', 1)
    const b = pickBy('p2', 2)
    expect(resolveHistory([a, b, undo(), undo(), redo()])).toEqual({ effective: [a], canUndo: true, canRedo: true })
    expect(resolveHistory([a, b, undo(), redo(), redo(), redo()])).toEqual({ effective: [a, b], canUndo: true, canRedo: false })
  })

  it('branches when a new action lands behind the tip, abandoning the un-redone tail', () => {
    const a = pickBy('p1', 1)
    const b = pickBy('p2', 2)
    const c = pickBy('p2', 3)
    const history = [a, b, undo(), c]

    expect(resolveHistory(history)).toEqual({ effective: [a, c], canUndo: true, canRedo: false })
    // A later redo has nothing to bring back — b is out of reach for good.
    expect(resolveHistory([...history, redo()]).effective).toEqual([a, c])
    // ...but it's never deleted from the log itself.
    expect(history).toContain(b)
  })

  it('keeps SET_ADMIN_MODE in effect unconditionally, in log order', () => {
    const a = pickBy('p1', 1)
    const s = admin(true)
    const b = pickBy('p2', 2)

    expect(resolveHistory([a, s, b, undo()]).effective).toEqual([a, s])
    expect(resolveHistory([a, s, b, undo(), undo()]).effective).toEqual([s])
  })

  it('never lets SET_ADMIN_MODE move the pointer or count as undoable', () => {
    const a = pickBy('p1', 1)
    const s = admin(true)

    // The undo skips past s and reverts a.
    expect(resolveHistory([a, s, undo()])).toEqual({ effective: [s], canUndo: false, canRedo: true })
    expect(resolveHistory([s]).canUndo).toBe(false)
    // An admin-mode flip behind the tip doesn't branch away the redo tail.
    expect(resolveHistory([a, undo(), admin(false)])).toEqual({ effective: [admin(false)], canUndo: false, canRedo: true })
  })
})

describe('redoableTail', () => {
  it('is empty with nothing undone', () => {
    expect(redoableTail([pickBy('p1', 1)])).toEqual([])
  })

  it('lists the undone gameplay entries a fresh action would push out of reach, oldest first', () => {
    const a = pickBy('p1', 1)
    const b = pickBy('p2', 2)
    expect(redoableTail([a, b, undo()])).toEqual([b])
    expect(redoableTail([a, b, undo(), undo()])).toEqual([a, b])
    expect(redoableTail([a, b, undo(), undo(), redo()])).toEqual([b])
  })

  it('is empty again once a branch has abandoned the tail', () => {
    expect(redoableTail([pickBy('p1', 1), undo(), pickBy('p1', 2)])).toEqual([])
  })

  it('never contains a SET_ADMIN_MODE entry', () => {
    const a = pickBy('p1', 1)
    expect(redoableTail([a, admin(true), undo()])).toEqual([a])
  })
})
