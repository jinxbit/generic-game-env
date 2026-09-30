import { describe, expect, it } from 'vitest'
import {
  BONUS_FIELDS,
  borderStarts,
  canStillFinish,
  CELLS,
  cellLabel,
  cellOf,
  CENTRE,
  DIRECTIONS,
  edgeBetween,
  FARM_POSITIONS,
  FARMHOUSES,
  farmFields,
  fenceMoves,
  FIELDS,
  gate,
  hexDistance,
  isEdgeVertex,
  isOutwardStep,
  junction,
  occupiedVertices,
  vertexDepth,
  vertexHexes,
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

/** Fences already in a line. */
function built(border: Border): number {
  return Math.max(0, border.path.length - 1)
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

/** The two hexes a fence from `u` to `v` separates, as cells (-1 off the board). */
function sides(u: string, v: string): number[] {
  return edgeBetween(u, v)
    .split('/')
    .map((key) => {
      const [q, r] = key.split(',').map(Number)
      return cellOf({ q, r })
    })
}

describe('§2 the board', () => {
  it('R-BOARD-01/02: radius 4 — 61 hexes, 54 fields, the centre and six farmhouses', () => {
    expect(CELLS).toHaveLength(61)
    expect(Math.max(...CELLS.map(hexDistance))).toBe(4)
    expect(FIELDS).toHaveLength(54)
    expect(FIELDS.every((c) => hexDistance(CELLS[c]) >= 2)).toBe(true)
    expect(hexDistance(CELLS[CENTRE])).toBe(0)
    expect(FARMHOUSES.map((c) => hexDistance(CELLS[c]))).toEqual([1, 1, 1, 1, 1, 1])
    expect(cellLabel(0)).toBe('A1')
    expect(cellLabel(CENTRE)).toBe('E5')
    expect(cellLabel(60)).toBe('I5')
  })

  it('R-BOARD-03: bonus fields — ring 2 between the diagonals ×2, ring 3 on them ×3, ring 4 midway between them ×3', () => {
    // A hex lies on a long diagonal when it's a multiple of one direction.
    const onDiagonal = (cell: number) =>
      DIRECTIONS.some((d) => {
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

  it('vertices: three neighbours each, symmetric; gates touch the centre and two farmhouses, junctions two farmhouses and a field', () => {
    for (let p = 0; p < 6; p++) {
      for (const v of [gate(p), junction(p)]) for (const w of vertexNeighbours(v)) expect(vertexNeighbours(w)).toContain(v)
      expect(vertexHexes(gate(p)).map(hexDistance).sort()).toEqual([0, 1, 1])
      expect(vertexHexes(junction(p)).map(hexDistance).sort()).toEqual([1, 1, 2])
      expect(vertexNeighbours(gate(p))).toContain(junction(p))
    }
    expect(new Set([0, 1, 2, 3, 4, 5].map(gate)).size).toBe(6)
  })

  it('R-FENCE-02: a border starts at a gate — with fewer than six farms, any gate between its two farmhouses', () => {
    expect(borderStarts(0, 1)).toEqual([gate(0)])
    expect(borderStarts(0, 3)).toEqual([gate(0), gate(1), gate(2)])
    expect(borderStarts(4, 0)).toEqual([gate(4), gate(5)])
  })
})

describe('§6 fence lines', () => {
  it('R-FENCE-02: the first fence runs between two farmhouses — whatever the number of players', () => {
    for (const players of [2, 3, 4, 5, 6]) {
      const borders = bordersFor(players)
      for (let b = 0; b < borders.length; b++) {
        const moves = fenceMoves(borders, b)
        expect(moves).toHaveLength(borders[b].starts.length)
        for (const m of moves) {
          expect(borders[b].starts).toContain(m.from)
          const [x, y] = sides(m.from, m.to)
          expect(FARMHOUSES).toContain(x)
          expect(FARMHOUSES).toContain(y)
        }
      }
    }
  })

  it('R-FENCE-03/04: then along one of those farmhouses, then only between fields, never inward', () => {
    const j = junction(0)
    // From the gate: only out to the junction, not round the centre hex.
    expect(vertexNeighbours(gate(0)).filter((v) => isOutwardStep(gate(0), v, 0))).toEqual([j])
    // From the junction: along either farmhouse, never back.
    const second = vertexNeighbours(j).filter((v) => isOutwardStep(j, v, 1))
    expect(second).toHaveLength(2)
    for (const v of second) expect(sides(j, v).filter((c) => FARMHOUSES.includes(c))).toHaveLength(1)
    // After that, a fence along a farmhouse is refused.
    const [v] = second
    const alongFarmhouse = vertexNeighbours(v).filter((w) => w !== j && sides(v, w).some((c) => FARMHOUSES.includes(c)))
    expect(alongFarmhouse.length).toBeGreaterThan(0)
    for (const w of alongFarmhouse) expect(isOutwardStep(v, w, 2)).toBe(false)
    const inward = vertexNeighbours(j).find((w) => vertexRing(w) < vertexRing(j))!
    expect(isOutwardStep(j, inward, 1)).toBe(false)
  })

  it('R-FENCE-06: the shortest border is seven fences; every finished set of borders splits the 54 fields between the farms', () => {
    const shortest = (from: string, fences: number): number =>
      isEdgeVertex(from) ? 0 : 1 + Math.min(...vertexNeighbours(from).filter((v) => vertexDepth(v) > vertexDepth(from) && isOutwardStep(from, v, fences)).map((v) => shortest(v, fences + 1)))
    expect(shortest(gate(0), 0)).toBe(7)
    for (const players of [2, 3, 4, 5, 6]) {
      for (const seed of [1, 2, 3]) {
        const borders = randomBorders(players, seed * 7 + players)
        expect(borders.every((b) => b.finished)).toBe(true)
        // Every line starts with the fence between two farmhouses.
        for (const b of borders) expect(sides(b.path[0], b.path[1]).every((c) => FARMHOUSES.includes(c))).toBe(true)
        const farms = FARM_POSITIONS[players].map((p) => farmFields(borders, p))
        expect(farms.reduce((n, f) => n + f.length, 0)).toBe(54)
        expect(new Set(farms.flat()).size).toBe(54)
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
        const legal = fenceMoves(borders, b)
        const border = borders[b]
        const blocked = occupiedVertices(borders)
        const froms = border.path.length > 0 ? [border.path[border.path.length - 1]] : border.starts
        // Steps that pass every other test but still aren't offered are the cut-offs.
        for (const from of border.finished ? [] : froms) {
          for (const to of vertexNeighbours(from)) {
            if (blocked.has(to) || !isOutwardStep(from, to, built(border)) || legal.some((m) => m.to === to)) continue
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
  }, 20_000)
})
