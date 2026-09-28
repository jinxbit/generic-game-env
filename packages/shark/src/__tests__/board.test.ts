// RULES.md §2 (board), §4 (prices) and §6 placement legality — pure board functions.

import { describe, expect, it } from 'vitest'
import { cellOf, cellsInZone, groupSizes, legalPlacements, neighbours, previewPlacement, priceOf, type Board } from '../board'
import type { Colour } from '../types'

/** A board from `[row, col, colour]` triples. */
function boardWith(...markers: [number, number, Colour][]): Board {
  const board: (Colour | null)[] = Array.from({ length: 120 }, () => null)
  for (const [row, col, colour] of markers) board[cellOf(row, col)] = colour
  return board
}

function line(row: number, from: number, to: number, colour: Colour): [number, number, Colour][] {
  return Array.from({ length: to - from + 1 }, (_, i) => [row, from + i, colour] as [number, number, Colour])
}

describe('R-BOARD: geometry', () => {
  it('R-BOARD-02: six zones of 4 × 5, numbered 1–3 on top and 4–6 below', () => {
    for (let zone = 1; zone <= 6; zone++) expect(cellsInZone(zone)).toHaveLength(20)
    expect(cellsInZone(1)).toContain(cellOf(0, 0))
    expect(cellsInZone(2)).toContain(cellOf(0, 4))
    expect(cellsInZone(3)).toContain(cellOf(4, 11))
    expect(cellsInZone(4)).toContain(cellOf(5, 0))
    expect(cellsInZone(6)).toContain(cellOf(9, 11))
  })

  it('R-BOARD-03: orthogonal neighbours only, and zone borders do not split groups', () => {
    expect(neighbours(cellOf(0, 0)).sort((a, b) => a - b)).toEqual([cellOf(0, 1), cellOf(1, 0)])
    expect(neighbours(cellOf(5, 5))).toHaveLength(4)
    expect(neighbours(cellOf(5, 5))).not.toContain(cellOf(6, 6))
    // Zone 1 (col 3) and zone 2 (col 4) touch.
    expect(groupSizes(boardWith([0, 3, 'red'], [0, 4, 'red']), 'red')).toEqual([2])
    expect(groupSizes(boardWith([0, 0, 'red'], [1, 1, 'red']), 'red')).toEqual([1, 1])
  })
})

describe('§4: share price from the board', () => {
  it('R-PRICE-03/02: no marker is 0; the first marker starts the price at 1; more isolated markers keep it at 1', () => {
    expect(priceOf(boardWith(), 'blue')).toBe(0)
    expect(priceOf(boardWith([0, 0, 'blue']), 'blue')).toBe(1)
    expect(priceOf(boardWith([0, 0, 'blue'], [5, 5, 'blue']), 'blue')).toBe(1)
  })

  it('R-PRICE-01: groups of two or more count their size — 3 then a second group of 2 makes 5 (§6.1 example)', () => {
    expect(priceOf(boardWith(...line(0, 0, 2, 'red')), 'red')).toBe(3)
    expect(priceOf(boardWith(...line(0, 0, 2, 'red'), ...line(9, 0, 1, 'red')), 'red')).toBe(5)
  })

  it('§6.2 important point 1: a group of 4 and an isolated marker price at 4, not 5', () => {
    expect(priceOf(boardWith(...line(0, 0, 3, 'yellow'), [9, 9, 'yellow']), 'yellow')).toBe(4)
  })

  it('R-PRICE-01: a group counts for at most 7, but two groups of 7 both count', () => {
    expect(priceOf(boardWith(...line(0, 0, 8, 'green')), 'green')).toBe(7)
    expect(priceOf(boardWith(...line(0, 0, 6, 'green'), ...line(9, 0, 6, 'green')), 'green')).toBe(14)
  })

  it('R-PRICE-04: the price stops at 15', () => {
    expect(priceOf(boardWith(...line(0, 0, 6, 'green'), ...line(9, 0, 6, 'green'), ...line(5, 0, 1, 'green')), 'green')).toBe(15)
    expect(priceOf(boardWith(...line(0, 0, 6, 'green'), ...line(9, 0, 6, 'green'), ...line(5, 0, 6, 'green')), 'green')).toBe(15)
  })
})

describe('§6: placement legality', () => {
  it('R-PLACE-01: a taken box is refused', () => {
    expect(previewPlacement(boardWith([0, 0, 'red']), cellOf(0, 0), 'blue').legal).toBe(false)
  })

  it('R-PLACE-04: joining groups counts every group touched once', () => {
    const board = boardWith(...line(0, 0, 1, 'red'), [0, 3, 'red'], [1, 2, 'red'])
    expect(previewPlacement(board, cellOf(0, 2), 'red')).toEqual({ legal: true, groupSize: 5, eliminated: [] })
  })

  it('R-PLACE-05: touching a rival group of equal size or more is prohibited', () => {
    // A lone blue next to a lone red: 1 is not more than 1.
    expect(previewPlacement(boardWith([0, 0, 'red']), cellOf(0, 1), 'blue').legal).toBe(false)
    // Blue group of 2 would face a red group of 2.
    const board = boardWith([0, 0, 'blue'], ...line(1, 1, 2, 'red'))
    expect(previewPlacement(board, cellOf(0, 1), 'blue').legal).toBe(false)
  })

  it('R-PLACE-05: a bigger group eliminates every weaker neighbouring group', () => {
    const board = boardWith(...line(0, 0, 1, 'blue'), [1, 2, 'red'], [0, 3, 'yellow'])
    const preview = previewPlacement(board, cellOf(0, 2), 'blue')
    expect(preview.legal).toBe(true)
    expect(preview.groupSize).toBe(3)
    expect(preview.eliminated.sort((a, b) => a - b)).toEqual([cellOf(0, 3), cellOf(1, 2)])
  })

  it('R-PLACE-05: one rival group too big blocks the placement even if another could be eliminated', () => {
    const board = boardWith(...line(0, 0, 1, 'blue'), [1, 2, 'red'], ...line(0, 3, 5, 'yellow'))
    expect(previewPlacement(board, cellOf(0, 2), 'blue').legal).toBe(false)
  })

  it('legalPlacements lists every box and colour a roll allows', () => {
    expect(legalPlacements(boardWith(), 1, ['red'])).toHaveLength(20)
    expect(legalPlacements(boardWith(), 1, ['red', 'blue', 'green', 'yellow'])).toHaveLength(80)
  })
})
