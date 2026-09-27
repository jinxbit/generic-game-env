import { describe, expect, it } from 'vitest'
import { buildGameLog } from '../gameLog'
import {
  applyRedactedGameStateDelta,
  redactGameLog,
  redactStateForPlayer,
  revealedGameStateView,
  toClientGameState,
  unredactedPrefix,
  type RedactedGameStateDelta,
  type RedactedLoggedAction,
} from '../redaction'
import { act, gameData, newGame, pick, pickAction, pickAll } from './helpers'

/** Round 1 of a 3-player game with p1 and p2 picked and p3 still pending. */
function midRound() {
  const genesis = newGame({ players: 3, hiddenInformationEnabled: true })
  return { genesis, state: pick(pick(genesis, 'p1', 3), 'p2', 4) }
}

const hidden = (playerId: string | null) => ({ type: 'HIDDEN_ACTION', playerId })

describe('redactStateForPlayer', () => {
  it("masks other players' open picks and shows the viewer their own", () => {
    const { state } = midRound()
    expect(gameData(redactStateForPlayer(state, 'p1')).picks).toEqual({ p1: 3, p2: null, p3: null })
    expect(gameData(redactStateForPlayer(state, 'p2')).picks).toEqual({ p1: null, p2: 4, p3: null })
  })

  it("replaces others' still-secret log entries with a HIDDEN_ACTION that keeps who acted, not what", () => {
    const { state } = midRound()
    const view = redactStateForPlayer(state, 'p1')

    expect(view.actionHistory[0]).toEqual(state.actionHistory[0])
    expect(view.actionHistory[1]).toEqual({ ...state.actionHistory[1], action: hidden('p2') })
  })

  it('masks everything for a non-player (null) viewer', () => {
    const { state } = midRound()
    const view = redactStateForPlayer(state, null)

    expect(gameData(view).picks).toEqual({ p1: null, p2: null, p3: null })
    expect(view.actionHistory.map((entry) => entry.action)).toEqual([hidden('p1'), hidden('p2')])
  })

  it('leaves everything outside the game slice and the log untouched', () => {
    const { state } = midRound()
    const view = redactStateForPlayer(state, 'p3')
    expect({ ...view, game: state.game, actionHistory: state.actionHistory }).toEqual(state)
    expect(gameData(view).scores).toEqual(state.game.scores)
  })

  it('reveals a round once it resolves — derived from the current state, not the state when logged', () => {
    const { state } = midRound()
    const resolved = pick(state, 'p3', 4)
    const view = redactStateForPlayer(resolved, 'p3')

    expect(view.actionHistory).toEqual(resolved.actionHistory)
    expect(gameData(view).rounds[0].picks).toEqual({ p1: 3, p2: 4, p3: 4 })
  })

  it('keeps past rounds revealed while hiding the open one', () => {
    const genesis = newGame({ players: 2, hiddenInformationEnabled: true })
    const state = pick(pickAll(genesis, { p1: 1, p2: 2 }), 'p1', 5)
    const view = redactStateForPlayer(state, 'p2')

    expect(view.actionHistory.map((entry) => entry.action.type)).toEqual(['PICK_NUMBER', 'PICK_NUMBER', 'HIDDEN_ACTION'])
    expect(gameData(view).picks).toEqual({ p1: null, p2: null })
  })

  it('hides nothing once the game is over', () => {
    const { state } = midRound()
    const finished = act(act(state, { type: 'CONCEDE', playerId: 'p3' }), { type: 'CONCEDE', playerId: 'p2' })
    expect(finished.status).toBe('completed')

    expect(redactStateForPlayer(finished, null)).toEqual(finished)
  })

  it('never hides framework actions', () => {
    const { state } = midRound()
    const withAdmin = act(state, { type: 'SET_ADMIN_MODE', playerId: 'p2', enabled: true })
    expect(redactStateForPlayer(withAdmin, 'p3').actionHistory[2].action.type).toBe('SET_ADMIN_MODE')
  })

  it('never mutates its input', () => {
    const { state } = midRound()
    const snapshot = structuredClone(state)
    redactStateForPlayer(state, null)
    expect(state).toEqual(snapshot)
  })
})

