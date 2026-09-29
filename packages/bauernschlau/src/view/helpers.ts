// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import { CELLS, vertexHexes, type Hex } from '../rules.ts'

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'

export function nameOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Unknown'
}

export function seatColourOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.color ?? '#737373'
}

/** Hex size (centre to corner) in SVG units. */
export const HEX_SIZE = 22

/** A pointy-top hex's centre. */
export function hexCentre(h: Hex): { x: number; y: number } {
  return { x: HEX_SIZE * Math.sqrt(3) * (h.q + h.r / 2), y: HEX_SIZE * 1.5 * h.r }
}

export function cellCentre(cell: number): { x: number; y: number } {
  return hexCentre(CELLS[cell])
}

/** A vertex lies at the average of its three hexes' centres. */
export function vertexPoint(key: string): { x: number; y: number } {
  const cs = vertexHexes(key).map(hexCentre)
  return { x: (cs[0].x + cs[1].x + cs[2].x) / 3, y: (cs[0].y + cs[1].y + cs[2].y) / 3 }
}

/** The SVG `points` of the hex at `cell`. */
export function hexPoints(cell: number): string {
  const { x, y } = cellCentre(cell)
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 90)
    return `${(x + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(y + HEX_SIZE * Math.sin(angle)).toFixed(2)}`
  }).join(' ')
}
