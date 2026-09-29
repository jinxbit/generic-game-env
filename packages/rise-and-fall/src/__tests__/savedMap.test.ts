// The saved-map asset kind (../savedMap.ts): what counts as a map, taking one
// from a game, and starting a game from one — which skips tile placement,
// overrides the map options, and must replay and rebuild like any genesis.

import { createNewGame, replayActions } from '@game-platform/sdk'
import { seatPlayers } from '@game-platform/sdk/testing'
import { describe, expect, it } from 'vitest'
import type { GameState } from '../adapter.ts'
import { engineGenesisOf, extractSavedMap, gameDefinition, normalizeSavedMap, toEngine, type SavedMap } from '../rules.ts'
import { newGame, play, simplestMove, withoutTimestamps } from '../testing.ts'
import type { GameOptions } from '../types.ts'

function advance(state: GameState, done: (s: GameState) => boolean, limit = 500): GameState {
  let s = state
  for (let i = 0; i < limit && !done(s); i++) s = play(s, simplestMove(s)!)
  if (!done(s)) throw new Error(`Not reached (phase ${s.phase})`)
  return s
}

/** A real map: a 2-player game built together, up to the end of tile placement. */
function builtMap(players = 2): SavedMap {
  const built = advance(newGame({ players }), (s) => s.phase === 'placeUnits')
  const map = extractSavedMap(built)
  if (!map) throw new Error('no map extracted')
  return map
}

function startFrom(map: unknown, players = 2, options: Partial<GameOptions> = {}): GameState {
  newGame() // registers the game
  return createNewGame({
    gameId: 'game_map',
    gameType: gameDefinition.id,
    playMode: 'live',
    players: seatPlayers(players),
    options: { ...gameDefinition.defaultOptions, ...options },
    assets: { map },
  }) as GameState
}

describe('what a saved map is', () => {
  it('keeps only coordinates and terrain, for a supported player count', () => {
    const map = builtMap()
    expect(map.playerCount).toBe(2)
    const tiles = Object.values(map.board.tiles)
    expect(tiles.length).toBeGreaterThan(10)
    for (const tile of tiles) {
      expect(tile.occupantIds).toEqual([])
      expect('placementId' in tile).toBe(false)
    }
    // Idempotent: a stored map normalizes to itself.
    expect(normalizeSavedMap(JSON.parse(JSON.stringify(map)))).toEqual(map)
  })

  it('rejects anything else', () => {
    const map = builtMap()
    const tile = Object.values(map.board.tiles)[0]
    for (const junk of [
      null,
      'map',
      { playerCount: 1, board: map.board },
      { playerCount: 9, board: map.board },
      { playerCount: 2.5, board: map.board },
      { playerCount: 2, board: { shape: 'octagon', tiles: map.board.tiles } },
      { playerCount: 2, board: { shape: 'hex', tiles: {} } },
      { playerCount: 2, board: { shape: 'hex', tiles: { x: { ...tile, terrain: 'lava' } } } },
      { playerCount: 2, board: { shape: 'hex', tiles: { x: { ...tile, coord: { q: 0.5, r: 0 } } } } },
    ]) {
      expect(normalizeSavedMap(junk)).toBeNull()
    }
    expect(gameDefinition.assetKinds!.map.playerRange(map)).toEqual({ min: 2, max: 2 })
  })

  it('can be taken from a game only once tile placement is over', () => {
    const fresh = newGame({ players: 2 })
    expect(extractSavedMap(fresh)).toBeNull()
    const map = builtMap()
    const units = advance(newGame({ players: 2 }), (s) => s.phase === 'selectCards')
    // Starting units don't come along.
    expect(extractSavedMap(units)?.board).toEqual(map.board)
  })
})

describe('starting from a saved map', () => {
  it('skips tile placement and lays the map out as it was saved', () => {
    const map = builtMap()
    const s = startFrom(map)
    expect(s.phase).toBe('placeUnits')
    expect(s.pendingPlayerIds).toEqual(['p1'])
    expect(s.assets).toEqual({ map })
    expect(toEngine(s).board).toEqual(map.board)
  })

  it('overrides the map options — nobody builds alone, and nothing is drawn', () => {
    const map = builtMap()
    const s = startFrom(map, 2, { mapMode: 'solo', soloBuilder: 'random', soloBuilderUnitOrder: 'random' })
    expect(s.game.seating).toEqual({ turnOrder: ['p1', 'p2'], builderId: null })
    expect(s.setupRandom).toBeUndefined()
    expect(s.phase).toBe('placeUnits')
  })

  it('is ignored for a different number of players', () => {
    const s = startFrom(builtMap(2), 3)
    expect(s.phase).toBe('placeTiles')
  })

  it('replays, and rebuilds the engine genesis the view replays from', () => {
    const map = builtMap()
    const genesis = startFrom(map)
    const s = advance(genesis, (x) => x.turn === 1)
    expect(withoutTimestamps(replayActions(genesis, s.actionHistory) as GameState)).toEqual(withoutTimestamps(s))
    expect(engineGenesisOf(s).board).toEqual(map.board)
  })
})
