// Static game data for Magna Grecia: the map, the action cards and the step
// tracks. The rulebook shows neither the map nor the card values, so both
// are this implementation's own design (RULES.md AMBIG-1/2).
//
// Server-reachable (imported by rules.ts): keep the `.ts` extensions.

import type { ActionCard, VillageSpace } from './types.ts'

/** R-BOARD-01. */
export const ROWS = 13
export const COLS = 13
export const CELLS = ROWS * COLS

/** Card colour names by slot (R-SETUP-04). */
export const SLOT_NAMES = ['yellow', 'orange', 'brown', 'red'] as const

/**
 * The map (R-BOARD-02): `G` a green-bordered edge village, `v` an inland
 * village, `.` open land. No two villages touch, even diagonally.
 */
const MAP = [
  '. . G . . . . G . . . G .',
  '. . . . . . . . . . . . .',
  '. . . . v . . . . . v . .',
  'G . . . . . . v . . . . .',
  '. . . . . . . . . v . . G',
  '. . v . . v . . . . . . .',
  '. . . . . . . . v . . . .',
  '. . . . . . v . . . v . .',
  'G . . v . . . . . . . . .',
  '. . . . . . . v . . . . G',
  '. . . . v . . . . . v . .',
  '. . . . . . . . . . . . .',
  '. G . . . . G . . . . G .',
]

export const VILLAGES: readonly VillageSpace[] = MAP.flatMap((line, row) =>
  line
    .split(' ')
    .flatMap((ch, col) => (ch === 'G' || ch === 'v' ? [{ cell: row * COLS + col, green: ch === 'G' }] : [])),
)

/** Village spaces by cell, for lookups. */
export const VILLAGE_AT: ReadonlyMap<number, VillageSpace> = new Map(VILLAGES.map((v) => [v.cell, v]))

/** R-SETUP-02: oracles by player count. */
export function oracleCount(players: number): number {
  return players >= 4 ? 9 : 7
}

/** R-SETUP-03: starting points by player count. */
export function startingPoints(players: number): number {
  return players >= 4 ? 15 : players === 3 ? 12 : 10
}

/** R-SETUP-01. */
export const TILES_PER_KIND = 20
export const STARTING_SUPPLY = 4
export const MARKETS_PER_PLAYER = 20

/** R-END-01: points per oracle attending to one of a player's cities. */
export const ORACLE_POINTS = 4

/** R-CARD-02: step tracks; an enhanced action is the next step up. */
export const TRACKS = {
  roads: [1, 2, 3, 4, 5, 6],
  cities: [1, 2, 3, 4],
  resupply: [3, 4, 5, 7, 9],
} as const

export type ActionKind = keyof typeof TRACKS

/** The enhanced value of `value` on `kind`'s track (R-CARD-02). */
export function enhanced(kind: ActionKind, value: number): number {
  const track: readonly number[] = TRACKS[kind]
  const i = track.indexOf(value)
  return i >= 0 && i < track.length - 1 ? track[i + 1] : value
}

/** R-CARD-03: (roads, cities, resupply) of each border colour's three cards, and their orders. */
const VALUES: [number, number, number][] = [
  [3, 2, 5],
  [4, 1, 5],
  [2, 2, 7],
]
const ORDER_OFFSETS = [
  [0, 1, 2, 3],
  [0, 3, 2, 1],
  [0, 2, 1, 3],
]

export const CARDS: readonly ActionCard[] = [0, 1, 2, 3].flatMap((border) =>
  VALUES.map(([roads, cities, resupply], k) => ({
    id: border * 3 + k,
    border,
    order: ORDER_OFFSETS[k].map((offset) => (border + offset) % 4),
    roads,
    cities,
    resupply,
  })),
)

export function cardById(id: number): ActionCard {
  const card = CARDS[id]
  if (!card) throw new Error(`Unknown card: ${id}`)
  return card
}
