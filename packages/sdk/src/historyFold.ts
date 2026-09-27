import type { LoggedAction } from './actions.ts'

/**
 * The result of folding UNDO_ACTION/REDO_ACTION entries out of a raw
 * `actionHistory` (see UndoAction's doc comment in ./actions.ts for why
 * undo/redo are logged entries rather than a client-local truncation):
 * `effective` is what GameState is actually derived from.
 */
export interface ResolvedHistory {
  /**
   * Every entry currently "in effect", in order — replay this (not the raw
   * history) to get the current GameState. The gameplay prefix the undo
   * pointer currently keeps, plus every `SET_ADMIN_MODE` entry
   * unconditionally (see walkHistory).
   */
  effective: LoggedAction[]
  /** Whether UNDO_ACTION has any gameplay entry left to revert (a `SET_ADMIN_MODE` entry never counts). */
  canUndo: boolean
  /** Whether REDO_ACTION has anything left to advance into. */
  canRedo: boolean
}

/**
 * Walks raw `history` once, maintaining a "pointer" into the gameplay
 * actions seen so far: each UNDO_ACTION moves it back one (never below 0),
 * each REDO_ACTION forward one (never past the gameplay actions seen), and
 * every other action either extends the list (pointer at its tip — the
 * ordinary case) or branches (pointer behind the tip: the un-redone tail is
 * abandoned). Branched-away entries stay in `history` — nothing is ever
 * deleted — they're just no longer reachable by REDO_ACTION.
 *
 * `SET_ADMIN_MODE` never joins the gameplay list and never moves the
 * pointer: it's not a gameplay step, so a bare Undo right after switching
 * admin mode on reaches the real action underneath instead of silently
 * switching it back off. It is still replayed (resolveHistory keeps it in
 * `.effective`), since it can carry forced follow-ups like any other entry.
 */
function walkHistory(history: LoggedAction[]): { substantive: LoggedAction[]; pointer: number } {
  const substantive: LoggedAction[] = []
  let pointer = 0
  for (const entry of history) {
    if (entry.action.type === 'UNDO_ACTION') {
      pointer = Math.max(0, pointer - 1)
    } else if (entry.action.type === 'REDO_ACTION') {
      pointer = Math.min(substantive.length, pointer + 1)
    } else if (entry.action.type === 'SET_ADMIN_MODE') {
      // Excluded from the pointer walk entirely — see this function's own doc comment.
    } else {
      substantive.length = pointer // no-op at the tip; drops the un-redone tail otherwise
      substantive.push(entry)
      pointer += 1
    }
  }
  return { substantive, pointer }
}

/** The one place that interprets UNDO_ACTION/REDO_ACTION — replayActions (./replay.ts) delegates here. */
export function resolveHistory(history: LoggedAction[]): ResolvedHistory {
  const { substantive, pointer } = walkHistory(history)
  const keptGameplay = new Set(substantive.slice(0, pointer))
  const effective = history.filter((entry) => entry.action.type === 'SET_ADMIN_MODE' || keptGameplay.has(entry))
  return { effective, canUndo: pointer > 0, canRedo: pointer < substantive.length }
}

/**
 * The gameplay entries currently sitting behind the tip — exactly what a
 * fresh action submitted right now would push out of reach of REDO_ACTION.
 * The owner-override check (requiresOwnerOverride,
 * supabase/functions/_shared/gameEnforcement.ts) uses this to decide whether
 * a submission would discard another player's undone action. Empty whenever
 * `canRedo` is false; never contains a `SET_ADMIN_MODE` entry.
 */
export function redoableTail(history: LoggedAction[]): LoggedAction[] {
  const { substantive, pointer } = walkHistory(history)
  return substantive.slice(pointer)
}
