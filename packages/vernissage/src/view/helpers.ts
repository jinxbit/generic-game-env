// Pure helpers shared by the view components — no React state, no rules.

import type { SeatInfo } from '@game-platform/sdk/ui'
import type { ArtistId, Card, CardSlot, CounterKind } from '../types.ts'

export const ARTIST_HEX: Record<ArtistId, string> = {
  krach: '#e11d48',
  boyz: '#2563eb',
  kali: '#16a34a',
  hering: '#d97706',
  lightenstone: '#9333ea',
}

export const KIND_LABEL: Record<CounterKind, string> = { purchase: 'Purchase', criticism: 'Criticism', scandal: 'Scandal' }
export const KIND_ICON: Record<CounterKind, string> = { purchase: '🖼', criticism: '✎', scandal: '📷' }

export const BTN = 'rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'
export const BTN_PRIMARY = 'rounded-md border border-indigo-500 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
export const INPUT = 'rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50'

export function nameOf(players: SeatInfo[], id: string | null): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Unknown'
}

export function seatColourOf(players: SeatInfo[], id: string): string {
  return players.find((p) => p.id === id)?.color ?? '#737373'
}

export function known(cards: readonly CardSlot[]): Card[] {
  return cards.filter((c): c is Card => c !== null)
}

/** "+3" / "−4". */
export function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`
}
