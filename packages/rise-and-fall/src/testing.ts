// Test helpers for Rise & Fall — this package's `testing` entry point. Not
// imported by any runtime code.

import { applyAction, createNewGame, registerGame, type Action, type LobbyState, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { toPlatform, type GameState } from './adapter.ts'
import { currentTilePlacerId, currentUnitPlacerId } from './engine/boardSetup.ts'
import { coordKey, type Coordinate } from './engine/types.ts'
import { gameDefinition, toEngine } from './rules.ts'
import type { EngineState, GameAction, GameData, GameOptions } from './types.ts'

export { act, seatPlayers, withoutTimestamps } from '@game-platform/sdk/testing'

/**
 * A deterministic stream for tests — never used by the rules themselves. An
 * LCG with its output mixed (murmur3's finalizer): a bare LCG's first draw
 * barely moves between small seeds, so every seed would pick the same seat.
 */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    let h = x ^ (x >>> 16)
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    return (h ^ (h >>> 16)) >>> 0
  }
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults:
 * 2 players, live, the default options. Registers the game first.
 */
export function newGame(
  params: { players?: number; playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; lockRevealedInformationEnabled?: boolean; seed?: number } = {},
): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    lockRevealedInformationEnabled: params.lockRevealedInformationEnabled,
    options: { ...gameDefinition.defaultOptions, ...params.options },
    players: seatPlayers(params.players ?? 2),
    setupRandom: testRandom(params.seed ?? 1),
  }) as GameState
}

/** applyAction, throwing on rejection. */
export function play(state: GameState, action: GameAction | Action): GameState {
  return act(state, action as Action)
}

/**
 * A platform genesis from an engine genesis built some other way — e.g. from
 * a standalone-app game export, whose map may have come from a source the
 * platform's options don't offer. `lobby` supplies the envelope.
 */
export function platformStateFromEngine(engine: EngineState, lobby: LobbyState<GameOptions>, seating: GameData['seating']): GameState {
  return toPlatform(engine, lobby, seating)
}

/** Every hex adjacent to an existing tile, plus the tiles themselves — the only anchors a legal placement can use. */
function candidateAnchors(engine: EngineState): Coordinate[] {
  const neighbors = [
    { q: 1, r: 0 },
    { q: -1, r: 0 },
    { q: 0, r: 1 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
    { q: -1, r: 1 },
  ]
  const seen = new Map<string, Coordinate>()
  for (const tile of Object.values(engine.board.tiles)) {
    seen.set(coordKey(tile.coord), tile.coord)
    for (const offset of neighbors) {
      const coord = { q: tile.coord.q + offset.q, r: tile.coord.r + offset.r }
      seen.set(coordKey(coord), coord)
    }
  }
  return [...seen.values()]
}

function isLegal(state: GameState, action: GameAction): boolean {
  return applyAction(state, action).ok
}

/**
 * The first legal move for whoever may act, or null when the game is over.
 * Always takes the first option it finds and passes on every unit action and
 * buy-back — it exercises the plumbing (setup, the phase cycle, the write
 * paths), not interesting play.
 */
export function simplestMove(state: GameState): GameAction | null {
  if (state.status !== 'active') return null
  const engine = toEngine(state)

  if (engine.status === 'boardSetup') {
    const tilePlacerId = currentTilePlacerId(engine)
    if (tilePlacerId) {
      for (const anchor of candidateAnchors(engine)) {
        for (let rotationSteps = 0; rotationSteps < 6; rotationSteps++) {
          const action: GameAction = { type: 'PLACE_TILE', playerId: tilePlacerId, anchor, rotationSteps }
          if (isLegal(state, action)) return action
        }
      }
      return null
    }
    const unitPlacerId = currentUnitPlacerId(engine)
    const unitKind = unitPlacerId ? engine.boardSetup?.unitsRemainingByPlayerId[unitPlacerId]?.[0] : undefined
    if (!unitPlacerId || !unitKind) return null
    for (const tile of Object.values(engine.board.tiles)) {
      const action: GameAction = { type: 'PLACE_UNIT', playerId: unitPlacerId, unitKind, coord: tile.coord }
      if (isLegal(state, action)) return action
    }
    return null
  }

  const playerId = state.pendingPlayerIds[0]
  if (!playerId) return null
  const player = engine.players.find((p) => p.id === playerId)
  if (!player) return null
  switch (engine.roundPhase) {
    case 'selectCards':
      return player.handCardIds.length > 0 ? { type: 'CHOOSE_CARD', playerId, cardId: player.handCardIds[0] } : null
    case 'decline': {
      const cardId = player.handCardIds[0] ?? player.discardCardIds[0]
      return cardId ? { type: 'MOVE_TO_DECLINE', playerId, cardId } : null
    }
    case 'actions':
      return { type: 'PASS_ACTIONS', playerId }
    case 'purchase':
      return { type: 'PASS_PURCHASE', playerId }
  }
}
