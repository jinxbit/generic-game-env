// History review's steps. The platform owns reviewing a game's history — one
// review mode, one stepper, one state per point — and steps through it at
// one of two sizes: every log entry ("moves"), or a turn at a time
// ("turns"). What a turn is belongs to the game (GameDefinition.reviewStops);
// a game that doesn't say gets one stop per round (LoggedAction.turn).
//
// Stops are positions in the log: stop `i` is the state after the first `i`
// entries, so 0 is genesis and `entries.length` is the live state. A step is
// the entries between two consecutive stops, which is what the game's view
// is handed to explain (GameViewProps.review, ./ui.ts).
//
// Works on a redacted viewer's log too: only each entry's action type, player
// and round are read, and a hidden entry's placeholder carries its player.

import type { AnyGameDefinition } from './gameDefinition.ts'

/** What a stop is computed from — every log entry has these, a HIDDEN_ACTION placeholder included. */
export interface ReviewEntry {
  action: { type: string; playerId?: string | null }
  turn: number
}

/** One stop per change of round (`turn`) — the fallback for a game without its own reviewStops. */
export function stopsByRound(entries: readonly ReviewEntry[]): number[] {
  const stops = [0]
  for (let i = 1; i < entries.length; i++) if (entries[i].turn !== entries[i - 1].turn) stops.push(i)
  return stops
}

/**
 * The stops for stepping `entries` a turn at a time: the game's own, or one
 * per round — always sorted, unique, within bounds, and starting at genesis
 * and ending at the live state, so a caller can step between any two.
 */
export function turnReviewStops(definition: AnyGameDefinition | null, entries: readonly ReviewEntry[]): number[] {
  let stops: number[]
  try {
    stops = definition?.reviewStops ? definition.reviewStops(entries) : stopsByRound(entries)
  } catch {
    stops = stopsByRound(entries)
  }
  const bounded = stops.filter((stop) => Number.isInteger(stop) && stop >= 0 && stop <= entries.length)
  return [...new Set([0, ...bounded, entries.length])].sort((a, b) => a - b)
}

/** Every position — stepping a move at a time. */
export function moveReviewStops(entries: readonly ReviewEntry[]): number[] {
  return Array.from({ length: entries.length + 1 }, (_, i) => i)
}

/**
 * Where review opens: the first stop after `playerId`'s own most recent entry
 * — "what happened since your last turn" — or genesis for a viewer who
 * hasn't acted (or isn't seated).
 */
export function sinceLastTurnStop(stops: readonly number[], entries: readonly ReviewEntry[], playerId: string | null): number {
  let after = 0
  if (playerId) {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].action.playerId === playerId) {
        after = i + 1
        break
      }
    }
  }
  return stops.find((stop) => stop >= after) ?? stops[stops.length - 1] ?? 0
}

/** The stop before `index` (where the step ending at `index` begins), or null at genesis. */
export function previousStop(stops: readonly number[], index: number): number | null {
  let previous: number | null = null
  for (const stop of stops) {
    if (stop >= index) break
    previous = stop
  }
  return previous
}

/** The stop after `index`, or null at the live state. */
export function nextStop(stops: readonly number[], index: number): number | null {
  return stops.find((stop) => stop > index) ?? null
}
