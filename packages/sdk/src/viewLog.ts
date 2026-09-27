// The per-viewer view log: how a hidden-information game gives every player
// the whole log, undo/redo and history review, while sending little more
// than what changed.
//
// WHY: the earlier read protocol had each client replay the log entries it
// was allowed to see and patch over the rest with its masked state (the
// in-flight overlay, ./inFlightOverlay.ts). That works when secrets are short
// (a pick hidden until the round ends), but a secret that lives for most of a
// game — a card in a hand — hides every entry that touched it, so a player's
// replayable log stopped at the first one: the game log and history review
// went blank, and every read carried the whole masked state. Measured on a
// 4-player card game, players could replay 1-2 of 33 entries three quarters
// of the way through.
//
// THE DESIGN: a client of such a game never runs the rules. When the server
// writes an entry it already holds the state before and after it, so it
// records on the entry, for each viewer:
//
//   - `views.common` / `views.byViewer`: the structural patch (./statePatch.ts)
//     from that viewer's view of the state before the entry to their view
//     after it (viewOf — the game's own redactGame, the envelope, no log);
//   - `views.flips`: earlier entries whose secrecy for that viewer changed
//     with this one (a reveal at the end of a round; an undo re-hiding it);
//   - `lines`: the entry's narration, both the full and the redacted wording.
//
// All of it is computed from states already in memory and stored in the same
// row write — no extra round trip, no replay on read. A read is a slice of
// the stored log: each entry in the viewer's form (viewerEntry) — the action
// or a placeholder, the narration they may read, their own patch — and a
// client folds the patches onto its view (applyViewerEntries). Undo and redo
// are entries like any other, patches and all. History review is the same
// fold stopped early, from the viewer's view of genesis.
//
// Everything a viewer receives is derived from what they may see: patches
// are between redacted views, narration is picked by isActionSecret, and the
// random numbers an entry drew are never sent (they'd let a client recompute
// what redaction hides). `views` and `lines` themselves are server-side only:
// redactStateForPlayer (./redaction.ts) strips them.

import type { Action, LoggedAction } from './actions.ts'
import { narrateEntry, PLAYER_PLACEHOLDER, type LogLine } from './gameLog.ts'
import { definitionFor } from './registry.ts'
import { applyStatePatch, diffState, type StatePatch } from './statePatch.ts'
import type { GameEvent, GameState } from './types.ts'

/** A viewer's view of a state: everything but the log, with the game's secrets masked for them. */
export type PlayerView = Omit<GameState, 'actionHistory'>

/** Key under which a spectator's (viewerId null) patch and flips are stored. */
export const SPECTATOR_KEY = '~'

/** What a log entry records about how each viewer's view changed — see this module's doc comment. */
export interface EntryViews {
  /** The patch for every viewer not listed in `byViewer`. */
  common: StatePatch
  /** Viewers whose patch differs from `common`, keyed by player id (SPECTATOR_KEY for spectators). */
  byViewer?: Record<string, StatePatch>
  /** Per viewer key: indices of earlier entries whose secrecy for them flipped with this entry. */
  flips?: Record<string, number[]>
}

/** One log entry as a particular viewer receives it. */
export interface ViewerLogEntry {
  action: Action | { type: 'HIDDEN_ACTION'; playerId: string | null }
  turn: number
  timestamp: string
  viaAdminMode?: boolean
  /** The entry's narration as this viewer may read it. */
  lines: { playerId: string | null; message: string }[]
  /** Their view before this entry → after it. Omitted when an entry is re-sent only because its secrecy changed. */
  patch?: StatePatch
}

function viewerKey(viewerId: string | null): string {
  return viewerId ?? SPECTATOR_KEY
}

/** Everyone a view is kept for: each seated player, and spectators. */
export function viewersOf(state: GameState): (string | null)[] {
  return [...state.players.map((p) => p.id), null]
}

/**
 * `viewerId`'s view of `state` — the game's redactGame applied, no log, and
 * no `setupRandom`: a viewer receives genesis as a view too, so the numbers
 * setup drew never need to reach them (and setup may deal secrets).
 */
export function viewOf(state: GameState, viewerId: string | null): PlayerView {
  const { actionHistory, setupRandom, ...rest } = state
  void actionHistory
  void setupRandom
  return { ...rest, game: definitionFor(state).redactGame(state, viewerId) }
}

/** Whether every entry of a log carries a recorded view — what the view protocol needs; a game started before it has none. */
export function hasViewLog(history: LoggedAction[]): boolean {
  return history.every((entry) => entry.views !== undefined)
}

/**
 * Records `after`'s newest log entry's views and narration, given the state
 * `before` it. Called by the server for every entry it writes to a
 * hidden-information game, with the states it already holds. `steps` narrates
 * forced follow-ups folded into the entry (applyActionWithSteps).
 */
