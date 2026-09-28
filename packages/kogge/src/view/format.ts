// Pure helpers shared by the view components — no React.

import type { SeatInfo } from '@game-platform/sdk/ui'
import { CITIES } from '../rules.ts'
import type { GameState } from '../rules.ts'
import type { Color, RouteSlot } from '../types.ts'

/** Swatch colours for the four goods (and the markers of their cities). */
export const COLOR_HEX: Record<Color, string> = { grey: '#9ca3af', orange: '#f97316', purple: '#a855f7', white: '#f5f5f5' }

export function nameOf(players: SeatInfo[], id: string): string {
  return players.find((p) => p.id === id)?.display_name ?? 'Someone'
}

export function colorOf(players: SeatInfo[], id: string): string {
  return players.find((p) => p.id === id)?.color ?? '#737373'
}

export function cityLabel(city: number): string {
  return `${CITIES[city].name} (${city})`
}

/**
 * A face-down marker's number is shown only to whoever placed it — even when
 * the state on this device holds it (hotseat, or hidden information off).
 */
export function visibleRoute(state: GameState, slot: RouteSlot, myPlayerId: string | null): number | null {
  if (!slot.faceDown || state.status === 'completed') return slot.value
  return slot.placedBy === myPlayerId ? slot.value : null
}
