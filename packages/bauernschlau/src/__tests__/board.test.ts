import { describe, expect, it } from 'vitest'
import {
  BOARD_RADIUS,
  borderStarts,
  canStillFinish,
  CELLS,
  cellLabel,
  CENTRE,
  FARM_POSITIONS,
  FARMHOUSES,
  farmFields,
  fenceMoves,
  FIELDS,
  fieldsOf,
  GRID_RADIUS,
  isOnBoard,
  cellOf,
  BONUS_FIELDS,
  DIRECTIONS,
  GEESE,
  hexDistance,
  isEdgeVertex,
  isOutwardStep,
  junction,
  occupiedVertices,
  vertexDepth,
  vertexNeighbours,
  vertexRing,
  type Border,
} from '../rules'
import { testRandom } from '../testing'

function bordersFor(players: number): Border[] {
  const pos = FARM_POSITIONS[players]
  return pos.map((p, i) => ({ between: ['a', 'b'], starts: borderStarts(p, pos[(i + 1) % players]), path: [], builtBy: [], finished: false }))
}

/** The current board's radius (rules version 3). */
const R = BOARD_RADIUS

function extend(borders: Border[], b: number, from: string, to: string, radius = R): Border[] {
  return borders.map((x, i) => (i === b ? { ...x, path: x.path.length > 0 ? [...x.path, to] : [from, to], builtBy: [...x.builtBy, 'a'], finished: isEdgeVertex(to, radius) } : x))
}

/** Random legal fences until every border is finished. */
function randomBorders(players: number, seed: number, radius = R): Border[] {
  const next = testRandom(seed)
  let borders = bordersFor(players)
  for (let guard = 0; guard < 500 && borders.some((b) => !b.finished); guard++) {
    const b = next() % players
    const moves = fenceMoves(borders, b, radius)
    if (moves.length === 0) continue
    const m = moves[next() % moves.length]
    borders = extend(borders, b, m.from, m.to, radius)
  }
  return borders
}

describe('§2 the board', () => {
  it('R-BOARD-01/02: radius 4 — 61 hexes, 54 fields, the centre and six farmhouses — numbered on the radius-5 grid', () => {
    expect(CELLS).toHaveLength(91)
    expect(CELLS.filter((_, c) => isOnBoard(c, R))).toHaveLength(61)
    expect(FIELDS).toHaveLength(54)
    expect(FIELDS).toEqual(fieldsOf(R))
    expect(FIELDS.every((c) => hexDistance(CELLS[c]) >= 2 && hexDistance(CELLS[c]) <= 4)).toBe(true)
    expect(hexDistance(CELLS[CENTRE])).toBe(0)
    expect(FARMHOUSES.map((c) => hexDistance(CELLS[c]))).toEqual([1, 1, 1, 1, 1, 1])
    // Labels count rows and columns on the board itself.
    expect(cellLabel(cellOf({ q: 0, r: -4 }), R)).toBe('A1')
    expect(cellLabel(CENTRE, R)).toBe('E5')
    expect(cellLabel(cellOf({ q: 0, r: 4 }), R)).toBe('I5')
  })

  it('rules versions 1 and 2: radius 5 — 91 hexes, 84 fields, and version 1’s six geese fields', () => {
    expect(fieldsOf(GRID_RADIUS)).toHaveLength(84)
    expect(CELLS.every((_, c) => isOnBoard(c, GRID_RADIUS))).toBe(true)
    expect([...GEESE].every((c) => fieldsOf(GRID_RADIUS).includes(c) && hexDistance(CELLS[c]) === 3)).toBe(true)
    expect(GEESE.size).toBe(6)
    expect(cellLabel(0, GRID_RADIUS)).toBe('A1')
    expect(cellLabel(CENTRE, GRID_RADIUS)).toBe('F6')
    expect(cellLabel(90, GRID_RADIUS)).toBe('K6')
  })

  it('R-BOARD-03: bonus fields — ring 2 between the diagonals ×2, ring 3 on them ×3, ring 4 midway between them ×3', () => {
    // A hex lies on a long diagonal when it's a multiple of one direction.
    const onDiagonal = (cell: number) => DIRECTIONS.some((d) => {
      const h = CELLS[cell]
      const k = hexDistance(h)
      return h.q === d.q * k && h.r === d.r * k
    })
    const byRing = (ring: number) => [...BONUS_FIELDS].filter(([c]) => hexDistance(CELLS[c]) === ring)
    expect(BONUS_FIELDS.size).toBe(18)
    expect([...BONUS_FIELDS.keys()].every((c) => FIELDS.includes(c))).toBe(true)
    const ring2 = byRing(2)
    expect(ring2).toHaveLength(6)
    expect(ring2.every(([c, x]) => x === 2 && !onDiagonal(c))).toBe(true)
    // Each sits where two farmhouses meet.
    expect(ring2.every(([c]) => FARMHOUSES.filter((f) => hexDistance({ q: CELLS[c].q - CELLS[f].q, r: CELLS[c].r - CELLS[f].r }) === 1).length === 2)).toBe(true)
    const ring3 = byRing(3)
    expect(ring3).toHaveLength(6)
    expect(ring3.every(([c, x]) => x === 3 && onDiagonal(c))).toBe(true)
    const ring4 = byRing(4)
    expect(ring4).toHaveLength(6)
    // Exactly midway: two steps from the corner on either side.
    const corners4 = DIRECTIONS.map((d) => ({ q: d.q * 4, r: d.r * 4 }))
    const dist = (a: { q: number; r: number }, b: { q: number; r: number }) => hexDistance({ q: a.q - b.q, r: a.r - b.r })
    expect(ring4.every(([c, x]) => x === 3 && corners4.filter((k) => dist(k, CELLS[c]) === 2).length === 2)).toBe(true)
  })

  it('vertices: three neighbours each, symmetric; junctions sit between two farmhouses', () => {
    for (let p = 0; p < 6; p++) {
      const j = junction(p)
      expect(vertexDepth(j)).toBe(4)
      expect(vertexRing(j)).toBe(1)
      for (const v of vertexNeighbours(j)) expect(vertexNeighbours(v)).toContain(j)
    }
    expect(new Set([0, 1, 2, 3, 4, 5].map(junction)).size).toBe(6)
  })

  it('R-FENCE-02: with fewer than six farms a border may start at any junction between its two farmhouses', () => {
    expect(borderStarts(0, 3)).toEqual([junction(0), junction(1), junction(2)])
    expect(borderStarts(4, 0)).toEqual([junction(4), junction(5)])
  })
})

