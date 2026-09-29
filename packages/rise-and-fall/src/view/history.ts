// Client-side replays of a game's log, for the view's features that need
// more than the one state it is handed: the overlays explaining a step of the
// platform's history review (halos, arrows, card-choice recap —
// ./useStepExplanation.ts, RoundView.tsx) and the end-of-game charts
// (EndGameView.tsx).
//
// Everything replays the engine itself (../engine/replay.ts and friends) from
// the engine's genesis, rebuilt from the platform state (../adapter.ts's
// `engineGenesisOf`), over the platform's `actionHistory` — whose entries
// carry the engine's own `{ action, turn, timestamp }` shape, framework
// actions (CONCEDE, UNDO_ACTION, REDO_ACTION, SET_ADMIN_MODE) included.
//
// Hidden information: a redacted viewer's log can hold `HIDDEN_ACTION`
// placeholders for entries still secret from them. Nothing after the first
// one in effect can be replayed (the state it would produce is exactly what
// is being kept from them), so the log is cut there — the review and charts
// simply end a little early, never guess.
//
// Replays can fail (an engine that no longer accepts an old entry): callers
// get null and hide the feature rather than crash the game view.

import { engineGenesisOf, type GameState } from '../adapter.ts'
import type { LoggedAction } from '../engine/actions.ts'
import { applyAction } from '../engine/applyAction.ts'
import { resolveHistory } from '../engine/historyFold.ts'
import { replayActions } from '../engine/replay.ts'
import type { GameState as EngineState } from '../engine/types.ts'
import type { GameContent } from '../gameContent.ts'

/** The platform log as the engine's LoggedAction[], cut at the first in-effect `HIDDEN_ACTION` placeholder. */
export function replayableHistory(state: GameState): LoggedAction[] {
  const history = state.actionHistory as unknown as LoggedAction[]
  const firstHidden = resolveHistory(history).effective.find((entry) => (entry.action.type as string) === 'HIDDEN_ACTION')
  return firstHidden ? history.slice(0, history.indexOf(firstHidden)) : history
}

/** The engine genesis for `state`, or null if it can't be rebuilt. */
export function safeEngineGenesis(state: GameState): EngineState | null {
  try {
    return engineGenesisOf(state)
  } catch {
    return null
  }
}

/**
 * The engine state after each prefix of `history`: `states[i]` is the state
 * with the first `i` entries applied (`states[0]` is genesis). Undo and redo
 * entries aren't forward steps, so at those the prefix is replayed from
 * genesis (resolveHistory folds them); every other entry — a new action after
 * an undo included — applies to the state before it. Throws on failure.
 */
export function replayPrefixes(genesis: EngineState, history: LoggedAction[], content: GameContent): EngineState[] {
  const { unitContent, achievementContent, boardGenerationContent, taleContent } = content
  const states: EngineState[] = [genesis]
  let state = genesis
  for (let i = 0; i < history.length; i++) {
    const { action } = history[i]
    if (action.type === 'UNDO_ACTION' || action.type === 'REDO_ACTION') {
      state = replayActions(genesis, history.slice(0, i + 1), unitContent, achievementContent, boardGenerationContent, taleContent)
    } else {
      const result = applyAction(state, action, unitContent, achievementContent, boardGenerationContent, taleContent, true)
      if (!result.ok) throw new Error(`Replay failed at entry ${i}: ${result.error}`)
      state = result.state
    }
    states.push(state)
  }
  return states
}
