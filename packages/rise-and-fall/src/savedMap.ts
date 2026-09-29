// Rise & Fall's one asset kind: a saved map (GameDefinition.assetKinds,
// @game-platform/sdk). A saved map is a finished terrain layout for a given
// player count — the board tile placement would otherwise build — so a game
// that starts from one skips tile placement and goes straight to starting-
// unit placement, the same way a pre-made template does
// (startGameWithPresetBoard, ./engine/createGame.ts). This is the platform's
// take on the standalone app's `map_pool` table: the maps live in the
// platform's generic asset library (game_assets), and a room copies the one
// it uses (or has one picked at random at Start).
//
// A map is tied to one player count because the rest of setup is: the
// board-generation pools, and so the map's size, scale with it
// (content/terrain.json), which is also why the standalone app's pool was
// keyed by player count.
//
// Server-reachable (via ./rules.ts): keep the `.ts` extensions.

import type { AssetKind } from '@game-platform/sdk'
import type { GameState } from './adapter.ts'
import { toEngine } from './adapter.ts'
import { createEmptyBoard, setTile } from './engine/board.ts'
import type { Board, Terrain } from './engine/types.ts'

export interface SavedMap {
  /** The player count the map was built for — the only one a game may start from it with. */
  playerCount: number
  /** Terrain only: no units, no placement ids. */
  board: Board
}

const TERRAINS: readonly Terrain[] = ['water', 'plain', 'forest', 'mountain', 'glacier']
const MIN_PLAYERS = 2
const MAX_PLAYERS = 8
/** Far beyond any real map (an 8-player board is a few hundred hexes), so a stored payload can't be made arbitrarily expensive to use. */
const MAX_TILES = 2000

/** `raw` as a saved map — rebuilt tile by tile from just coordinates and terrain, so nothing else a stored payload carries survives — or null. */
export function normalizeSavedMap(raw: unknown): SavedMap | null {
  if (!raw || typeof raw !== 'object') return null
  const { playerCount, board } = raw as { playerCount?: unknown; board?: unknown }
  if (typeof playerCount !== 'number' || !Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) return null
  if (!board || typeof board !== 'object') return null
  const { shape, tiles } = board as { shape?: unknown; tiles?: unknown }
  if (shape !== 'hex' && shape !== 'square') return null
  if (!tiles || typeof tiles !== 'object') return null
  const entries = Object.values(tiles as Record<string, unknown>)
  if (entries.length === 0 || entries.length > MAX_TILES) return null

  let normalized = createEmptyBoard(shape)
  for (const tile of entries) {
    if (!tile || typeof tile !== 'object') return null
    const { coord, terrain } = tile as { coord?: { q?: unknown; r?: unknown }; terrain?: unknown }
    if (!coord || !Number.isInteger(coord.q) || !Number.isInteger(coord.r)) return null
    if (!TERRAINS.includes(terrain as Terrain)) return null
    normalized = setTile(normalized, { q: coord.q as number, r: coord.r as number }, terrain as Terrain)
  }
  // setTile leaves an explicit `placementId: undefined`; a stored payload is JSON, so drop the key.
  for (const tile of Object.values(normalized.tiles)) delete tile.placementId
  return { playerCount, board: normalized }
}

/** The map a game has been played on, once tile placement is over — "save this map". */
export function extractSavedMap(state: GameState): SavedMap | null {
  const engine = toEngine(state)
  if (engine.status === 'boardSetup' && engine.boardSetup && engine.boardSetup.tileTierQueue.length > 0) return null
  return normalizeSavedMap({ playerCount: state.players.length, board: engine.board })
}

export const savedMapKind: AssetKind<SavedMap, GameState> = {
  label: 'Map',
  description: 'A finished map for a given number of players. A game started from one skips tile placement.',
  normalize: normalizeSavedMap,
  playerRange: (map) => ({ min: map.playerCount, max: map.playerCount }),
  extract: extractSavedMap,
}
