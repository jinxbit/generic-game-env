// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import type { Colour, ColourFace } from '../types.ts'

export const COLOUR_HEX: Record<ColourFace, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  white: '#f5f5f5',
}

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const INPUT = 'rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50'

export function nameOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Unknown'
}

export function seatColourOf(players: SeatInfo[], id: string): string {
  return players.find((p) => p.id === id)?.color ?? '#737373'
}

export function titleCase(colour: Colour): string {
  return colour[0].toUpperCase() + colour.slice(1)
}
