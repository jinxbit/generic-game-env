// Everything in Bauernschlau that is a pure function of the board: the hex
// geometry, fence lines and which fences are legal, the farms they enclose,
// and scoring. RULES.md is the source of truth; its rule ids are cited.
//
// The board is a hexagon of hexes, radius 4 (R-BOARD-01), in axial
// coordinates (q, r). Cells are numbered row by row from the top. Fences run
// along hex edges and join at hex corners ("vertices"). A vertex is named by
// the three hexes that meet there — some of which may lie off the board, which
// is exactly what makes it a vertex on the board's edge (R-FENCE-06). An edge
// is named by the two hexes it separates. Both are plain strings, so fence
// lines store and compare cheaply and survive JSON.
//
// "Back towards the farmhouses" (R-FENCE-03) is measured by a vertex's
// ring: vertices lie on the boundaries between one ring of hexes and the
// next, and a fence may run along a boundary (sideways) or out to the next
// one, never in to an earlier one. The edge of the board is the boundary past
// ring 4. A border's line starts at the centre, between two farmhouses
// (R-FENCE-02), so its first fence always runs between those farmhouses.
//
// Pure and deterministic — imported by the Edge Functions, so keep the `.ts`
// extensions on relative imports.

import type { Border, FieldSheep, GameData, PlayerId, Sheep } from './types.ts'

export interface Hex {
  q: number
  r: number
}

/** R-BOARD-01: rings 0–4 around the centre — five hexes from the centre to the edge. */
export const RADIUS = 4

/** The six neighbour directions, clockwise from the top right (screen y grows downwards). */
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
]

/** R-SETUP-03: fence pieces per player, by player count. */
export const FENCES_BY_PLAYERS: Record<number, number> = { 2: 16, 3: 16, 4: 12, 5: 12, 6: 10 }

/** R-SETUP-02: which farmhouses are used, by player count, in seat order. */
export const FARM_POSITIONS: Record<number, number[]> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
}

/** R-SCORE-05: the multi-round variant's gap below the lowest enclosed farm. */
export const UNENCLOSED_GAP = 10

/** R-COMP-02: the white sheep counters, as [value, count]. */
export const WHITE_SHEEP: readonly (readonly [number, number])[] = [
  [5, 9],
  [3, 9],
  [2, 9],
  [1, 9],
]

/** R-COMP-02: the black sheep, each worth −3. */
export const BLACK_SHEEP_COUNT = 16
export const BLACK_SHEEP_VALUE = -3

/** R-FLIP-02: extra actions for turning over a black sheep. */
export const BLACK_SHEEP_BONUS = 2

/** Every counter, in a fixed order (draws pick a random index, so the order means nothing). */
export function sheepCounters(): Sheep[] {
  const out: Sheep[] = []
  for (const [value, count] of WHITE_SHEEP) for (let i = 0; i < count; i++) out.push({ value, black: false })
  for (let i = 0; i < BLACK_SHEEP_COUNT; i++) out.push({ value: BLACK_SHEEP_VALUE, black: true })
  return out
}

export function hexDistance(h: Hex): number {
  return Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r))
}

function add(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r }
}

function hexKey(h: Hex): string {
  return `${h.q},${h.r}`
}

