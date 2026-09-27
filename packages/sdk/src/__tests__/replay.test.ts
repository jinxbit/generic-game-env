import { describe, expect, it } from 'vitest'
import type { LoggedAction } from '../actions'
import { extendReplay, replayActions, replayToBase } from '../replay'
import { applyUndoAction } from '../undoRedo'
import { act, gameData, newGame, pick, pickAction, pickAll, type GameState } from './helpers'

/** Two rounds and a concede in a 3-player game. */
function played(genesis: GameState): GameState {
  let state = pickAll(genesis, { p1: 1, p2: 2, p3: 2 })
  state = act(state, { type: 'CONCEDE', playerId: 'p3' })
  return pickAll(state, { p1: 4, p2: 5 })
}

/** Log entries as they'd arrive over the wire: someone else's clock, not ours. */
function fromWire(entries: LoggedAction[]): LoggedAction[] {
  return entries.map((entry, i) => ({ ...entry, timestamp: `2020-01-01T00:00:0${i}.000Z` }))
}

describe('replayActions', () => {
  it('reconstructs the exact state from genesis and the log', () => {
    const genesis = newGame({ players: 3 })
    const state = played(genesis)
    expect(replayActions(genesis, state.actionHistory)).toEqual(state)
  })

  it('is deterministic — the same inputs always replay to the same state', () => {
    const genesis = newGame({ players: 3 })
    const { actionHistory } = played(genesis)
    expect(replayActions(genesis, actionHistory)).toEqual(replayActions(newGame({ players: 3 }), actionHistory))
  })

  it('returns exactly the raw history passed in, undo entries and wire timestamps included', () => {
    const genesis = newGame({ players: 3 })
    const undone = applyUndoAction(genesis, pick(genesis, 'p1', 3), 'p1')
    if (!undone.ok) throw new Error(undone.error)
    const history = fromWire(undone.state.actionHistory)

    expect(replayActions(genesis, history).actionHistory).toBe(history)
  })

  it('replays only the entries resolveHistory keeps in effect', () => {
    const genesis = newGame({ players: 3 })
    const undone = applyUndoAction(genesis, pick(genesis, 'p1', 3), 'p1')
    if (!undone.ok) throw new Error(undone.error)

    expect(gameData(replayActions(genesis, undone.state.actionHistory)).picks.p1).toBeNull()
  })

  it('throws on an entry the rules reject — a genesis mismatch or a corrupt log', () => {
    const genesis = newGame()
    const corrupt: LoggedAction[] = [{ action: pickAction('p1', 9), turn: 1, timestamp: '' }]
    expect(() => replayActions(genesis, corrupt)).toThrow(/^Replay failed at action .*PICK_NUMBER/)
  })
})

describe('extendReplay', () => {
  it('advances a replayed base incrementally to the same state a full replay reaches', () => {
    const genesis = newGame({ players: 3 })
    const full = fromWire(played(genesis).actionHistory)
    const base = replayActions(genesis, full.slice(0, 2))

    const extended = extendReplay(genesis, base, full.slice(2))

    expect(extended).toEqual(replayActions(genesis, full))
  })

  it("keeps the wire's entries verbatim rather than re-stamping them", () => {
    const genesis = newGame({ players: 3 })
    const full = fromWire(played(genesis).actionHistory)
    const base = replayActions(genesis, full.slice(0, 2))

    expect(extendReplay(genesis, base, full.slice(2)).actionHistory).toEqual(full)
  })

  it('builds on the base it is given on the incremental path', () => {
    const genesis = newGame({ players: 3 })
    const base = { ...genesis, options: { ...genesis.options, maxRounds: 1 } }
    const append = fromWire(pickAll(genesis, { p1: 1, p2: 2, p3: 3 }).actionHistory)

    // With the base's maxRounds of 1, the round that resolves is the last.
    expect(extendReplay(genesis, base, append).status).toBe('completed')
  })

  it('rebuilds from genesis instead when the append carries an undo or redo', () => {
    const genesis = newGame({ players: 3 })
    const picked = pick(genesis, 'p1', 3)
    const undone = applyUndoAction(genesis, picked, 'p1')
    if (!undone.ok) throw new Error(undone.error)
    const full = fromWire(undone.state.actionHistory)
    // A base the rebuild must ignore: only its log is used.
    const base = { ...replayActions(genesis, full.slice(0, 1)), turn: 99 }

    const extended = extendReplay(genesis, base, full.slice(1))

    expect(extended).toEqual(replayActions(genesis, full))
    expect(extended.turn).toBe(1)
    expect(gameData(extended).picks.p1).toBeNull()
  })

  it('throws on an append entry the rules reject', () => {
    const genesis = newGame()
    const bad: LoggedAction[] = [{ action: pickAction('p1', 0), turn: 1, timestamp: '' }]
    expect(() => extendReplay(genesis, genesis, bad)).toThrow(/^Delta replay failed at/)
  })
})

describe('replayToBase', () => {
  it("rebuilds the clean state behind a view from the view's own log, discarding anything laid over it", () => {
    const genesis = newGame({ players: 3 })
    const state = pick(genesis, 'p1', 3)
    const overlaid = { ...state, pendingPlayerIds: ['p3'], game: { ...state.game, picks: { ...state.game.picks, p2: null } } }

    expect(replayToBase(genesis, overlaid)).toEqual(state)
  })

  it("keeps the view's own log entries", () => {
    const genesis = newGame({ players: 3 })
    const view = { ...pick(genesis, 'p1', 3) }
    view.actionHistory = fromWire(view.actionHistory)

    expect(replayToBase(genesis, view).actionHistory).toBe(view.actionHistory)
  })
})
