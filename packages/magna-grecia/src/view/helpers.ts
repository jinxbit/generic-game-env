// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import type { Dir } from '../types.ts'

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_ACTIVE = 'rounded-md border border-indigo-400 bg-indigo-900/60 px-3 py-1.5 text-sm'
export const INPUT = 'rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50'

export function nameOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Unknown'
}

export function seatColourOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.color ?? '#737373'
}

/** Midpoint of side `d` of a 40 × 40 cell. */
export function edgePoint(d: Dir): [number, number] {
  return [
    [20, 0],
    [40, 20],
    [20, 40],
    [0, 20],
  ][d] as [number, number]
}

/** SVG path of a road tile joining `ends` in a 40 × 40 cell: a line, or a quarter curve. */
export function roadPath(ends: readonly [Dir, Dir]): string {
  const [a, b] = ends.map(edgePoint)
  return `M ${a[0]} ${a[1]} Q 20 20 ${b[0]} ${b[1]}`
}

export function shapeName(ends: readonly [Dir, Dir]): string {
  const names = ['north', 'east', 'south', 'west']
  return `${names[ends[0]]}–${names[ends[1]]}${ends[1] - ends[0] === 2 ? ' (straight)' : ' (curve)'}`
}
