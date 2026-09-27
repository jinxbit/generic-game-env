import { describe, expect, it } from 'vitest'
import { hashGameStateView } from '../../lib/gameStateHash'
import { applyInFlightOverlay, buildInFlightOverlay, needsInFlightOverlay } from '../inFlightOverlay'
import { redactStateForPlayer, toClientGameState } from '../redaction'
import { replayActions } from '../replay'
import { newGame, pick } from './helpers'

/** Round 1 of a 3-player game: p1 picked 3, p2 picked 4, p3 still pending. */
function midRound() {
  const genesis = newGame({ players: 3, hiddenInformationEnabled: true })
  return { genesis, state: pick(pick(genesis, 'p1', 3), 'p2', 4) }
}

const viewFor = (state: ReturnType<typeof midRound>['state'], viewerId: string | null) => toClientGameState(redactStateForPlayer(state, viewerId))

describe('needsInFlightOverlay', () => {
  it('is false when the view is the true state (nothing hidden)', () => {
    const { state } = midRound()
    const resolved = pick(state, 'p3', 1)
    expect(needsInFlightOverlay(resolved, viewFor(resolved, 'p1'))).toBe(false)
  })

  it("is false when the viewer's safe prefix is the whole log and redaction masked nothing new", () => {
    const genesis = newGame({ players: 3, hiddenInformationEnabled: true })
    const state = pick(genesis, 'p1', 3)
    // p1 sees their own pick, and every other pick is still null anyway.
    expect(needsInFlightOverlay(state, viewFor(state, 'p1'))).toBe(false)
  })

  it('is true when a secret entry was cut from the log', () => {
    const { state } = midRound()
    expect(needsInFlightOverlay(state, viewFor(state, 'p1'))).toBe(true)
  })

  it('is true when the game state was masked even though every entry is visible', () => {
    const { state } = midRound()
    const view = { ...state, game: { ...state.game, picks: { p1: 3, p2: null, p3: null } } }
    expect(needsInFlightOverlay(state, view)).toBe(true)
  })
})

describe('buildInFlightOverlay / applyInFlightOverlay', () => {
  it('carries everything but the log', () => {
    const { state } = midRound()
    const overlay = buildInFlightOverlay(viewFor(state, 'p1'))
    expect('actionHistory' in overlay).toBe(false)
    expect(overlay.pendingPlayerIds).toEqual(['p3'])
  })

  it("closes the gap between the viewer's own replay and their view, hash and all", () => {
    const { genesis, state } = midRound()
    const view = viewFor(state, 'p1')
    // What the client can reach unaided: only its safe prefix (p1's own pick).
    const base = replayActions(genesis, view.actionHistory)
    expect(base.pendingPlayerIds).toEqual(['p2', 'p3'])
    expect(hashGameStateView(base)).not.toBe(hashGameStateView(view))

    const rebuilt = applyInFlightOverlay(base, buildInFlightOverlay(view))

    expect(rebuilt).toEqual(view)
    expect(hashGameStateView(rebuilt)).toBe(hashGameStateView(view))
  })

  it("keeps the base's own log", () => {
    const { genesis, state } = midRound()
    const base = replayActions(genesis, state.actionHistory.slice(0, 1))
    expect(applyInFlightOverlay(base, buildInFlightOverlay(viewFor(state, 'p1'))).actionHistory).toBe(base.actionHistory)
  })

  it('returns the base itself when nothing is in flight', () => {
    const { state } = midRound()
    expect(applyInFlightOverlay(state, undefined)).toBe(state)
  })
})