function parseHex(key: string): Hex {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

/** Every hex on the board, row by row from the top, left to right. A cell is an index into this. */
export const CELLS: readonly Hex[] = (() => {
  const cells: Hex[] = []
  for (let r = -RADIUS; r <= RADIUS; r++) {
    for (let q = Math.max(-RADIUS, -r - RADIUS); q <= Math.min(RADIUS, -r + RADIUS); q++) cells.push({ q, r })
  }
  return cells
})()

const CELL_BY_KEY = new Map(CELLS.map((h, i) => [hexKey(h), i]))

/** The cell of an on-board hex, or -1. */
export function cellOf(h: Hex): number {
  return CELL_BY_KEY.get(hexKey(h)) ?? -1
}

export const CENTRE = cellOf({ q: 0, r: 0 })

/** R-SETUP-02: the six farmhouse hexes around the centre, by position. */
export const FARMHOUSES: readonly number[] = DIRECTIONS.map(cellOf)

/** R-BOARD-02: every hex outside the seven central ones is a field. */
export function isField(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < CELLS.length && hexDistance(CELLS[cell]) >= 2
}

export const FIELDS: readonly number[] = CELLS.map((_, i) => i).filter(isField)

function scaled(h: Hex, k: number): Hex {
  return { q: h.q * k, r: h.r * k }
}

/**
 * R-BOARD-03: the bonus fields, and what each multiplies
 * its sheep by. The six long diagonals run from the centre through each
 * farmhouse to a corner of the board; on ring k they meet the ring at its
 * corners, every k-th hex.
 * - ring 2 (the first ring of fields): the six hexes between its corners —
 *   every 2nd hex, off the diagonals, each where two farmhouses meet — ×2;
 * - ring 3: its six corners, on the diagonals — ×3;
 * - ring 4, the edge of the board: the six hexes exactly midway between its
 *   corners — ×3.
 */
export const BONUS_FIELDS: ReadonlyMap<number, number> = new Map(
  DIRECTIONS.flatMap((d, i) => {
    const next = DIRECTIONS[(i + 1) % 6]
    return [
      [cellOf(add(d, next)), 2],
      [cellOf(scaled(d, 3)), 3],
      [cellOf(add(scaled(d, 2), scaled(next, 2))), 3],
    ] as [number, number][]
  }),
)

/** On-board neighbours of a cell. */
export function neighbours(cell: number): number[] {
  return DIRECTIONS.map((d) => cellOf(add(CELLS[cell], d))).filter((c) => c >= 0)
}

/** "D4": row letter from the top, then the position in the row from the left. */
export function cellLabel(cell: number): string {
  const h = CELLS[cell]
  if (!h) return '?'
  const row = h.r + RADIUS
  const first = Math.max(-RADIUS, -h.r - RADIUS)
  return `${String.fromCharCode(65 + row)}${h.q - first + 1}`
}

// ---------------------------------------------------------------------------
// Vertices and edges

/** A vertex's name: its three hexes' keys, sorted. */
export function vertexKey(hexes: readonly Hex[]): string {
  return hexes.map(hexKey).sort().join('|')
}

export function vertexHexes(key: string): Hex[] {
  return key.split('|').map(parseHex)
}

/** The sum of a vertex's hexes' distances from the centre: `3k + 1` or `3k + 2` on the boundary between rings k and k + 1. */
export function vertexDepth(key: string): number {
  return vertexHexes(key).reduce((sum, h) => sum + hexDistance(h), 0)
}

/** R-FENCE-03: which ring boundary a vertex lies on — k for the boundary between rings k and k + 1. */
export function vertexRing(key: string): number {
  return Math.floor((vertexDepth(key) - 1) / 3)
}

/** Whether a vertex touches one of the seven central hexes. */
function touchesCentre(key: string): boolean {
  return vertexHexes(key).some((h) => hexDistance(h) <= 1)
}

/** R-FENCE-06: a vertex on the board's outer edge touches a hex off the board. */
export function isEdgeVertex(key: string): boolean {
  return vertexHexes(key).some((h) => hexDistance(h) > RADIUS)
}

function adjacent(a: Hex, b: Hex): boolean {
  return DIRECTIONS.some((d) => a.q + d.q === b.q && a.r + d.r === b.r)
}

/** The two hexes next to both of two adjacent hexes. */
function commonNeighbours(a: Hex, b: Hex): Hex[] {
  return DIRECTIONS.map((d) => add(a, d)).filter((h) => adjacent(h, b))
}

function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

/** The three vertices one edge away from `key`. */
export function vertexNeighbours(key: string): string[] {
  const hs = vertexHexes(key)
  const out: string[] = []
  for (let i = 0; i < 3; i++) {
    const x = hs[i]
    const y = hs[(i + 1) % 3]
    const z = hs[(i + 2) % 3]
    const w = commonNeighbours(x, y).find((h) => !sameHex(h, z))!
    out.push(vertexKey([x, y, w]))
  }
  return out
}

/** The edge between two neighbouring vertices, named by the two hexes it separates. */
export function edgeBetween(u: string, v: string): string {
  const vs = new Set(v.split('|'))
  return u
    .split('|')
    .filter((k) => vs.has(k))
    .sort()
    .join('/')
}

function edgeKey(a: Hex, b: Hex): string {
  return [hexKey(a), hexKey(b)].sort().join('/')
}

/** The vertex where farmhouses `position` and `position + 1` meet the fields — the far end of the fence between them. */
export function junction(position: number): string {
  const a = DIRECTIONS[position % 6]
  const b = DIRECTIONS[(position + 1) % 6]
  return vertexKey([a, b, add(a, b)])
}

/** R-FENCE-02: the vertex where farmhouses `position` and `position + 1` meet the centre hex — where a border between them begins. */
export function gate(position: number): string {
  return vertexKey([{ q: 0, r: 0 }, DIRECTIONS[position % 6], DIRECTIONS[(position + 1) % 6]])
}

/**
 * R-FENCE-02: where the border between the farms at positions `from` and
 * `to` (clockwise) may begin — the gate between every pair of neighbouring
 * farmhouses from one to the other, used or not. With six players that's the
 * single gate between the two farms' own farmhouses.
 */
export function borderStarts(from: number, to: number): string[] {
  const starts: string[] = []
  for (let p = from; p !== to; p = (p + 1) % 6) {
    starts.push(gate(p))
    if (starts.length > 6) break
  }
  return starts
}

/** Every vertex on some fence line. */
export function occupiedVertices(borders: readonly Border[]): Set<string> {
  return new Set(borders.flatMap((b) => b.path))
}

/**
 * R-FENCE-02..04: whether the fence after `built` fences of a line may run
 * from `from` to its neighbour `to`, board-wise:
 * - the first fence runs between the two farmhouses, from the gate out to
 *   their junction with the fields (not round the centre hex);
 * - the second runs from the junction along one of those farmhouses;
 * - every later one runs between two fields;
 * - and none leads onto an earlier ring boundary.
 */
export function isOutwardStep(from: string, to: string, built: number): boolean {
  if (built === 0) return !vertexHexes(to).some((h) => hexDistance(h) === 0)
  if (vertexRing(to) < vertexRing(from)) return false
  return built === 1 || !touchesCentre(to)
}

/**
 * Whether a line standing at `from` after `built` fences can still be extended
 * to the edge without touching `blocked` (R-FENCE-05). A breadth-first search,
 * one fence per layer, so each layer knows how many fences its lines have.
 */
export function reachesEdge(from: string, blocked: ReadonlySet<string>, built: number): boolean {
  if (isEdgeVertex(from)) return true
  const seen = new Set([from])
  let frontier = [from]
  let fences = built
  while (frontier.length > 0) {
    const next: string[] = []
    for (const v of frontier) {
      for (const w of vertexNeighbours(v)) {
        if (seen.has(w) || blocked.has(w) || !isOutwardStep(v, w, fences)) continue
        if (isEdgeVertex(w)) return true
        seen.add(w)
        next.push(w)
      }
    }
    frontier = next
    fences++
  }
  return false
}

/** Fences a line has: none until it starts, then one fewer than its vertices. */
function fencesIn(border: Border): number {
  return Math.max(0, border.path.length - 1)
}

/** R-FENCE-05: whether a border can still be finished, given every fence on the board. */
export function canStillFinish(border: Border, blocked: ReadonlySet<string>): boolean {
  if (border.finished) return true
  if (border.path.length === 0) return border.starts.some((s) => !blocked.has(s) && reachesEdge(s, blocked, 0))
  return reachesEdge(border.path[border.path.length - 1], blocked, fencesIn(border))
}

export interface FenceMove {
  border: number
  from: string
  to: string
}

/**
 * R-FENCE-02..05: every fence that could extend `borderIndex` right now —
 * never inward, touching no fence line, and leaving every unfinished border
 * a way to the edge. Ignores whose turn it is and fence stocks.
 */
export function fenceMoves(borders: readonly Border[], borderIndex: number): FenceMove[] {
  const border = borders[borderIndex]
  if (!border || border.finished) return []
  const blocked = occupiedVertices(borders)
  const froms = border.path.length > 0 ? [border.path[border.path.length - 1]] : border.starts.filter((s) => !blocked.has(s))
  const moves: FenceMove[] = []
  const built = fencesIn(border)
  for (const from of froms) {
    for (const to of vertexNeighbours(from)) {
      if (blocked.has(to) || !isOutwardStep(from, to, built)) continue
      const after = new Set(blocked)
      after.add(from)
      after.add(to)
      const extended: Border = { ...border, path: border.path.length > 0 ? [...border.path, to] : [from, to], finished: isEdgeVertex(to) }
      const ok = borders.every((b, i) => canStillFinish(i === borderIndex ? extended : b, after))
      if (ok) moves.push({ border: borderIndex, from, to })
    }
  }
  return moves
}

/** Every edge a fence stands on. A line starts at the centre, so it splits the ring of farmhouses too. */
export function fencedEdges(borders: readonly Border[]): Set<string> {
  const edges = new Set<string>()
  for (const b of borders) {
    for (let i = 1; i < b.path.length; i++) edges.add(edgeBetween(b.path[i - 1], b.path[i]))
  }
  return edges
}

/**
 * The fields of the farm at `position`: everything reachable from its
 * farmhouse without crossing a fence or the centre hex (R-SCORE-01). Only a meaningful farm once both its borders are
 * finished; before that it leaks into its neighbours.
 */
export function farmFields(borders: readonly Border[], position: number): number[] {
  const fenced = fencedEdges(borders)
  const start = FARMHOUSES[position]
  const seen = new Set([start])
  const queue = [start]
  while (queue.length > 0) {
    const cell = queue.shift()!
    for (const next of neighbours(cell)) {
      if (next === CENTRE || seen.has(next) || fenced.has(edgeKey(CELLS[cell], CELLS[next]))) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return [...seen].filter(isField).sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// The game on the board

export function isEnclosed(game: GameData, playerId: PlayerId): boolean {
  const farm = game.farms[playerId]
  return !!farm && farm.borders.every((b) => game.borders[b].finished)
}

/** R-END-01: a sheep or the dog stands there. */
export function isOccupied(game: GameData, cell: number): boolean {
  return game.sheep[cell] !== null || game.dog === cell
}

export function emptyFields(game: GameData): number[] {
  return FIELDS.filter((c) => !isOccupied(game, c))
}

export function faceDownCells(game: GameData): number[] {
  return FIELDS.filter((c) => game.sheep[c] !== null && !game.sheep[c]!.faceUp)
}

/** R-END-01: an enclosed farm whose every field is occupied. */
export function isFarmFull(game: GameData, playerId: PlayerId): boolean {
  return isEnclosed(game, playerId) && farmFields(game.borders, game.farms[playerId].position).every((c) => isOccupied(game, c))
}

/** R-SCORE-02/03: face-up sheep on these fields, times their bonus field's multiplier. Face-down sheep count nothing. */
export function sheepScore(sheep: readonly (FieldSheep | null)[], cells: readonly number[]): number {
  let total = 0
  for (const cell of cells) {
    const s = sheep[cell]
    if (!s || !s.faceUp || !s.sheep) continue
    total += s.sheep.value * (BONUS_FIELDS.get(cell) ?? 1)
  }
  return total
}

/** What a farm's sheep are worth right now (whether or not it's enclosed). */
export function farmScore(game: GameData, playerId: PlayerId): number {
  return sheepScore(game.sheep, farmFields(game.borders, game.farms[playerId].position))
}
