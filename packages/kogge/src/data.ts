// Kogge's board and component counts (RULES.md §1) — data only, so the logic
// never names a city. Server-safe: imported by the Edge Functions.

import type { BonusType, Color } from './types.ts'

export const COLORS: readonly Color[] = ['grey', 'orange', 'purple', 'white']

export interface CityInfo {
  /** 0–8, clockwise around the board (R-BRD-01). */
  id: number
  name: string
  color: Color
}

/** R-BRD-01: the nine cities, in clockwise (= number) order. */
export const CITIES: readonly CityInfo[] = [
  { id: 0, name: 'Tönsberg', color: 'grey' },
  { id: 1, name: 'Stockholm', color: 'grey' },
  { id: 2, name: 'Åbo', color: 'grey' },
  { id: 3, name: 'Reval', color: 'orange' },
  { id: 4, name: 'Riga', color: 'orange' },
  { id: 5, name: 'Danzig', color: 'purple' },
  { id: 6, name: 'Stralsund', color: 'purple' },
  { id: 7, name: 'Lübeck', color: 'white' },
  { id: 8, name: 'Kopenhagen', color: 'white' },
]

export const CITY_COUNT = CITIES.length

/** A route marker's colour: the colour of the city with its number. */
export function markerColor(value: number): Color {
  return CITIES[value].color
}

/** R-BRD-02: route markers in the game, by value (index = number). */
export const MARKER_COUNTS: readonly number[] = [14, 13, 12, 11, 10, 9, 8, 7, 6]

/** R-BRD-02: goods in the game, by colour. */
export const GOODS_COUNTS: Readonly<Record<Color, number>> = { grey: 25, orange: 18, purple: 13, white: 10 }

export const BONUS_TYPES: readonly BonusType[] = ['trading', 'route', 'moves', 'passage']

export const BONUS_INFO: Readonly<Record<BonusType, { name: string; text: string }>> = {
  trading: { name: '3:1 Trading', text: 'Trading with a city takes 3 goods instead of 2.' },
  route: { name: '+1 Route marker', text: 'Draw a random route marker at the start of each round.' },
  moves: { name: 'Move 2 spaces', text: 'Your second move is free.' },
  passage: { name: 'Secret Passage', text: 'Move to the Guildmaster’s city from anywhere, for one extra good or marker.' },
}

/** Copies of each bonus marker. */
export const BONUS_COPIES = 2

/** R-END-04: victory points per good. */
export const GOOD_VP: Readonly<Record<Color, number>> = { grey: 1, orange: 3, purple: 5, white: 7 }
export const HOUSE_VP = 10
export const RAID_VP = 10
export const BONUS_VP = 20

/** R-END-02 */
export const DP_TO_WIN = 5
/** R-END-03 */
export const GUILDMASTER_LAPS = 2
/** R-AUC-01 */
export const LOT_COUNT = 4
export const LOT_SIZE = 2
/** R-SET-01 */
export const START_CITY_GOODS = 3
/** R-SET-02 */
export const START_GOODS: Readonly<Record<Color, number>> = { grey: 2, orange: 1, purple: 0, white: 0 }
/** R-AUC-07, R-GM-01 */
export const GOODS_PER_MARKER = 2
export const GUILDMASTER_GOODS = 2
/** R-ACT-02 */
export const RAID_MARKER_COST = 3
export const BONUS_GOODS_COST = 6
