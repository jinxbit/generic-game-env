// Everything in Magna Grecia that is a pure function of the board: geometry,
// cities as groups of tiles, roads as chains of tiles, which places a road
// connects (RULES.md R-ROAD-02), market activity and value (§8), oracle
// attention (§9) and whether a tile may go on a cell (§7). The rules module
// sequences the turn on top of this; the view reuses it for highlighting and
// previews.
//
// Connections are always recomputed from the tiles (`analyse`) rather than
// kept up to date incrementally, so they can't drift. Only oracle attention
// is stored, because it depends on the order things happened in (R-ORACLE-03).
//
// Server-reachable (imported by rules.ts): keep the `.ts` extensions.

import { CELLS, COLS, ROWS, VILLAGE_AT } from './data.ts'
import type { City, Dir, GameData, Market, MoveEvent, Oracle, PlayerId } from './types.ts'

/** The board part of GameData — what every function here reads. */
export type BoardData = Pick<GameData, 'cityTiles' | 'roads' | 'cities' | 'markets' | 'oracles'>

export const DIRS: readonly Dir[] = [0, 1, 2, 3]
export const DIR_NAMES = ['north', 'east', 'south', 'west'] as const

/** R-ROAD-01: the six ways a tile can join two sides — straight (opposite sides) or curved. */
export const ROAD_SHAPES: readonly [Dir, Dir][] = [
  [0, 2],
  [1, 3],
  [0, 1],
  [1, 2],
  [2, 3],
  [0, 3],
]

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir
}

export function rowOf(cell: number): number {
  return Math.floor(cell / COLS)
}

export function colOf(cell: number): number {
  return cell % COLS
}

/** "C7" — column letter, row number from 1. */
export function cellLabel(cell: number): string {
  return `${String.fromCharCode(65 + colOf(cell))}${rowOf(cell) + 1}`
}

export function isCell(cell: unknown): cell is number {
  return typeof cell === 'number' && Number.isInteger(cell) && cell >= 0 && cell < CELLS
}

/** The cell beyond side `d` of `cell`, or null off the board (R-BOARD-01). */
export function stepFrom(cell: number, d: Dir): number | null {
  const row = rowOf(cell)
  const col = colOf(cell)
  if (d === 0) return row > 0 ? cell - COLS : null
  if (d === 1) return col < COLS - 1 ? cell + 1 : null
  if (d === 2) return row < ROWS - 1 ? cell + COLS : null
  return col > 0 ? cell - 1 : null
}

export function neighbours(cell: number): number[] {
  return DIRS.map((d) => stepFrom(cell, d)).filter((n): n is number => n !== null)
}

/** Normalizes a pair of sides to ascending order, or null if it isn't two distinct sides. */
export function normalizeEnds(ends: unknown): [Dir, Dir] | null {
  if (!Array.isArray(ends) || ends.length !== 2) return null
  const [a, b] = ends
  if (!DIRS.includes(a) || !DIRS.includes(b) || a === b) return null
  return a < b ? [a, b] : [b, a]
}

export function isStraight(ends: readonly [Dir, Dir]): boolean {
  return ends[1] - ends[0] === 2
}

export function oracleAt(board: BoardData, cell: number): Oracle | undefined {
  return board.oracles.find((o) => o.cell === cell)
}

/** An uncovered village space that isn't an oracle (R-BOARD-03). */
export function isVillage(board: BoardData, cell: number): boolean {
  return VILLAGE_AT.has(cell) && board.cityTiles[cell] === null && !oracleAt(board, cell)
}

export function isGreenVillage(cell: number): boolean {
  return VILLAGE_AT.get(cell)?.green ?? false
}

/** Nothing on the cell: no village space, oracle, city or road — where a road may go (R-ROAD-01). */
export function isOpenLand(board: BoardData, cell: number): boolean {
  return !VILLAGE_AT.has(cell) && board.cityTiles[cell] === null && board.roads[cell] === null
}

/** A place's key: `c<id>` a city, `v<cell>` a village, `o<cell>` an oracle (R-BOARD-04). */
export type PlaceKey = string

export function cityKey(id: number): PlaceKey {
  return `c${id}`
}

export function parsePlace(key: PlaceKey): { kind: 'city' | 'village' | 'oracle'; id: number } {
  const kind = key[0] === 'c' ? 'city' : key[0] === 'v' ? 'village' : 'oracle'
  return { kind, id: Number(key.slice(1)) }
}

/** Everything derived from the tiles: which city each cell belongs to, and which places roads connect. */
export interface Analysis {
  /** City id per cell, or null. */
  cityOf: (number | null)[]
  /** Cells per city id. */
  tilesOf: Map<number, number[]>
  /** Direct connections between places, both ways (R-ROAD-02). */
  links: Map<PlaceKey, Set<PlaceKey>>
}

export function placeAt(board: BoardData, analysis: Analysis, cell: number): PlaceKey | null {
  const city = analysis.cityOf[cell]
  if (city !== null) return cityKey(city)
  if (oracleAt(board, cell)) return `o${cell}`
  if (VILLAGE_AT.has(cell)) return `v${cell}`
  return null
}

