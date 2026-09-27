import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAction, applyActionWithSteps } from '../applyAction'
import { act, asGame, game, newGame, pick, pickAction } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('applyAction', () => {
  describe('dispatch', () => {
    it("hands a game action to the game's own rules", () => {
      const spy = vi.spyOn(game, 'applyAction')
      const genesis = newGame()

      pick(genesis, 'p1', 3)

      expect(spy).toHaveBeenCalledWith(genesis, { type: 'PICK_NUMBER', playerId: 'p1', value: 3 })
    })

    it('handles framework actions itself, never calling into the game', () => {
      const spy = vi.spyOn(game, 'applyAction')

      act(newGame(), { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true })

      expect(spy).not.toHaveBeenCalled()
    })

    it("passes a game's rejection straight through", () => {
      const result = applyAction(newGame(), pickAction('p1', 99))
      expect(result).toEqual({ ok: false, error: 'Pick a whole number from 1 to 5.' })
    })

    it('rejects UNDO_ACTION/REDO_ACTION — those go through applyUndoAction/applyRedoAction', () => {
      for (const type of ['UNDO_ACTION', 'REDO_ACTION'] as const) {
        const result = applyAction(pick(newGame(), 'p1', 3), { type, playerId: 'p1' })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error).toMatch(/applyUndoAction\/applyRedoAction/)
      }
    })
  })

  describe('status guard', () => {
    it('rejects a game action once the game is no longer active, without asking the game', () => {
      const completed = act(newGame(), { type: 'CONCEDE', playerId: 'p2' })
      const spy = vi.spyOn(game, 'applyAction')

      const result = applyAction(completed, pickAction('p1', 3))

      expect(result).toEqual({ ok: false, error: 'Game is not active (status: completed)' })
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('the log', () => {
    it('appends exactly one entry per accepted action', () => {
      const genesis = newGame({ players: 3 })
      const once = pick(genesis, 'p1', 3)
      const twice = pick(once, 'p2', 4)

      expect(once.actionHistory).toHaveLength(1)
      expect(twice.actionHistory).toHaveLength(2)
      expect(twice.actionHistory[0]).toBe(once.actionHistory[0])
      expect(twice.actionHistory[1].action).toEqual({ type: 'PICK_NUMBER', playerId: 'p2', value: 4 })
    })

    it('appends nothing for a rejected action', () => {
      const state = pick(newGame({ players: 3 }), 'p1', 3)
      const result = applyAction(state, pickAction('p1', 3))
      expect(result.ok).toBe(false)
      expect(state.actionHistory).toHaveLength(1)
    })

    it('stamps each entry with an ISO timestamp', () => {
      const [entry] = pick(newGame(), 'p1', 3).actionHistory
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)
    })

    it('stamps the turn from the state before dispatch, not the one the action advanced into', () => {
      const resolved = pick(pick(newGame(), 'p1', 1), 'p2', 2)

      expect(resolved.turn).toBe(2)
      expect(resolved.actionHistory.map((entry) => entry.turn)).toEqual([1, 1])
    })

    it('never mutates its input', () => {
      const genesis = newGame({ players: 3 })
      const snapshot = structuredClone(genesis)

      pick(genesis, 'p1', 3)
      act(genesis, { type: 'CONCEDE', playerId: 'p2' })
      act(genesis, { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true })

      expect(genesis).toEqual(snapshot)
    })
  })

  describe('viaAdminMode stamping', () => {
    it('leaves the flag absent (not false) while admin mode is off', () => {
      const [entry] = pick(newGame(), 'p1', 3).actionHistory
      expect('viaAdminMode' in entry).toBe(false)
    })

    it('stamps every action submitted while admin mode is on', () => {
      const on = act(newGame({ players: 3 }), { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true })
      const picked = pick(on, 'p2', 3)
      const conceded = act(picked, { type: 'CONCEDE', playerId: 'p3' })

      expect(conceded.actionHistory.slice(1).map((entry) => entry.viaAdminMode)).toEqual([true, true])
    })

    it('never stamps SET_ADMIN_MODE itself, turning it on or off', () => {
      const on = act(newGame(), { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: true })
      const off = act(on, { type: 'SET_ADMIN_MODE', playerId: 'p1', enabled: false })

      expect(off.actionHistory.map((entry) => 'viaAdminMode' in entry)).toEqual([false, false])
    })
  })

  describe('applyActionWithSteps', () => {
    it('reports the one step behind an action with no forced follow-ups, with its before/after pair', () => {
      const genesis = newGame()
      const result = applyActionWithSteps(genesis, pickAction('p1', 3))
      if (!result.ok) throw new Error(result.error)

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].before).toBe(genesis)
      expect(asGame(result.steps[0].after).game.picks.p1).toBe(3)
      // The step's `after` is pre-logging; the returned state carries the entry.
      expect(result.steps[0].after.actionHistory).toHaveLength(0)
      expect(result.state.actionHistory).toHaveLength(1)
    })
  })
})
