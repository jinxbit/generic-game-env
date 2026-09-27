import { describe, expect, it } from 'vitest'
import { applyActionWithSteps } from '../applyAction'
import { createNewGame } from '../createGame'
import { seededSource } from '../random'
import { applyStatePatch, diffState } from '../statePatch'
import { seatPlayers } from '../testing'
import { applyRedoAction, applyUndoAction } from '../undoRedo'
import { applyViewerEntries, buildGameLogFromViewerEntries, flippedSince, recordEntryViews, viewerEntry, viewersOf, viewOf, type PlayerView, type ViewerLogEntry } from '../viewLog'
import type { Action } from '../actions'
import type { GameState } from '../types'
import { HAND_GAME_TYPE, nextHandAction, registerHandGame, type HandState } from './handGame'
import { newGame, pickAction } from './helpers'

registerHandGame()

describe('statePatch', () => {
  const cases: [unknown, unknown][] = [
    [{ a: 1, b: [1, 2, 3], c: { d: 'x' } }, { a: 2, b: [1, 2], c: { d: 'x', e: null } }],
    [{ a: [{ x: 1 }, { x: 2 }] }, { a: [{ x: 1 }, { x: 3 }, { x: 4 }] }],
    [{ gone: true, kept: 1 }, { kept: 1 }],
    [[1, 2], { not: 'an array' }],
    [null, { a: 1 }],
    [{ same: [1, { deep: true }] }, { same: [1, { deep: true }] }],
  ]
  it('round-trips: applying the diff of two values gives the second', () => {
    for (const [previous, current] of cases) expect(applyStatePatch(previous, diffState(previous, current))).toEqual(current)
  })
  it('is null for no change, and never larger than replacing the value outright', () => {
    expect(diffState({ a: [1] }, { a: [1] })).toBeNull()
    for (const [previous, current] of cases) {
      const patch = diffState(previous, current)
      if (patch) expect(JSON.stringify(patch).length).toBeLessThanOrEqual(JSON.stringify({ v: current }).length)
    }
  })
})

/** A client: its view, and its log in its own form, kept up to date from each write the way protocol 3 does. */
class Client {
  entries: ViewerLogEntry[] = []
  readonly viewer: string | null
  view: PlayerView
  constructor(viewer: string | null, view: PlayerView) {
    this.viewer = viewer
    this.view = view
  }
  catchUp(state: GameState): void {
    const from = this.entries.length
    for (const index of flippedSince(state.actionHistory, from, this.viewer)) {
      const { action, lines } = viewerEntry(state.actionHistory[index], state, this.viewer, false)
      this.entries[index] = { ...this.entries[index], action, lines }
    }
    const fresh = state.actionHistory.slice(from).map((entry) => viewerEntry(entry, state, this.viewer))
    this.view = applyViewerEntries(this.view, fresh)
    this.entries.push(...fresh)
  }
}

/** Plays a whole game, recording views on every write as the server does, with an undo and a redo mixed in; checks every viewer after every write. */
function playChecked(genesis: GameState, next: (state: GameState) => Action | null, undoAt: number[] = []) {
  const clients = viewersOf(genesis).map((viewer) => new Client(viewer, viewOf(genesis, viewer)))
  let state = genesis
  const check = () => {
    for (const client of clients) {
      client.catchUp(state)
      // The client's view is exactly the server's view of the true state...
      expect(client.view).toEqual(viewOf(state, client.viewer))
      // ...and its log is exactly what a fresh read would hand it.
      const withoutPatch = (entry: ViewerLogEntry) => ({ ...entry, patch: undefined })
      expect(client.entries.map(withoutPatch)).toEqual(state.actionHistory.map((entry) => withoutPatch(viewerEntry(entry, state, client.viewer))))
    }
  }
  for (let step = 0; ; step++) {
    if (undoAt.includes(step)) {
      const undone = applyUndoAction(genesis, state, null)
      if (!undone.ok) throw new Error(undone.error)
      state = recordEntryViews(state, undone.state)
      check()
      const redone = applyRedoAction(genesis, state, null)
      if (!redone.ok) throw new Error(redone.error)
      state = recordEntryViews(state, redone.state)
      check()
    }
    const action = next(state)
    if (!action) break
    const result = applyActionWithSteps(state, action, { random: seededSource('seed', 'move', state.actionHistory.length) })
    if (!result.ok) throw new Error(result.error)
    state = recordEntryViews(state, result.state, result.steps)
    check()
  }
  return { state, clients }
}

