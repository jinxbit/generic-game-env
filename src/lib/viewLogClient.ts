/**
 * The client side of the view log (@game-platform/sdk's viewLog.ts): how a
 * redacted viewer of a hidden-information game keeps its state, log and
 * history without ever running the rules.
 *
 * A view-log state is an ordinary `GameState` whose fields are the viewer's
 * view and whose `actionHistory` is the whole log in the viewer's form
 * (`ViewerLogEntry`: the action or a HIDDEN_ACTION placeholder, the
 * narration they may read, and — when received incrementally — their patch).
 * It is its own base: nothing is overlaid on it, so it's what gets cached and
 * sent back as the next request's starting point.
 *
 * Every response is checked against the server's hash of the view it should
 * produce, the same safety net as the replay protocol (./gameStateHash.ts):
 * anything that doesn't line up is a cache miss answered by a full read,
 * never a wrong board.
 *
 * Pure — no Supabase client — so it can be tested directly; gameApi.ts does
 * the network half.
 */
import { applyViewerEntries, type GameState, type LoggedAction, type PlayerView, type ViewerLogEntry } from '@game-platform/sdk'
import { hashGameStateView } from './gameStateHash'

/** An entry re-sent only because its secrecy for this viewer changed. */
export interface RevisedViewerEntry {
  index: number
  action: ViewerLogEntry['action']
  lines: ViewerLogEntry['lines']
}

/** Protocol 3's three response shapes — see respondWithViewLog (supabase/functions/_shared/gameEnforcement.ts). */
export type ViewLogResponse = { viewLog: true; version: number; stateHash: string } & (
  | { from: number; entries: ViewerLogEntry[]; revised?: RevisedViewerEntry[] }
  | { view: PlayerView; entries: ViewerLogEntry[] }
  | { genesisView: PlayerView; entries: ViewerLogEntry[] }
)

export type ViewLogFailure = 'cursor-mismatch' | 'hash-mismatch'

function entriesOf(state: GameState): ViewerLogEntry[] {
  return state.actionHistory as unknown as ViewerLogEntry[]
}

function toState(view: PlayerView, entries: ViewerLogEntry[]): GameState {
  return { ...view, actionHistory: entries as unknown as LoggedAction[] }
}

function viewPart(state: GameState): PlayerView {
  const { actionHistory, ...view } = state
  void actionHistory
  return view
}

/**
 * Whether `state` came from the view log, so its log length is a cursor the
 * server can continue from. Every view-log entry carries its narration;
 * no replay-protocol entry does. (An empty log can't tell — it's treated as
 * not, which only costs one small full read at the very start of a game.)
 */
export function isViewLogState(state: GameState | null | undefined): boolean {
  return Boolean(state && state.actionHistory.length > 0 && state.actionHistory.every((entry) => Array.isArray((entry as { lines?: unknown }).lines)))
}

/** Applies a delta or full view-log response to what this client holds, or says why it couldn't. */
export function applyViewLogResponse(previous: GameState | null | undefined, response: ViewLogResponse): { ok: true; state: GameState } | { ok: false; reason: ViewLogFailure } {
  let state: GameState
  if ('from' in response) {
    if (!previous || !isViewLogState(previous) || response.from !== previous.actionHistory.length) return { ok: false, reason: 'cursor-mismatch' }
    const entries = [...entriesOf(previous)]
    for (const revision of response.revised ?? []) {
      const held = entries[revision.index]
      if (!held) return { ok: false, reason: 'cursor-mismatch' }
      entries[revision.index] = { ...held, action: revision.action, lines: revision.lines }
    }
    state = toState(applyViewerEntries(viewPart(previous), response.entries), [...entries, ...response.entries])
  } else if ('view' in response) {
    state = toState(response.view, response.entries)
  } else {
    state = toState(applyViewerEntries(response.genesisView, response.entries), response.entries)
  }
  if (hashGameStateView(state) !== response.stateHash) return { ok: false, reason: 'hash-mismatch' }
  return { ok: true, state }
}

/** Everything history review needs for a view-log game: the viewer's view of genesis and every entry's patch. */
export interface ViewLogHistory {
  genesisView: PlayerView
  entries: ViewerLogEntry[]
}

/** The viewer's state after the first `index` entries — what history review shows. Entries' current narration comes from `current`, the live log. */
export function viewLogReviewState(history: ViewLogHistory, current: GameState, index: number): GameState {
  const shown = entriesOf(current).slice(0, index)
  return toState(applyViewerEntries(history.genesisView, history.entries.slice(0, index)), shown)
}
