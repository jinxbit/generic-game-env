// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import { DIR_NAMES } from '../board.ts'
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

/** Circumradius of a drawn hex; hexes are drawn around (0, 0), pointy side up. */
export const HEX_R = 20
const APOTHEM = (HEX_R * Math.sqrt(3)) / 2

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** The hex outline as SVG polygon points. */
export const HEX_POINTS = [30, 90, 150, 210, 270, 330]
  .map((deg) => `${round(HEX_R * Math.cos((deg * Math.PI) / 180))},${round(HEX_R * Math.sin((deg * Math.PI) / 180))}`)
  .join(' ')

/** Midpoint of side `d` of a hex drawn around (0, 0) — 0 east, then clockwise. */
export function edgePoint(d: Dir): [number, number] {
  const angle = (d * Math.PI) / 3
  return [round(APOTHEM * Math.cos(angle)), round(APOTHEM * Math.sin(angle))]
}

/** SVG path of a road tile joining `ends`: straight across, or a curve through the centre. */
export function roadPath(ends: readonly [Dir, Dir]): string {
  const [a, b] = ends.map(edgePoint)
  return `M ${a[0]} ${a[1]} Q 0 0 ${b[0]} ${b[1]}`
}

export function shapeName(ends: readonly [Dir, Dir]): string {
  return `${DIR_NAMES[ends[0]]}–${DIR_NAMES[ends[1]]}${ends[1] - ends[0] === 3 ? ' (straight)' : ' (curve)'}`
}