function handGenesis(): GameState {
  return createNewGame({ gameId: 'g', gameType: HAND_GAME_TYPE, playMode: 'live', players: seatPlayers(4), hiddenInformationEnabled: true })
}

describe('the view log', () => {
  it("keeps every viewer's view and whole log exact through a card game with long-lived secrets, undo and redo", () => {
    const { state, clients } = playChecked(handGenesis(), (s) => nextHandAction(s as HandState), [3, 10, 25])
    expect(state.status).toBe('completed')
    // Every viewer has every entry, each narrated — the log never goes blank.
    for (const client of clients) {
      expect(client.entries).toHaveLength(state.actionHistory.length)
      expect(buildGameLogFromViewerEntries(client.entries).length).toBeGreaterThanOrEqual(state.actionHistory.length)
    }
  })

  it("never sends a viewer another player's hand, the deck, or any random numbers", () => {
    const genesis = handGenesis()
    let state = genesis
    for (let i = 0; i < 12; i++) {
      const result = applyActionWithSteps(state, nextHandAction(state as HandState)!, { random: seededSource('seed', 'move', i) })
      if (!result.ok) throw new Error(result.error)
      state = recordEntryViews(state, result.state, result.steps)
    }
    const hands = (state as HandState).game.hands as Record<string, number[]>
    for (const viewer of ['p1', 'p2', null]) {
      const wire = state.actionHistory.map((entry) => viewerEntry(entry, state, viewer))
      const json = JSON.stringify(wire)
      expect(json).not.toMatch(/"random"|"views"|redactedMessage/)
      // Folding everything this viewer received gives only their own hand.
      const view = applyViewerEntries(viewOf(genesis, viewer), wire) as PlayerView & { game: HandState['game'] }
      for (const [id, hand] of Object.entries(hands)) expect(view.game.hands[id]).toEqual(id === viewer ? hand : hand.map(() => null))
      expect(view.game.remaining).toEqual([])
    }
  })

  it('re-sends an earlier entry in full once it is revealed, and hides it again on undo', () => {
    const genesis = { ...newGame({ players: 3 }), hiddenInformationEnabled: true }
    const act = (s: GameState, playerId: string, value: number) => {
      const result = applyActionWithSteps(s, pickAction(playerId, value))
      if (!result.ok) throw new Error(result.error)
      return recordEntryViews(s, result.state, result.steps)
    }
    const midRound = act(act(genesis, 'p1', 3), 'p2', 4)
    expect(viewerEntry(midRound.actionHistory[0], midRound, 'p2').action.type).toBe('HIDDEN_ACTION')
    expect(viewerEntry(midRound.actionHistory[0], midRound, 'p2').lines[0].message).toBe('{player} picked a number.')

    const resolved = act(midRound, 'p3', 5)
    expect(flippedSince(resolved.actionHistory, 2, 'p2')).toEqual([0])
    expect(viewerEntry(resolved.actionHistory[0], resolved, 'p2').lines[0].message).toBe('{player} picked 3.')

    const undone = applyUndoAction(genesis, resolved, 'p3')
    if (!undone.ok) throw new Error(undone.error)
    const rehidden = recordEntryViews(resolved, undone.state)
    // p1's pick is secret again, and so is p3's own, now undone, pick.
    expect(flippedSince(rehidden.actionHistory, 3, 'p2')).toEqual([0, 2])
    expect(viewerEntry(rehidden.actionHistory[0], rehidden, 'p2').action.type).toBe('HIDDEN_ACTION')
  })

  it('stores the patch most viewers share once, and only the exceptions per viewer', () => {
    const genesis = handGenesis()
    const result = applyActionWithSteps(genesis, { type: 'DRAW_HAND', playerId: 'p1' }, { random: seededSource('seed', 'move', 0) })
    if (!result.ok) throw new Error(result.error)
    const views = recordEntryViews(genesis, result.state, result.steps).actionHistory[0].views!
    // Only the drawer sees their cards; everyone else shares one patch.
    expect(Object.keys(views.byViewer ?? {})).toEqual(['p1'])
  })
})