/** Whether the road tile at `cell` has an end on side `d`. */
function hasEnd(board: BoardData, cell: number, d: Dir): boolean {
  const road = board.roads[cell]
  return !!road && (road.ends[0] === d || road.ends[1] === d)
}

/** Whether the tiles on `cell` and beyond its side `d` are joined (R-ROAD-02). */
function joined(board: BoardData, cell: number, d: Dir): number | null {
  const next = stepFrom(cell, d)
  if (next === null || !hasEnd(board, next, opposite(d))) return null
  return board.roads[next]!.owner === board.roads[cell]!.owner ? next : null
}

export function analyse(board: BoardData): Analysis {
  const cityOf: (number | null)[] = Array.from({ length: CELLS }, () => null)
  const tilesOf = new Map<number, number[]>()
  for (const city of board.cities) {
    const tiles: number[] = []
    const queue = [city.id]
    cityOf[city.id] = city.id
    while (queue.length > 0) {
      const cell = queue.pop()!
      tiles.push(cell)
      for (const n of neighbours(cell)) {
        if (board.cityTiles[n] === city.owner && cityOf[n] === null) {
          cityOf[n] = city.id
          queue.push(n)
        }
      }
    }
    tilesOf.set(city.id, tiles.sort((a, b) => a - b))
  }

  const links = new Map<PlaceKey, Set<PlaceKey>>()
  const link = (a: PlaceKey, b: PlaceKey) => {
    if (!links.has(a)) links.set(a, new Set())
    links.get(a)!.add(b)
  }
  const partial: Analysis = { cityOf, tilesOf, links }
  const seen = new Set<number>()
  for (let start = 0; start < CELLS; start++) {
    const road = board.roads[start]
    if (!road || seen.has(start)) continue
    seen.add(start)
    // Walk out of each end of the starting tile to the road's outer ends.
    const terminals: (PlaceKey | null)[] = []
    let cycle = false
    for (const out of road.ends) {
      let cell = start
      let exit: Dir = out
      for (;;) {
        const next = joined(board, cell, exit)
        if (next === null) {
          const beyond = stepFrom(cell, exit)
          terminals.push(beyond === null ? null : placeAt(board, partial, beyond))
          break
        }
        if (next === start) {
          cycle = true
          break
        }
        seen.add(next)
        const entry = opposite(exit)
        const ends = board.roads[next]!.ends
        exit = ends[0] === entry ? ends[1] : ends[0]
        cell = next
      }
      if (cycle) break
    }
    if (cycle) continue
    const [a, b] = terminals
    if (a && b && a !== b) {
      link(a, b)
      link(b, a)
    }
  }
  return partial
}

/** Number of places directly connected to `key` — a market's value there (R-MKT-04), a city's importance (R-ORACLE-01). */
export function connectionCount(analysis: Analysis, key: PlaceKey): number {
  return analysis.links.get(key)?.size ?? 0
}

export function cityById(board: BoardData, id: number): City | undefined {
  return board.cities.find((c) => c.id === id)
}

/** The place a market stands in: its city, or its village. */
export function marketPlace(analysis: Analysis, market: Market): PlaceKey {
  const city = analysis.cityOf[market.cell]
  return city !== null ? cityKey(city) : `v${market.cell}`
}

/** R-MKT-03. */
export function isMarketActive(board: BoardData, analysis: Analysis, market: Market): boolean {
  const key = marketPlace(analysis, market)
  const here = parsePlace(key)
  if (here.kind === 'city' && cityById(board, here.id)?.owner === market.owner) return true
  for (const other of analysis.links.get(key) ?? []) {
    const place = parsePlace(other)
    if (place.kind === 'city' && cityById(board, place.id)?.owner === market.owner) return true
  }
  return false
}

/** What a market scores or sells for right now: its place's connections if active and unsold, else 0 (R-MKT-03/04). */
export function marketValue(board: BoardData, analysis: Analysis, market: Market): number {
  if (market.sold || !isMarketActive(board, analysis, market)) return 0
  return connectionCount(analysis, marketPlace(analysis, market))
}

/** Whether one of `playerId`'s road tiles has an end pointing at `cell` (R-ROAD-03, R-CITY-01). */
export function roadPointsAt(board: BoardData, playerId: PlayerId, cell: number): boolean {
  return DIRS.some((d) => {
    const n = stepFrom(cell, d)
    return n !== null && board.roads[n]?.owner === playerId && hasEnd(board, n, opposite(d))
  })
}

/** Why `playerId` may not put a road tile joining `ends` on `cell`, or null if they may (R-ROAD-01..04). */
export function roadProblem(board: BoardData, playerId: PlayerId, cell: number, ends: [Dir, Dir]): string | null {
  if (!isOpenLand(board, cell)) return 'That space is taken.'
  let anchored = false
  for (const d of ends) {
    const n = stepFrom(cell, d)
    if (n === null) return 'A road may not lead off the board.'
    const road = board.roads[n]
    const pointsBack = hasEnd(board, n, opposite(d))
    if (road && pointsBack && road.owner !== playerId) return "You can't lengthen another player's road."
    if (board.cityTiles[n] !== null) anchored = true
    else if (road && pointsBack) anchored = true
    else if (VILLAGE_AT.has(n) && roadPointsAt(board, playerId, n)) anchored = true
  }
  if (!anchored) return 'A road must lead from a city, from a village or oracle your roads already reach, or on from one of your roads.'
  return null
}

