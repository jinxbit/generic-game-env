// "Show history" — the standalone app's turn-by-turn review, which steps
// through the game a turn at a time and highlights what each one did: halos
// and arrows on the units that acted (buildTurnReview), each player's
// resource and score change, the card-choice recap overlay, and the
// territory-control "changes" overlay.
//
// The platform's own history review (the shell's action-by-action stepper)
// is separate and still works: it simply hands the view an earlier state.
// This review works on whatever state the view was given, so it is available
// both live and at a reviewed point.
//
// Turn stops, the default entry point ("right after your last turn") and the
// recap rules are the engine's own (../engine/turnReview.ts); the states come
// from replaying the log (./history.ts), only while the review is open.

import { useMemo, useState } from 'react'
import type { LoggedAction } from '../engine/actions.ts'
import {
  buildTurnReview,
  cardChoicesForRecap,
  findReviewWindowStart,
  findTurnStops,
  recapTurnFor,
  reviewPhaseGroupAt,
  roundPhaseForRecap,
  shouldShowCardChoiceRecap,
  type CardChoiceRecap,
  type TurnReview,
} from '../engine/turnReview.ts'
import type { GameState as EngineState, RoundPhase } from '../engine/types.ts'
import type { GameContent } from '../gameContent.ts'
import { replayPrefixes } from './history.ts'

export type TerritoryControlMode = 'off' | 'on' | 'changes'

export interface TurnReviewView {
  /** The replayed state at the reviewed stop. */
  state: EngineState
  turnHalos: TurnReview | null
  previousState: EngineState | null
  showCardChoiceRecap: boolean
  cardChoiceRecapPhase: RoundPhase
  cardChoiceRecap: CardChoiceRecap | null
  label: string
  canPrev: boolean
  canNext: boolean
  position: number
  stopCount: number
}

export interface TurnReviewControls {
  /** Whether there is anything to review at all. */
  available: boolean
  open: boolean
  /** Null while closed, or when the replay failed (the review then just isn't shown). */
  review: TurnReviewView | null
  start: () => void
  exit: () => void
  prev: () => void
  next: () => void
  /** Jumps to the `position`th turn stop (the slider). */
  goTo: (position: number) => void
  territoryControlMode: TerritoryControlMode
  setTerritoryControlMode: (mode: TerritoryControlMode) => void
}

export function useTurnReview(params: {
  genesis: EngineState | null
  history: LoggedAction[]
  content: GameContent
  myPlayerId: string | null
  playerName: (playerId: string | null) => string
}): TurnReviewControls {
  const { genesis, history, content, myPlayerId, playerName } = params
  const [requestedIndex, setRequestedIndex] = useState<number | null>(null)
  const [territoryControlMode, setTerritoryControlMode] = useState<TerritoryControlMode>('changes')
  const open = requestedIndex !== null

  const stops = useMemo(() => {
    try {
      return findTurnStops(history, 0)
    } catch {
      return [0, history.length]
    }
  }, [history])

  /** Right after the viewer's own last turn (snapped forward onto a stop), or genesis for someone with no seat. */
  const defaultIndex = useMemo(() => {
    const rawStart = myPlayerId ? findReviewWindowStart(history, myPlayerId) : 0
    return stops.find((stop) => stop >= rawStart) ?? stops[stops.length - 1]
  }, [history, myPlayerId, stops])

  const states = useMemo(() => {
    if (!open || !genesis) return null
    try {
      return replayPrefixes(genesis, history, content)
    } catch {
      return null
    }
  }, [open, genesis, history, content])

  // Live updates can move the log on while the review is open — keep the index on a stop that exists.
  const reviewIndex = requestedIndex === null ? null : stops.includes(requestedIndex) ? requestedIndex : (stops.find((stop) => stop >= requestedIndex) ?? stops[stops.length - 1])

  const review = useMemo((): TurnReviewView | null => {
    if (reviewIndex === null || !states || !genesis) return null
    try {
      const pos = stops.indexOf(reviewIndex)
      let turnHalos: TurnReview | null = null
      let previousState: EngineState | null = null
      let previousStop: { roundPhase: RoundPhase; recapTurn: number } | null = null
      if (pos > 0) {
        const prevStop = stops[pos - 1]
        if (reviewIndex !== defaultIndex) {
          turnHalos = buildTurnReview(
            states[prevStop],
            history.slice(prevStop, reviewIndex),
            content.unitContent,
            content.achievementContent,
            content.boardGenerationContent,
            content.taleContent,
            genesis,
            history.slice(0, prevStop),
          )
          previousState = states[prevStop]
        }
        previousStop = { roundPhase: roundPhaseForRecap(history, prevStop, states[prevStop]), recapTurn: recapTurnFor(history, prevStop, states[prevStop]) }
      }
      const cardChoiceRecapPhase = roundPhaseForRecap(history, reviewIndex, states[reviewIndex])
      const recapTurn = recapTurnFor(history, reviewIndex, states[reviewIndex])
      const showCardChoiceRecap = shouldShowCardChoiceRecap(cardChoiceRecapPhase, recapTurn, previousStop, 'turn')
      const cardChoiceRecap = showCardChoiceRecap
        ? cardChoicesForRecap(history, states, reviewIndex, recapTurn, content.unitContent, content.achievementContent, content.boardGenerationContent, content.taleContent)
        : null

      const stopCount = stops.length - 1
      let label: string
      if (reviewIndex === defaultIndex && defaultIndex === history.length) label = myPlayerId ? 'Nothing since your last turn.' : 'Nothing has happened yet.'
      else if (reviewIndex === 0) label = 'Start of the game'
      else if (reviewIndex === defaultIndex && myPlayerId) label = 'Right after your last turn'
      else {
        // selectCards/declinePurchase are simultaneous — every player acts at once, so
        // there's no single "next" player to name; show the phase instead (issue #324).
        const group = reviewPhaseGroupAt(history, reviewIndex)
        if (group === 'selectCards') label = `Select cards (${pos} of ${stopCount})`
        else if (group === 'declinePurchase') label = `Decline / Purchase (${pos} of ${stopCount})`
        else label = `${playerName(history[reviewIndex - 1]?.action.playerId ?? null)}'s turn (${pos} of ${stopCount})`
      }

      return {
        state: states[reviewIndex],
        turnHalos,
        previousState,
        showCardChoiceRecap,
        cardChoiceRecapPhase,
        cardChoiceRecap,
        label,
        canPrev: pos > 0,
        canNext: pos < stops.length - 1,
        position: pos,
        stopCount,
      }
    } catch {
      return null
    }
  }, [reviewIndex, states, genesis, stops, defaultIndex, history, content, myPlayerId, playerName])

  return {
    available: history.length > 0 && genesis !== null,
    open,
    review,
    start: () => setRequestedIndex(defaultIndex),
    exit: () => setRequestedIndex(null),
    prev: () => {
      if (reviewIndex === null) return
      const pos = stops.indexOf(reviewIndex)
      if (pos > 0) setRequestedIndex(stops[pos - 1])
    },
    next: () => {
      if (reviewIndex === null) return
      const pos = stops.indexOf(reviewIndex)
      if (pos < stops.length - 1) setRequestedIndex(stops[pos + 1])
    },
    goTo: (position: number) => {
      if (reviewIndex !== null && position >= 0 && position < stops.length) setRequestedIndex(stops[position])
    },
    territoryControlMode,
    setTerritoryControlMode,
  }
}
