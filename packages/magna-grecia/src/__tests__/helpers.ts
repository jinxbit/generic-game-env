// Shared setup for the rules tests: a quiet, known position to build scenarios on.

import { arrange, newGame } from '../testing'
import type { GameState } from '../rules'
import type { GameData } from '../types'

/** The cell at `row`, `col` (0-based). */
export const at = (row: number, col: number) => row * 13 + col

/**
 * A 4-player genesis rearranged to a known start: no oracles unless the test
 * adds some, card 0 (roads 3, cities 2, resupply 5), Alice to move, turn
 * order p1..p4 — then `edit`.
 */
export function fresh(edit: (game: GameData) => void = () => {}, players = 4): GameState {
  return arrange(newGame({ players }), (g) => {
    g.oracles = []
    g.card = 0
    g.roundOrder = g.seatOrder.slice()
    g.turnPlayerId = 'p1'
    edit(g)
  })
}

/** Puts a city of `owner` on the village `id` plus any `extra` tiles, straight into the game. */
export function putCity(g: GameData, owner: string, id: number, extra: number[] = []): void {
  g.cities.push({ id, owner })
  for (const cell of [id, ...extra]) g.cityTiles[cell] = owner
}

/** Puts a road tile straight into the game. */
export function putRoad(g: GameData, owner: string, cell: number, ends: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3]): void {
  g.roads[cell] = { owner, ends: ends[0] < ends[1] ? ends : [ends[1], ends[0]] }
}