/** What a city tile on a cell would do (R-CITY-01..05), before budget checks. */
export type CityPlan =
  | { ok: true; tiles: number[]; founds: boolean; city: number; village: number | null }
  | { ok: false; reason: string }

export function planCity(board: BoardData, analysis: Analysis, playerId: PlayerId, cell: number): CityPlan {
  if (board.cityTiles[cell] !== null || board.roads[cell] !== null || oracleAt(board, cell)) return { ok: false, reason: 'That space is taken.' }
  const tiles = [cell]
  let village: number | null = isVillage(board, cell) ? cell : null
  if (village === null) {
    const nearby = neighbours(cell).filter((n) => isVillage(board, n))
    if (nearby.length > 1) return { ok: false, reason: 'A city tile may not go next to two villages.' }
    if (nearby.length === 1) {
      // R-CITY-04: the second tile goes straight onto the village.
      village = nearby[0]
      tiles.push(village)
    }
  }
  const own = new Set<number>()
  for (const tile of tiles) {
    for (const n of neighbours(tile)) {
      if (tiles.includes(n)) continue
      const owner = board.cityTiles[n]
      if (owner !== null && owner !== playerId) return { ok: false, reason: "A city tile may not go next to another player's city." }
      if (owner === playerId) own.add(analysis.cityOf[n]!)
      if (oracleAt(board, n)) return { ok: false, reason: 'A city tile may not go next to an oracle.' }
      if (isVillage(board, n)) return { ok: false, reason: 'A city tile may not go next to a village.' }
    }
  }
  if (own.size > 1) return { ok: false, reason: 'A city tile may not join two of your cities.' }
  if (own.size === 1) return { ok: true, tiles, founds: false, city: [...own][0], village }
  if (village === null) return { ok: false, reason: 'A new city must be founded on a village (or expand one of your cities).' }
  if (!isGreenVillage(village) && !roadPointsAt(board, playerId, village)) {
    return { ok: false, reason: 'A city may be founded only on a green-bordered village or one your roads reach.' }
  }
  return { ok: true, tiles, founds: true, city: village, village }
}

/** Where a market in `cell`'s place would stand and what it costs (R-MKT-01/02). */
export type MarketPlan = { ok: true; cell: number; place: PlaceKey; cost: number } | { ok: false; reason: string }

export function planMarket(board: BoardData, analysis: Analysis, playerId: PlayerId, cell: number): MarketPlan {
  const cityId = analysis.cityOf[cell]
  let place: PlaceKey
  let marketCell: number
  let base: number
  if (cityId !== null) {
    if (cityById(board, cityId)!.owner === playerId) return { ok: false, reason: 'Markets are built in villages and other players’ cities.' }
    place = cityKey(cityId)
    marketCell = cityId
    base = analysis.tilesOf.get(cityId)!.length
  } else if (isVillage(board, cell)) {
    place = `v${cell}`
    marketCell = cell
    base = 1
  } else {
    return { ok: false, reason: 'Markets are built in villages and cities.' }
  }
  const here = board.markets.filter((m) => marketPlace(analysis, m) === place)
  if (here.some((m) => m.owner === playerId)) return { ok: false, reason: 'You already have a market there.' }
  return { ok: true, cell: marketCell, place, cost: base + here.filter((m) => !m.sold).length }
}

/**
 * R-ORACLE-02..04: re-checks every oracle's attention against the current
 * connections. Returns the new oracles and an event per change.
 */
export function updateOracles(board: BoardData, analysis: Analysis, mover: PlayerId): { oracles: Oracle[]; events: MoveEvent[] } {
  const events: MoveEvent[] = []
  const importance = (id: number) => connectionCount(analysis, cityKey(id))
  const order = (id: number) => board.cities.findIndex((c) => c.id === id)
  const best = (ids: number[]) =>
    [...ids].sort((a, b) => importance(b) - importance(a) || Number(cityById(board, b)!.owner === mover) - Number(cityById(board, a)!.owner === mover) || order(a) - order(b))[0]
  const oracles = board.oracles.map((oracle) => {
    const connected = [...(analysis.links.get(`o${oracle.cell}`) ?? [])].map(parsePlace).filter((p) => p.kind === 'city').map((p) => p.id)
    let next = oracle.attention
    if (next === null) {
      if (connected.length > 0) next = best(connected)
    } else {
      const current = importance(next)
      const better = connected.filter((id) => importance(id) > current)
      if (better.length > 0) next = best(better)
    }
    if (next === oracle.attention) return oracle
    events.push({ kind: 'oracle', oracle: oracle.cell, from: oracle.attention, to: next!, owner: cityById(board, next!)!.owner })
    return { ...oracle, attention: next }
  })
  return { oracles, events }
}
