// Explains one step of the platform's history review (GameViewProps.review):
// what the standalone app's "Show history" drew on top of a reviewed turn —
// halos and arrows on the units that acted (buildTurnReview), each player's
// resource and score change, and the card-choice recap.
//
// The stepping itself is the platform's now (its one review mode, which also
// steps a turn at a time using this game's own turns —
// GameDefinition.reviewStops in ../rules.ts). The platform hands the view the
// reviewed state, the state the step started from and the step's log
// entries; this hook turns those into the overlays.
//
// The halos and the recap re-run the step's moves through the engine
// (../engine/turnReview.ts), replaying the log up to the step (./history.ts)
// for the states they start from. For a redacted viewer that replay stops at
// the first move still secret from them, so a step past it gets the plain
// score and resource changes but no halos or recap — never a guess.

import { useMemo } from 'react'
import type { ReviewStep } from '@game-platform/sdk/ui'
import { toEngine, type GameState } from '../adapter.ts'
import type { LoggedAction } from '../engine/actions.ts'
import {
  buildTurnReview,
  cardChoicesForRecap,
  recapTurnFor,
  roundPhaseForRecap,
  shouldShowCardChoiceRecap,
  type CardChoiceRecap,
  type TurnReview,
} from '../engine/turnReview.ts'
import type { GameState as EngineState, RoundPhase } from '../engine/types.ts'
import type { GameContent } from '../gameContent.ts'
import type { GameData, GameOptions } from '../types.ts'
import { replayableHistory, replayPrefixes } from './history.ts'

export type TerritoryControlMode = 'off' | 'on' | 'changes'

export interface StepExplanation {
  /** The state the step started from — each player's score change is shown against it. */
  previousState: EngineState
  /** Halos, arrows and resource changes for the step's moves; null when they can't be worked out. */
  turnHalos: TurnReview | null
  showCardChoiceRecap: boolean
  cardChoiceRecapPhase: RoundPhase
  cardChoiceRecap: CardChoiceRecap | null
}

export function useStepExplanation(params: {
  /** The reviewed state (the end of the step). */
  state: GameState
  review: ReviewStep<GameData, GameOptions> | undefined
  genesis: EngineState | null
  content: GameContent
}): StepExplanation | null {
  const { state, review, genesis, content } = params

  // The log up to the reviewed point, cut at the first in-effect secret move.
  const history = useMemo(() => replayableHistory(state), [state])
  const reviewIndex = state.actionHistory.length
  const stepStart = review ? reviewIndex - review.entries.length : reviewIndex
  const replayable = history.length === reviewIndex

  const states = useMemo(() => {
    if (!review || !genesis || !replayable) return null
    try {
      return replayPrefixes(genesis, history, content)
    } catch {
      return null
    }
  }, [review, genesis, replayable, history, content])

  return useMemo((): StepExplanation | null => {
    if (!review) return null
    const previousState = toEngine(review.before)
    if (!states || !genesis) {
      const engine = toEngine(state)
      return { previousState, turnHalos: null, showCardChoiceRecap: false, cardChoiceRecapPhase: engine.roundPhase, cardChoiceRecap: null }
    }
    try {
      const turnHalos = buildTurnReview(
        states[stepStart],
        history.slice(stepStart, reviewIndex),
        content.unitContent,
        content.achievementContent,
        content.boardGenerationContent,
        content.taleContent,
        genesis,
        history.slice(0, stepStart),
      )
      const cardChoiceRecapPhase = roundPhaseForRecap(history, reviewIndex, states[reviewIndex])
      const recapTurn = recapTurnFor(history, reviewIndex, states[reviewIndex])
      const previousStop = stepStart > 0 ? { roundPhase: roundPhaseForRecap(history, stepStart, states[stepStart]), recapTurn: recapTurnFor(history, stepStart, states[stepStart]) } : null
      const showCardChoiceRecap = shouldShowCardChoiceRecap(cardChoiceRecapPhase, recapTurn, previousStop, review.granularity === 'turn' ? 'turn' : 'action')
      const cardChoiceRecap = showCardChoiceRecap
        ? cardChoicesForRecap(history as LoggedAction[], states, reviewIndex, recapTurn, content.unitContent, content.achievementContent, content.boardGenerationContent, content.taleContent)
        : null
      return { previousState, turnHalos, showCardChoiceRecap, cardChoiceRecapPhase, cardChoiceRecap }
    } catch {
      return { previousState, turnHalos: null, showCardChoiceRecap: false, cardChoiceRecapPhase: toEngine(state).roundPhase, cardChoiceRecap: null }
    }
  }, [review, states, genesis, state, history, stepStart, reviewIndex, content])
}