describe('§6 fence lines', () => {
  it('R-FENCE-03: a step may not lead to an earlier ring boundary', () => {
    const j = junction(0)
    const inward = vertexNeighbours(j).find((v) => vertexRing(v) < 1)!
    expect(isOutwardStep(j, inward, true)).toBe(false)
  })

  it('R-FENCE-06: the shortest border is six fences (eight on the old radius-5 board); every finished set of borders splits the fields between the farms', () => {
    const straight = (from: string, radius: number): number =>
      isEdgeVertex(from, radius) ? 0 : 1 + Math.min(...vertexNeighbours(from).filter((v) => vertexDepth(v) > vertexDepth(from) && isOutwardStep(from, v, vertexDepth(from) === 4)).map((v) => straight(v, radius)))
    expect(straight(junction(0), R)).toBe(6)
    expect(straight(junction(0), GRID_RADIUS)).toBe(8)
    for (const [radius, fields] of [[R, 54], [GRID_RADIUS, 84]]) {
      for (const players of [2, 3, 4, 5, 6]) {
        for (const seed of [1, 2, 3]) {
          const borders = randomBorders(players, seed * 7 + players, radius)
          expect(borders.every((b) => b.finished)).toBe(true)
          const farms = FARM_POSITIONS[players].map((p) => farmFields(borders, p, radius))
          expect(farms.reduce((n, f) => n + f.length, 0)).toBe(fields)
          expect(new Set(farms.flat()).size).toBe(fields)
        }
      }
    }
  })

  it('R-FENCE-04/05: lines never touch, and a fence that would box another border in is not offered', () => {
    let cutOffs = 0
    // Fifteen random games find plenty of cut-offs; each is slow-ish to search, hence the explicit timeout.
    for (let seed = 1; seed <= 15; seed++) {
      const next = testRandom(seed)
      let borders = bordersFor(6)
      for (let guard = 0; guard < 300 && borders.some((b) => !b.finished); guard++) {
        const b = next() % 6
        const legal = fenceMoves(borders, b, R)
        const border = borders[b]
        const blocked = occupiedVertices(borders)
        const froms = border.path.length > 0 ? [border.path[border.path.length - 1]] : border.starts
        // Steps that pass every other test but still aren't offered are the cut-offs.
        for (const from of border.finished ? [] : froms) {
          for (const to of vertexNeighbours(from)) {
            if (blocked.has(to) || !isOutwardStep(from, to, border.path.length === 0) || legal.some((m) => m.to === to)) continue
            const after = extend(borders, b, from, to)
            expect(after.some((x) => !canStillFinish(x, occupiedVertices(after), R))).toBe(true)
            cutOffs++
          }
        }
        if (legal.length === 0) continue
        // Prefer sideways steps, which are what box lines in.
        const sideways = legal.filter((m) => vertexRing(m.to) === vertexRing(m.from))
        const pool = sideways.length > 0 && next() % 3 > 0 ? sideways : legal
        const m = pool[next() % pool.length]
        borders = extend(borders, b, m.from, m.to)
        const vertices = borders.flatMap((x) => x.path)
        expect(new Set(vertices).size).toBe(vertices.length)
      }
    }
    expect(cutOffs).toBeGreaterThan(0)
  }, 20_000)
})
