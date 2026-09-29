// Static game data for Magna Grecia: the map, the action cards and the step
// tracks. The map is the published board (as supplied: the 2023 redraw by
// Stephan Suhar) — a hex grid, pointy side up, rows A–P. The rulebook shows no
// card values, so the cards are this implementation's own design (RULES.md
// AMBIG-2).
//
// Hexes are addressed as on the board: a row letter and a column number
// 1–35 in "doubled" coordinates — each row uses every other column, odd in
// rows A, C, E, … and even in rows B, D, F, …, so a hex's east and west
// neighbours are two columns away and its diagonal neighbours one column away
// in the next row. A cell (what the rules store) is an index into HEXES.
//
// Server-reachable (imported by rules.ts): keep the `.ts` extensions.

import type { ActionCard, VillageSpace } from './types.ts'

/** R-BOARD-01: rows A–P. */
export const ROW_LETTERS = 'ABCDEFGHIJKLMNOP'
export const ROWS = ROW_LETTERS.length
/** Highest doubled column number on the board. */
export const MAX_COL = 35

/** Card colour names by slot (R-SETUP-04). */
export const SLOT_NAMES = ['yellow', 'orange', 'brown', 'red'] as const

/** Each row's hexes, as runs of columns (inclusive, every other column). */
const ROW_RUNS: [number, number][][] = [
  [
    [5, 17],
    [31, 35],
  ],
  [
    [6, 18],
    [26, 34],
  ],
  [[5, 35]],
  [[4, 34]],
  [[5, 33]],
  [[4, 32]],
  [[3, 33]],
  [[2, 34]],
  [[3, 33]],
  [[2, 34]],
  [[1, 33]],
  [[2, 34]],
  [[1, 33]],
  [[2, 32]],
  [[1, 33]],
  [[2, 32]],
]

/** R-BOARD-02: the green-bordered starting villages and the inland villages. */
const GREEN_VILLAGES = ['A5', 'A17', 'A33', 'B26', 'C21', 'G3', 'H34', 'P2', 'P18', 'P32']
const INLAND_VILLAGES = [
  'B12', 'D6', 'D16', 'D30', 'E9', 'F14', 'F26', 'G11', 'G19', 'G23', 'H16', 'H28', 'I7', 'I11', 'I19', 'J4',
  'J16', 'J24', 'J30', 'K9', 'K21', 'L14', 'L26', 'L32', 'M3', 'M7', 'M11', 'M17', 'M21', 'N28', 'O9', 'O23',
]

/** Every hex on the board, in reading order; a cell is an index into this. */
export const HEXES: readonly { row: number; col: number }[] = ROW_RUNS.flatMap((runs, row) =>
  runs.flatMap(([from, to]) => Array.from({ length: (to - from) / 2 + 1 }, (_, i) => ({ row, col: from + 2 * i }))),
)

export const CELLS = HEXES.length

const CELL_AT = new Map(HEXES.map((h, cell) => [h.row * 100 + h.col, cell]))

/** The cell at `row` (0-based) and doubled column `col`, or null off the board. */
export function cellAt(row: number, col: number): number | null {
  return CELL_AT.get(row * 100 + col) ?? null
}

/** "G3" — the board's own coordinates. */
export function cellLabel(cell: number): string {
  const h = HEXES[cell]
  return `${ROW_LETTERS[h.row]}${h.col}`
}

/** The cell a label like "G3" names. Throws for a hex that isn't on the board. */
export function cellOf(label: string): number {
  const cell = cellAt(ROW_LETTERS.indexOf(label[0]), Number(label.slice(1)))
  if (cell === null) throw new Error(`No hex ${label} on the board`)
  return cell
}

export const VILLAGES: readonly VillageSpace[] = [
  ...GREEN_VILLAGES.map((label) => ({ cell: cellOf(label), green: true })),
  ...INLAND_VILLAGES.map((label) => ({ cell: cellOf(label), green: false })),
].sort((a, b) => a.cell - b.cell)

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
