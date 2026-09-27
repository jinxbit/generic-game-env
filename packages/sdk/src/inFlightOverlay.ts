/**
 * The gap between "the state as of the last action a viewer is allowed to
 * see" and "the state as that viewer is allowed to see it now".
 *
 * `unredactedPrefix` (./redaction.ts) truncates a viewer's `actionHistory` at
 * the first entry that isn't safe for them, so a client replaying everything
 * it holds lands *before* any still-secret move. The server's redacted view
 * is further on: it knows an opponent has moved, even while withholding
 * what. A client that rebuilt the state from actions alone would therefore
 * disagree with the server's hash on most reads taken mid-phase and fall back
 * to a full fetch every time.
 *
 * The overlay closes that gap: the viewer's view minus its log, sent
 * alongside the actions the client may replay, so it can finish the job.
 * It's sent whole (every top-level field but `actionHistory`), which is
 * always correct whatever the game hides; a game with a large state and a
 * small secret could narrow it to the fields its hidden moves can change.
 */
import type { GameState } from './types.ts'

export type InFlightOverlay = Omit<GameState, 'actionHistory'>

/**
 * Whether a viewer's own replay can reach their view unaided. It can't when
 * either (1) the safe prefix lags the log — a secret entry was cut — or
 * (2) redaction masked part of the game state even though every log entry
 * is visible (e.g. a secret that outlives its own log entry's secrecy).
 */
export function needsInFlightOverlay(trueState: GameState, view: GameState): boolean {
  if (view.actionHistory.length < trueState.actionHistory.length) return true
  return JSON.stringify(view.game) !== JSON.stringify(trueState.game)
}

/** Projects the overlay out of a viewer's current view, for the wire. */
export function buildInFlightOverlay(view: GameState): InFlightOverlay {
  const { actionHistory, ...overlay } = view
  void actionHistory
  return overlay
}

/**
 * Lays the overlay over a state the client rebuilt by replay. `undefined`
 * (nothing in flight) returns `base` unchanged, by reference — the common
 * case, where the client's replay already *is* the answer.
 */
export function applyInFlightOverlay(base: GameState, overlay: InFlightOverlay | undefined): GameState {
  if (!overlay) return base
  return { ...base, ...overlay, actionHistory: base.actionHistory }
}
