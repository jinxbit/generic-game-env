import { applyAction } from './applyAction.ts'
import type { LoggedAction } from './actions.ts'
import type { GameState } from './types.ts'
import { resolveHistory } from './historyFold.ts'

/**
 * Event-sourcing verification: replays a logged action history against a
 * genesis state (buildGenesisState, src/lib/gameGenesis.ts — before any
 * player action) and returns the resulting GameState. Since applyAction() is
 * a pure, deterministic reducer, replaying the same actions against the same
 * genesis always reconstructs the exact same state; the stored GameState is
 * just a cached shortcut so nothing has to replay from scratch on every read.
 *
 * Throws if any logged action is rejected — a genesis mismatch or a
 * corrupted history, either of which means the replayed state can no longer
 * be trusted.
 *
 * `history` may contain UNDO_ACTION/REDO_ACTION entries: resolveHistory
 * (./historyFold.ts) folds those into the prefix currently in effect, which
 * is what actually gets replayed. The returned state's `actionHistory` is
 * always exactly the raw `history` passed in, so a caller appending a
 * further action keeps extending the same append-only log.
 */
export function replayActions(genesis: GameState, history: LoggedAction[]): GameState {
  let state = genesis
  for (const entry of resolveHistory(history).effective) {
    const result = applyAction(state, entry.action)
    if (!result.ok) {
      throw new Error(`Replay failed at action ${JSON.stringify(entry.action)}: ${result.error}`)
    }
    state = result.state
  }
  return { ...state, actionHistory: history }
}

/**
 * Advances a state that was replayed up to `base.actionHistory` by the
 * entries in `append`, for the delta read path (gameApi.ts's
 * `getGameStateRedacted`). Two things this gets right that a naive
 * `append.forEach(applyAction)` does not:
 *
 * 1. **Undo and redo are logged actions, not a splice.** An append carrying
 *    an `UNDO_ACTION` changes which *earlier* actions are effective, so it
 *    can't be applied incrementally — it needs a full rebuild from `genesis`.
 *    Undo is rare, so the cheap incremental path is the normal one.
 * 2. **The log comes from the wire, not from the replay.** `applyAction`
 *    stamps the local clock on each entry it logs, so the resulting
 *    `actionHistory` is `base.actionHistory` plus `append` verbatim — the
 *    server's entries, timestamps and all.
 */
export function extendReplay(genesis: GameState, base: GameState, append: LoggedAction[]): GameState {
  const actionHistory = [...base.actionHistory, ...append]
  const foldRequired = append.some((entry) => entry.action.type === 'UNDO_ACTION' || entry.action.type === 'REDO_ACTION')
  if (foldRequired) {
    const rebuilt = replayActions(genesis, actionHistory)
    return { ...rebuilt, actionHistory }
  }
  let state = base
  for (const entry of append) {
    const result = applyAction(state, entry.action)
    if (!result.ok) throw new Error(`Delta replay failed at ${JSON.stringify(entry.action)}: ${result.error}`)
    state = result.state
  }
  return { ...state, actionHistory }
}

/**
 * The state a viewer's own visible actions imply, rebuilt from `genesis` —
 * the clean *base* behind a rendered view, for the delta read path. A view
 * can't be used as a base directly: once an in-flight overlay
 * (./inFlightOverlay.ts) has been laid over it, it carries the effects of
 * actions the viewer isn't yet allowed to replay. Replaying
 * `view.actionHistory` (always the viewer's safe prefix) sidesteps that.
 * Keeps the view's own `actionHistory`, for the same timestamp reason as
 * extendReplay.
 */
export function replayToBase(genesis: GameState, view: GameState): GameState {
  const rebuilt = replayActions(genesis, view.actionHistory)
  return { ...rebuilt, actionHistory: view.actionHistory }
}