describe('revealedGameStateView', () => {
  it('is the state itself, unmasked', () => {
    const { state } = midRound()
    expect(revealedGameStateView(state)).toBe(state)
  })
})

describe('unredactedPrefix', () => {
  const visible = (value: number): RedactedLoggedAction => ({ action: pickAction('p1', value), turn: 1, timestamp: '' })
  const secret = (): RedactedLoggedAction => ({ action: { type: 'HIDDEN_ACTION', playerId: 'p2' }, turn: 1, timestamp: '' })

  it('keeps a log with nothing hidden whole', () => {
    const log = [visible(1), visible(2)]
    expect(unredactedPrefix(log)).toEqual(log)
  })

  it('cuts before the first hidden entry, dropping anything visible after it too', () => {
    expect(unredactedPrefix([visible(1), secret(), visible(2)])).toEqual([visible(1)])
  })

  it('is empty when the very first entry is hidden', () => {
    expect(unredactedPrefix([secret(), visible(1)])).toEqual([])
  })
})

describe('toClientGameState', () => {
  it("collapses a viewer's view into a plain GameState, log truncated at the first secret", () => {
    const { state } = midRound()
    const client = toClientGameState(redactStateForPlayer(state, 'p1'))

    expect(client.actionHistory).toEqual(state.actionHistory.slice(0, 1))
    expect(gameData(client).picks).toEqual({ p1: 3, p2: null, p3: null })
    expect(client.pendingPlayerIds).toEqual(['p3'])
  })
})

describe('applyRedactedGameStateDelta', () => {
  // Viewer p1: their own pick (entry 0) is their safe prefix; p2's (entry 1) arrives hidden.
  function setup() {
    const { state } = midRound()
    const { actionHistory, ...rest } = redactStateForPlayer(state, 'p1')
    const previous = state.actionHistory.slice(0, 1)
    const delta: RedactedGameStateDelta = { state: rest, actionHistoryFrom: 1, actionHistoryAppend: actionHistory.slice(1), actionHistoryLength: 2 }
    return { view: { ...rest, actionHistory }, previous, delta }
  }

  it('splices the appended entries onto the previous safe prefix', () => {
    const { view, previous, delta } = setup()
    expect(applyRedactedGameStateDelta(previous, delta)).toEqual(view)
  })

  it("returns null when the delta doesn't start where the previous log ends", () => {
    const { delta } = setup()
    expect(applyRedactedGameStateDelta([], delta)).toBeNull()
    expect(applyRedactedGameStateDelta(midRound().state.actionHistory, delta)).toBeNull()
  })

  it('returns null when the spliced log comes out the wrong length', () => {
    const { previous, delta } = setup()
    expect(applyRedactedGameStateDelta(previous, { ...delta, actionHistoryLength: 5 })).toBeNull()
  })
})

describe('redactGameLog', () => {
  it("shows the viewer's own pick and the redacted line for everyone else's still-open pick", () => {
    const { genesis, state } = midRound()
    const events = buildGameLog(genesis, state.actionHistory)

    expect(redactGameLog(events, state, 'p1').map((event) => event.message)).toEqual(['{player} picked 3.', '{player} picked a number.'])
    expect(redactGameLog(events, state, null).map((event) => event.message)).toEqual(['{player} picked a number.', '{player} picked a number.'])
  })

  it('shows the full narration once the round has resolved', () => {
    const { genesis, state } = midRound()
    const resolved = pick(state, 'p3', 1)
    const events = buildGameLog(genesis, resolved.actionHistory)

    expect(redactGameLog(events, resolved, null)).toEqual(events)
  })

  it('leaves lines with no redacted form alone', () => {
    const { genesis, state } = midRound()
    const conceded = act(state, { type: 'CONCEDE', playerId: 'p1' })
    const events = buildGameLog(genesis, conceded.actionHistory)

    expect(redactGameLog(events, conceded, null).at(-1)?.message).toBe('{player} conceded.')
  })
})
