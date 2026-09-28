// Board geometry, groups, prices and placement legality (RULES.md §2, §4,
// §6) — pure functions of a board, shared by the rules and the view.

import type { Colour } from './types.ts'

export const COLOURS: readonly Colour[] = ['blue', 'green', 'red', 'yellow']
export const COLS = 12
export const ROWS = 10
export const ZONE_COLS = 4
export const ZONE_ROWS = 5
export const MARKERS_PER_COLOUR = 20
/** 15 one-share + 5 five-share certificates per colour (RULES.md §1). */
export const SHARES_PER_COLOUR = 40
export const MAX_PRICE = 15
/** A group counts for at most this many price levels (R-PRICE-01). */
export const GROUP_CAP = 7
/** F.T. per price level. */
export const PRICE_UNIT = 1000
/** R-PAY-01: the isolated-marker bonus. */
export const ISOLATED_BONUS = 1000
/** R-SHARE-02. */
export const MAX_BUY_PER_TURN = 5

export type Board = readonly (Colour | null)[]

export function cellOf(row: number, col: number): number {
  return row * COLS + col
}

export function rowOf(cell: number): number {
  return Math.floor(cell / COLS)
}

export function colOf(cell: number): number {
  return cell % COLS
}

/** R-BOARD-02: 1–3 across the top half, 4–6 across the bottom. */
export function zoneOf(cell: number): number {
  return Math.floor(rowOf(cell) / ZONE_ROWS) * (COLS / ZONE_COLS) + Math.floor(colOf(cell) / ZONE_COLS) + 1
}

export function cellsInZone(zone: number): number[] {
  const cells: number[] = []
  for (let cell = 0; cell < ROWS * COLS; cell++) if (zoneOf(cell) === zone) cells.push(cell)
  return cells
}

export function isCell(cell: unknown): cell is number {
  return typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < ROWS * COLS
}

/** R-BOARD-03: orthogonal neighbours; zone borders don't matter. */
export function neighbours(cell: number): number[] {
  const row = rowOf(cell)
  const col = colOf(cell)
  const out: number[] = []
  if (row > 0) out.push(cell - COLS)
  if (row < ROWS - 1) out.push(cell + COLS)
  if (col > 0) out.push(cell - 1)
  if (col < COLS - 1) out.push(cell + 1)
  return out
}

/** R-BOARD-04: the group containing `cell` (empty if the box is empty), in flood order. */
export function groupAt(board: Board, cell: number): number[] {
  const colour = board[cell]
  if (!colour) return []
  const seen = new Set([cell])
  const queue = [cell]
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbours(queue[i])) {
      if (!seen.has(next) && board[next] === colour) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return queue
}

/** Every group of `colour` on the board, as their sizes. */
export function groupSizes(board: Board, colour: Colour): number[] {
  const seen = new Set<number>()
  const sizes: number[] = []
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== colour || seen.has(cell)) continue
    const group = groupAt(board, cell)
    for (const c of group) seen.add(c)
    sizes.push(group.length)
  }
  return sizes
}

/** R-PRICE-01..04. */
export function priceOf(board: Board, colour: Colour): number {
  const sizes = groupSizes(board, colour)
  if (sizes.length === 0) return 0
  const sum = sizes.filter((size) => size >= 2).reduce((total, size) => total + Math.min(size, GROUP_CAP), 0)
  return Math.min(MAX_PRICE, Math.max(1, sum))
}

export function pricesOf(board: Board): Record<Colour, number> {
  return { blue: priceOf(board, 'blue'), green: priceOf(board, 'green'), red: priceOf(board, 'red'), yellow: priceOf(board, 'yellow') }
}

/** What placing `colour` at `cell` would do, legal or not. */
export interface PlacementPreview {
  legal: boolean
  /** Why not, when illegal. */
  reason?: string
  /** Size of the group the new marker would belong to. */
  groupSize: number
  /** Boxes the placement would clear (R-PLACE-05). */
  eliminated: number[]
}

/** R-PLACE-01..05, except the zone check (the caller knows the roll). */
export function previewPlacement(board: Board, cell: number, colour: Colour): PlacementPreview {
  if (!isCell(cell)) return { legal: false, reason: 'That box is not on the board.', groupSize: 0, eliminated: [] }
  if (board[cell] !== null) return { legal: false, reason: 'That box is taken.', groupSize: 0, eliminated: [] }
  const own = new Set<number>()
  const rivals: number[][] = []
  const counted = new Set<number>()
  for (const next of neighbours(cell)) {
    if (board[next] === null || counted.has(next)) continue
    const group = groupAt(board, next)
    for (const c of group) counted.add(c)
    if (board[next] === colour) for (const c of group) own.add(c)
    else rivals.push(group)
  }
  const groupSize = own.size + 1
  const blocker = rivals.find((group) => group.length >= groupSize)
  if (blocker) {
    return {
      legal: false,
      reason: `A group of ${groupSize} can't displace a neighbouring ${board[blocker[0]]} group of ${blocker.length}.`,
      groupSize,
      eliminated: [],
    }
  }
  return { legal: true, groupSize, eliminated: rivals.flat() }
}

/** The legal placements for a roll in `zone` of `colours`. */
export function legalPlacements(board: Board, zone: number, colours: readonly Colour[]): { cell: number; colour: Colour }[] {
  const out: { cell: number; colour: Colour }[] = []
  for (const cell of cellsInZone(zone)) {
    for (const colour of colours) if (previewPlacement(board, cell, colour).legal) out.push({ cell, colour })
  }
  return out
}

/** "C7 (zone 2)" — column letter, row number (1-based). */
export function cellLabel(cell: number): string {
  return `${String.fromCharCode(65 + colOf(cell))}${rowOf(cell) + 1}`
}