export function recordEntryViews(before: GameState, after: GameState, steps?: { action: Action; before: GameState; after: GameState }[]): GameState {
  const index = after.actionHistory.length - 1
  const entry = after.actionHistory[index]
  const game = definitionFor(after)
  const viewers = viewersOf(after)

  const patches = new Map<string, StatePatch>()
  const flips: Record<string, number[]> = {}
  for (const viewer of viewers) {
    patches.set(viewerKey(viewer), diffState(viewOf(before, viewer), viewOf(after, viewer)))
    const flipped: number[] = []
    for (let i = 0; i < index; i++) {
      const earlier = after.actionHistory[i]
      if (game.isActionSecret(earlier, before, viewer) !== game.isActionSecret(earlier, after, viewer)) flipped.push(i)
    }
    if (flipped.length > 0) flips[viewerKey(viewer)] = flipped
  }

  // Most viewers usually see the same change (the public part of a move);
  // store that once and only the exceptions per viewer.
  const counts = new Map<string, { patch: StatePatch; keys: string[] }>()
  for (const [key, patch] of patches) {
    const json = JSON.stringify(patch)
    const bucket = counts.get(json) ?? { patch, keys: [] }
    bucket.keys.push(key)
    counts.set(json, bucket)
  }
  const common = [...counts.values()].sort((a, b) => b.keys.length - a.keys.length)[0]
  const byViewer: Record<string, StatePatch> = {}
  for (const bucket of counts.values()) {
    if (bucket === common) continue
    for (const key of bucket.keys) byViewer[key] = bucket.patch
  }

  const views: EntryViews = {
    common: common.patch,
    ...(Object.keys(byViewer).length > 0 ? { byViewer } : {}),
    ...(Object.keys(flips).length > 0 ? { flips } : {}),
  }
  const lines = narrateEntry(entry, before, after, steps)
  const recorded: LoggedAction = { ...entry, views, lines }
  return { ...after, actionHistory: [...after.actionHistory.slice(0, index), recorded] }
}

/** The patch `viewerId` gets for a recorded entry. */
export function patchFor(entry: LoggedAction, viewerId: string | null): StatePatch {
  const views = entry.views
  if (!views) throw new Error('This log entry has no recorded views.')
  const key = viewerKey(viewerId)
  return views.byViewer && key in views.byViewer ? views.byViewer[key] : views.common
}

/**
 * A recorded entry as `viewerId` may receive it, judged against the current
 * state: the action (or a HIDDEN_ACTION placeholder while it's secret from
 * them), the narration they may read, and — unless `withPatch` is false —
 * their patch. Never the entry's random numbers, its other viewers' patches,
 * or the full wording of a line still secret from them.
 */
export function viewerEntry(entry: LoggedAction, state: GameState, viewerId: string | null, withPatch = true): ViewerLogEntry {
  const secret = definitionFor(state).isActionSecret(entry, state, viewerId)
  const playerId = 'playerId' in entry.action && typeof entry.action.playerId === 'string' ? entry.action.playerId : null
  const lines = (entry.lines ?? []).map((line: LogLine) => ({
    playerId: line.playerId,
    message: secret ? (line.redactedMessage ?? (line.playerId ? `${PLAYER_PLACEHOLDER} made a move.` : 'A move was made.')) : line.message,
  }))
  return {
    action: secret ? { type: 'HIDDEN_ACTION', playerId } : entry.action,
    turn: entry.turn,
    timestamp: entry.timestamp,
    ...(entry.viaAdminMode ? { viaAdminMode: true } : {}),
    lines,
    ...(withPatch ? { patch: patchFor(entry, viewerId) } : {}),
  }
}

/**
 * Entries before `from` whose secrecy for `viewerId` changed in any entry
 * from `from` on — what a client holding the log up to `from` must be sent
 * again, in their current form, to stay in step. Read from the recorded
 * flips; no replay.
 */
export function flippedSince(history: LoggedAction[], from: number, viewerId: string | null): number[] {
  const key = viewerKey(viewerId)
  const indices = new Set<number>()
  for (let i = from; i < history.length; i++) {
    for (const index of history[i].views?.flips?.[key] ?? []) if (index < from) indices.add(index)
  }
  return [...indices].sort((a, b) => a - b)
}

/** Folds entries' patches onto a view, in order — how a client moves its view forward, or rebuilds a past one for history review. */
export function applyViewerEntries(view: PlayerView, entries: readonly Pick<ViewerLogEntry, 'patch'>[]): PlayerView {
  return entries.reduce((current, entry) => applyStatePatch(current, entry.patch ?? null), view)
}

/** The game log from viewer entries' own narration — no replay. */
export function buildGameLogFromViewerEntries(entries: readonly ViewerLogEntry[]): GameEvent[] {
  let id = 1
  return entries.flatMap((entry, entryIndex) =>
    entry.lines.map((line) => ({
      id: `evt_${id++}`,
      turn: entry.turn,
      playerId: line.playerId,
      message: line.message,
      timestamp: entry.timestamp,
      entryIndex,
      ...(entry.viaAdminMode ? { adminMode: true } : {}),
    })),
  )
}
