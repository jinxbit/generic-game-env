// Test helpers for Bauernschlau — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { actionChoices, emptyFields, faceDownCells, fenceMoves, fenceMovesFor, gameDefinition, gameDefinitionV1, gameDefinitionV2, isEdgeVertex, radiusOf, vertexDepth, withEnvelope, type GameState } from './rules.ts'
import type { GameAction, GameData, GameOptions, Sheep } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream for tests (an LCG) — never used by the rules themselves. */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/** A source whose draws make `random.int(0, sides - 1)` return each of `indices` in turn. */
export function picks(...draws: [index: number, sides: number][]): Uint32Source {
  const queue = draws.map(([index, sides]) => Math.floor(((index + 0.5) / sides) * 4294967296))
  return () => {
    const next = queue.shift()
    if (next === undefined) throw new Error('No more draws queued')
    return next
  }
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults:
 * 3 players, live, the default options, the newest rules version, `p1` to
 * start (`start` is the seat index of the start player). Registers every
 * rules version first.
 */
export function newGame(
  params: { players?: number; playMode?: PlayMode; options?: Partial<GameOptions>; hiddenInformationEnabled?: boolean; lockRevealedInformationEnabled?: boolean; start?: number; rulesVersion?: number } = {},
): GameState {
  registerGame(gameDefinition)
  registerGame(gameDefinitionV1)
  registerGame(gameDefinitionV2)
  const players = params.players ?? 3
  return createNewGame({
    gameId: 'game_1',
    gameType: gameDefinition.id,
    rulesVersion: params.rulesVersion,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    lockRevealedInformationEnabled: params.lockRevealedInformationEnabled,
    options: params.options,
    players: seatPlayers(players),
    setupRandom: picks([params.start ?? 0, players]),
  }) as GameState
}

/** applyAction, throwing on rejection; `random` is a seed or a source (e.g. `picks(...)`). */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/** The turn player draws `sheep` (added to the bag, and drawn by forcing the random pick) and places it on `cell`. */
export function placeSheep(state: GameState, cell: number, sheep: Sheep = { value: 1, black: false }): GameState {
  const player = state.game.turnPlayerId!
  const withIt = arrange(state, (g) => (g.bag = [...g.bag, sheep]))
  const size = withIt.game.bag.length
  const drawn = play(withIt, { type: 'DRAW_SHEEP', playerId: player }, picks([size - 1, size]))
  return drawn.game.step === 'place' ? play(drawn, { type: 'PLACE_SHEEP', playerId: player, cell, index: 0 }) : drawn
}

/** Plays the whole opening round: every player places a +1 sheep on the first empty field. */
export function skipOpening(state: GameState): GameState {
  let s = state
  while (s.turn === 1 && s.status === 'active') s = placeSheep(s, emptyFields(s.game)[0])
  return s
}

/**
 * Builds borders straight to the edge (always the most outward fence) without
 * logging actions, each fence credited to — and taken from — the border's
 * counter-clockwise farm. Returns the edited game; use inside `arrange`.
 */
export function finishBorders(game: GameData, indices: number[]): void {
  for (const b of indices) {
    while (!game.borders[b].finished) {
      const [move] = fenceMoves(game.borders, b, radiusOf(game)).sort((x, y) => vertexDepth(y.to) - vertexDepth(x.to))
      if (!move) throw new Error(`Border ${b} can't be finished`)
      const border = game.borders[b]
      const builder = border.between[0]
      game.borders[b] = {
        ...border,
        path: border.path.length > 0 ? [...border.path, move.to] : [move.from, move.to],
        builtBy: [...border.builtBy, builder],
        finished: isEdgeVertex(move.to, radiusOf(game)),
      }
      game.farms[builder].fencesLeft -= 1
    }
  }
}

/**
 * Arranges a position without logging an action: edits a deep copy of the
 * game slice, then recomputes the envelope from the step. For setting up
 * rules tests only.
 */
export function arrange(state: GameState, edit: (game: GameData) => void, turn = state.turn): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameData
  edit(game)
  return withEnvelope({ ...state, turn }, game)
}

/**
 * A legal move for whoever must act that pushes towards the end: build the
 * most outward fence, else take a sheep, else a sheep special, flip, herd;
 * place drawn sheep on the first empty field.
 */
export function simplestMove(state: GameState): GameAction {
  const g = state.game
  const actor = state.pendingPlayerIds[0]
  if (g.step === 'place') return { type: 'PLACE_SHEEP', playerId: actor, cell: emptyFields(g)[0], index: 0 }
  if (g.step === 'ended') throw new Error('The game is over.')
  const can = actionChoices(state, g, actor)
  if (can.fence) {
    const [best] = fenceMovesFor(g, actor).sort((a, b) => vertexDepth(b.to) - vertexDepth(a.to))
    return { type: 'BUILD_FENCE', playerId: actor, ...best }
  }
  if (can.draw && !can.special) return { type: 'DRAW_SHEEP', playerId: actor }
  if (can.special) return { type: 'SHEEP_SPECIAL', playerId: actor }
  const [cell] = faceDownCells(g)
  if (can.flip) return { type: 'FLIP_SHEEP', playerId: actor, cell }
  throw new Error('No move available.')
}
