import { isFrameworkAction, type Action, type LoggedAction } from './actions.ts'
import { applyLoggedAction } from './applyAction.ts'
import { definitionFor } from './registry.ts'
import { replayActions } from './replay.ts'
import type { GameEvent, GameState } from './types.ts'

/**
 * Placeholder substituted into a log `message` wherever `playerId`'s display
 * name belongs — narration is built without the player-name lookup (that's
 * DB-row data outside the engine), and the UI swaps the name back in.
 */
export const PLAYER_PLACEHOLDER = '{player}'

interface DraftEvent {
  playerId: string | null
  message: string
  redactedMessage?: string
}

function describeStep(action: Action, before: GameState, after: GameState): DraftEvent[] {
  if (!isFrameworkAction(action)) {
    const description = definitionFor(before).describeAction(action, before, after)
    return [{ playerId: action.playerId, message: description.message, redactedMessage: description.redactedMessage }]
  }
  switch (action.type) {
    case 'CONCEDE':
      return [{ playerId: action.playerId, message: `${PLAYER_PLACEHOLDER} conceded.` }]
    case 'UNDO_ACTION':
      return [{ playerId: action.playerId, message: action.playerId ? `${PLAYER_PLACEHOLDER} undid the last action.` : 'The last action was undone.' }]
    case 'REDO_ACTION':
      return [{ playerId: action.playerId, message: action.playerId ? `${PLAYER_PLACEHOLDER} redid an action.` : 'An action was redone.' }]
    case 'SET_ADMIN_MODE': {
      const onOff = action.enabled ? 'on' : 'off'
      return [{ playerId: action.playerId, message: action.playerId ? `${PLAYER_PLACEHOLDER} turned admin mode ${onOff}.` : `Admin mode turned ${onOff}.` }]
    }
  }
}

/** Lines the framework adds on its own when a step ends the game. */
function describeOutcome(before: GameState, after: GameState): DraftEvent[] {
  if (before.status === 'completed' || after.status !== 'completed') return []
  const names = after.winnerPlayerIds.map((id) => after.players.find((p) => p.id === id)?.displayName ?? id)
  return [{ playerId: null, message: names.length ? `Game over — ${names.join(' & ')} ${names.length > 1 ? 'win' : 'wins'}.` : 'Game over.' }]
}

/**
 * Rebuilds the game's narration log purely from `actionHistory` — nothing
 * about it is stored on GameState. Replays each raw entry from `genesis`,
 * deriving display lines from each step's before/after pair (including
 * forced follow-ups folded into the entry, via applyActionWithSteps).
 * UNDO_ACTION/REDO_ACTION entries aren't a forward step, so narrating one
 * re-derives the state with a full replayActions over the history so far.
 *
 * A HIDDEN_ACTION placeholder (a secret move that was later undone, kept in a
 * redacted client's log) is narrated without its details and not replayed.
 *
 * Returns the final replayed `state` too. `ok` is false if an entry failed to
 * reapply; the log stops there rather than throwing mid-render.
 */
export function buildGameLogFrom(genesis: GameState, actionHistory: LoggedAction[]): { state: GameState; events: GameEvent[]; ok: boolean } {
  const events: GameEvent[] = []
  let state = genesis
  let id = 1

  for (let index = 0; index < actionHistory.length; index++) {
    const logged = actionHistory[index]
    const before = state
    let after: GameState
    let drafts: DraftEvent[]
    if (logged.action.type === 'UNDO_ACTION' || logged.action.type === 'REDO_ACTION') {
      after = replayActions(genesis, actionHistory.slice(0, index + 1))
      drafts = describeStep(logged.action, before, after)
    } else if ((logged.action as { type: string }).type === 'HIDDEN_ACTION') {
      // A still-secret entry a redacted client keeps only because it was
      // undone later (unredactedPrefix, ./redaction.ts) — not a legal action,
      // and never in effect, so there's nothing to replay.
      const playerId = 'playerId' in logged.action ? logged.action.playerId : null
      after = before
      drafts = [{ playerId, message: playerId ? `${PLAYER_PLACEHOLDER} made a move.` : 'A move was made.' }]
    } else {
      const result = applyLoggedAction(before, logged)
      if (!result.ok) return { state, events, ok: false }
      after = result.state
      drafts = result.steps.flatMap((step) => describeStep(step.action, step.before, step.after))
    }
    drafts.push(...describeOutcome(before, after))

    for (const draft of drafts) {
      events.push({
        id: `evt_${id++}`,
        turn: logged.turn,
        playerId: draft.playerId,
        message: draft.message,
        timestamp: logged.timestamp,
        entryIndex: index,
        ...(draft.redactedMessage !== undefined ? { redactedMessage: draft.redactedMessage } : {}),
        ...(logged.viaAdminMode ? { adminMode: true } : {}),
      })
    }
    state = { ...after, actionHistory: actionHistory.slice(0, index + 1) }
  }

  return { state, events, ok: true }
}

/** Same as buildGameLogFrom, for a caller that only wants the log itself. */
export function buildGameLog(genesis: GameState, actionHistory: LoggedAction[]): GameEvent[] {
  return buildGameLogFrom(genesis, actionHistory).events
}
