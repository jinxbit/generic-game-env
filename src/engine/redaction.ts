import type { Action, LoggedAction } from './actions.ts'
import { game } from './game.ts'
import { resolveHistory } from './historyFold.ts'
import type { GameEvent, GameState } from './types.ts'

/**
 * Stands in for a log entry that is still secret from the viewer — keeps
 * *that* someone acted (and who) without *what* they did. Never replayable:
 * see unredactedPrefix.
 */
export interface HiddenAction {
  type: 'HIDDEN_ACTION'
  playerId: string | null
}

export type RedactedLoggedAction = Omit<LoggedAction, 'action'> & { action: Action | HiddenAction }

/**
 * A GameState as sent to one particular viewer: the game-specific slice
 * masked by the game's own `redactGame`, and every still-secret log entry
 * replaced with a HiddenAction placeholder.
 */
export type RedactedGameState = Omit<GameState, 'actionHistory'> & {
  /** Not replayable as-is — see unredactedPrefix. */
  actionHistory: RedactedLoggedAction[]
}

/**
 * Read-side view of GameState for a specific viewer (`viewerId`, one of
 * GameState.players[].id, or `null` for a non-player). What counts as secret
 * is entirely the game's call (GameDefinition.redactGame/isActionSecret,
 * src/game/rules.ts); this applies it to both the state and the log, since
 * scrubbing only the state and shipping the raw log alongside it would leak
 * the same value straight back out of the action payloads.
 *
 * Always derives from `state`'s own current phase — an entry that was secret
 * when logged reads as revealed once the game moves on.
 *
 * Pure, like the rest of src/engine/. The caller (the `get-game-state` Edge
 * Function and the write-path functions' responses) is responsible for
 * making this the only view an opponent's client ever receives.
 */
export function redactStateForPlayer(state: GameState, viewerId: string | null): RedactedGameState {
  const actionHistory: RedactedLoggedAction[] = state.actionHistory.map((entry) =>
    game.isActionSecret(entry, state, viewerId) ? { ...entry, action: { type: 'HIDDEN_ACTION', playerId: actionPlayerId(entry.action) } } : entry,
  )
  return { ...state, game: game.redactGame(state, viewerId), actionHistory }
}

function actionPlayerId(action: Action): string | null {
  return 'playerId' in action && typeof action.playerId === 'string' ? action.playerId : null
}

/**
 * The `RedactedGameState` shape with nothing masked — for callers nothing is
 * hidden from (a site admin, hotseat, or a game without hidden information),
 * so every caller gets the same response shape.
 */
export function revealedGameStateView(state: GameState): RedactedGameState {
  return state
}

/**
 * The client-side inverse of redactStateForPlayer: collapses a response back
 * into a plain GameState so the rest of the app keeps consuming `GameState`.
 * `actionHistory` is truncated at the first hidden entry (unredactedPrefix)
 * rather than inventing a placeholder payload for it.
 */
export function toClientGameState(redacted: RedactedGameState): GameState {
  return { ...redacted, actionHistory: unredactedPrefix(redacted.actionHistory) }
}

/**
 * get-game-state's incremental-fetch response payload: the rest of a
 * RedactedGameState, plus the actionHistory entries logged after
 * `actionHistoryFrom` instead of the whole array.
 */
export interface RedactedGameStateDelta {
  state: Omit<RedactedGameState, 'actionHistory'>
  actionHistoryFrom: number
  actionHistoryAppend: RedactedLoggedAction[]
  actionHistoryLength: number
}

/**
 * Client-side counterpart of the incremental fetch: splices `delta`'s new
 * entries onto `previousActionHistory` (the safe prefix a previous
 * toClientGameState call produced). Returns null — rather than guessing —
 * when the delta doesn't line up with it, so the caller falls back to a full
 * fetch.
 */
export function applyRedactedGameStateDelta(previousActionHistory: LoggedAction[], delta: RedactedGameStateDelta): RedactedGameState | null {
  if (delta.actionHistoryFrom !== previousActionHistory.length) return null
  const actionHistory: RedactedLoggedAction[] = [...previousActionHistory, ...delta.actionHistoryAppend]
  if (actionHistory.length !== delta.actionHistoryLength) return null
  return { ...delta.state, actionHistory }
}

/**
 * A narration log as `viewerId` may see it: every event whose log entry is
 * still secret from them right now (GameDefinition.isActionSecret, checked
 * against the *current* state) shows its `redactedMessage` instead.
 *
 * On the redacted read path a secret entry never reaches the client at all
 * (unredactedPrefix cuts before it), so there's nothing here to mask; this
 * covers the client-trusted and hotseat paths, where the full log is present
 * and only the display needs masking.
 */
export function redactGameLog(events: GameEvent[], state: GameState, viewerId: string | null): GameEvent[] {
  return events.map((event) => {
    const entry = state.actionHistory[event.entryIndex]
    if (!entry || event.redactedMessage === undefined || !game.isActionSecret(entry, state, viewerId)) return event
    return { ...event, message: event.redactedMessage }
  })
}

/**
 * The longest prefix of a (possibly redacted) `actionHistory` that contains
 * no hidden entry still in effect — safe to replay. A hidden entry isn't a
 * legal action, and replaying around it would produce a state that never
 * existed, so the cut happens *before* the first effective one: the client
 * simply hasn't seen anything after that point yet, and learns the rest once
 * the secret is revealed.
 *
 * A hidden entry that has since been undone (behind the undo pointer — see
 * ./historyFold.ts) is kept rather than cut at: replayActions only ever
 * replays `resolveHistory(...).effective`, so it is never applied, and
 * cutting there would also drop the UNDO_ACTION that undid it (and
 * everything after), leaving the viewer's own resolveHistory disagreeing
 * with the server's about whether a Redo is available. A HIDDEN_ACTION
 * stands in for a gameplay action, so the fold counts it as one — exactly
 * where the real entry sits.
 */
export function unredactedPrefix(actionHistory: RedactedLoggedAction[]): LoggedAction[] {
  const history = actionHistory as LoggedAction[]
  if (!history.some((entry) => (entry.action.type as string) === 'HIDDEN_ACTION')) return history
  const effective = new Set(resolveHistory(history).effective)
  const index = history.findIndex((entry) => (entry.action.type as string) === 'HIDDEN_ACTION' && effective.has(entry))
  return index === -1 ? history : history.slice(0, index)
}
