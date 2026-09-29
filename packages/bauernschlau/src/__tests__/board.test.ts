import { describe, expect, it } from 'vitest'
import {
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

function extend(borders: Border[], b: number, from: string, to: string): Border[] {
  return borders.map((x, i) => (i === b ? { ...x, path: x.path.length > 0 ? [...x.path, to] : [from, to], builtBy: [...x.builtBy, 'a'], finished: isEdgeVertex(to) } : x))
}

/** Random legal fences until every border is finished. */
function randomBorders(players: number, seed: number): Border[] {
  const next = testRandom(seed)
  let borders = bordersFor(players)
  for (let guard = 0; guard < 500 && borders.some((b) => !b.finished); guard++) {
    const b = next() % players
    const moves = fenceMoves(borders, b)
    if (moves.length === 0) continue
    const m = moves[next() % moves.length]
    borders = extend(borders, b, m.from, m.to)
  }
  return borders
}

describe('§2 the board', () => {
  it('R-BOARD-01..03: 91 hexes, 84 fields, the centre, six farmhouses and six geese fields', () => {
    expect(CELLS).toHaveLength(91)
    expect(FIELDS).toHaveLength(84)
    expect(hexDistance(CELLS[CENTRE])).toBe(0)
    expect(FARMHOUSES.map((c) => hexDistance(CELLS[c]))).toEqual([1, 1, 1, 1, 1, 1])
    expect([...GEESE].every((c) => FIELDS.includes(c) && hexDistance(CELLS[c]) === 3)).toBe(true)
    expect(GEESE.size).toBe(6)
    expect(cellLabel(0)).toBe('A1')
    expect(cellLabel(CENTRE)).toBe('F6')
    expect(cellLabel(90)).toBe('K6')
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

  it('R-FENCE-06: the shortest border is eight fences; every finished set of borders splits the 84 fields between the farms', () => {
    const straight = (from: string): number => (isEdgeVertex(from) ? 0 : 1 + Math.min(...vertexNeighbours(from).filter((v) => vertexDepth(v) > vertexDepth(from) && isOutwardStep(from, v, vertexDepth(from) === 4)).map(straight)))
    expect(straight(junction(0))).toBe(8)
    for (const players of [2, 3, 4, 5, 6]) {
      for (const seed of [1, 2, 3]) {
        const borders = randomBorders(players, seed * 7 + players)
        expect(borders.every((b) => b.finished)).toBe(true)
        const farms = FARM_POSITIONS[players].map((p) => farmFields(borders, p))
        expect(farms.reduce((n, f) => n + f.length, 0)).toBe(84)
        expect(new Set(farms.flat()).size).toBe(84)
      }
    }
  })

  it('R-FENCE-04/05: lines never touch, and a fence that would box another border in is not offered', () => {
    let cutOffs = 0
    for (let seed = 1; seed <= 40; seed++) {
      const next = testRandom(seed)
      let borders = bordersFor(6)
      for (let guard = 0; guard < 300 && borders.some((b) => !b.finished); guard++) {
        const b = next() % 6
        const legal = fenceMoves(borders, b)
        const border = borders[b]
        const blocked = occupiedVertices(borders)
        const froms = border.path.length > 0 ? [border.path[border.path.length - 1]] : border.starts
        // Steps that pass every other test but still aren't offered are the cut-offs.
        for (const from of border.finished ? [] : froms) {
          for (const to of vertexNeighbours(from)) {
            if (blocked.has(to) || !isOutwardStep(from, to, border.path.length === 0) || legal.some((m) => m.to === to)) continue
            const after = extend(borders, b, from, to)
            expect(after.some((x) => !canStillFinish(x, occupiedVertices(after)))).toBe(true)
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
  })
})
