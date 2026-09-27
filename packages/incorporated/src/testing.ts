// Test helpers for Incorporated — this package's `testing` entry point.

import { createNewGame, randomFrom, registerGame, type PlayMode, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import type { Ctx, GameState } from './context.ts'
import { finish, run } from './engine.ts'
import { gameDefinition, normalizeGameOptions } from './rules.ts'
import type { CorporationId, GameAction, GameOptions, PlayerId } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream of 32-bit numbers for a test (a plain LCG). */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/**
 * A fresh genesis with players `p1..pN` (Alice, Bob, Carol, ...). Defaults: 4
 * players, live, hidden information off, base rules. Registers the game
 * first, so a test needs no setup.
 */
export function newGame(params: { players?: number; playMode?: PlayMode; hiddenInformationEnabled?: boolean; options?: Partial<GameOptions>; seed?: number; gameId?: string } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: params.gameId ?? 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: normalizeGameOptions(params.options ?? {}),
    players: seatPlayers(params.players ?? 4),
    setupRandom: testRandom(params.seed ?? 1),
  }) as GameState
}

/**
 * A source whose draws land on exactly these die faces, in order — e.g.
 * `dice([3, 6])` makes the next `random.int(1, 6)` a 3. Throws once used up.
 */
export function dice(...faces: [value: number, sides: number][]): Uint32Source {
  const queue = [...faces]
  return () => {
    const next = queue.shift()
    if (!next) throw new Error('No more dice queued')
    const [value, sides] = next
    return Math.floor(((value - 1 + 0.5) / sides) * 4294967296)
  }
}

/** Applies a game action with test randomness (a seed, or a source such as dice()), throwing on rejection. */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = state.actionHistory.length + 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/**
 * Arranges a position: edits a copy of the game slice, then runs the phase
 * machine from there (queue `tasks` in the edit to start a phase) — without
 * logging an action. For setting up rules tests only.
 */
export function arrange(state: GameState, edit: (game: GameState['game']) => void, random: number | Uint32Source = 99): GameState {
  const g = JSON.parse(JSON.stringify(state.game)) as GameState['game']
  g.journal = []
  edit(g)
  const ctx: Ctx = { state, options: state.options, random: randomFrom(typeof random === 'number' ? testRandom(random) : random), g }
  run(ctx)
  return finish(ctx)
}

/** The player running a corporation. */
export function corpPlayer(state: GameState, corp: CorporationId): PlayerId {
  const id = state.game.seatOrder.find((p) => state.game.players[p].corp === corp)
  if (!id) throw new Error(`${corp} is not in this game`)
  return id
}

/**
 * Answers whatever the game is waiting on with the simplest legal move —
 * passing, declining, repaying nothing, taking the first option — until it
 * reaches `until` or ends. For driving a game to a phase in tests.
 */
export function autoplay(state: GameState, until: (s: GameState) => boolean = () => false, maxSteps = 2000): GameState {
  let s = state
  for (let i = 0; i < maxSteps && s.status === 'active' && !until(s); i++) s = play(s, simplestMove(s))
  return s
}

export function simplestMove(state: GameState): GameAction {
  const prompt = state.game.prompt
  if (!prompt) throw new Error('Nothing to answer')
  const g = state.game
  switch (prompt.kind) {
    case 'investTurn':
      return { type: 'INVEST_PASS', playerId: prompt.playerId }
    case 'auction':
      return { type: 'PASS_BID', playerId: prompt.current }
    case 'sealedAuction': {
      const id = state.pendingPlayerIds[0]
      return { type: 'SEALED_BID', playerId: id, auctionId: prompt.auctionId, amount: 0 }
    }
    case 'sealedTie':
      return { type: 'PICK_WINNER', playerId: prompt.playerId, winnerId: prompt.tied[0] }
    case 'closedSell':
      return { type: 'CLOSED_SELL', playerId: prompt.playerId, sell: false }
    case 'chooseSquare':
      return { type: 'CHOOSE_SQUARE', playerId: prompt.playerId, square: prompt.optional ? null : prompt.options[0] }
    case 'removeCubes':
      return { type: 'REMOVE_CUBES', playerId: prompt.playerId, cubes: prompt.options.slice(0, prompt.count) }
    case 'freeAttack':
      return { type: 'FREE_ATTACK', playerId: prompt.playerId, attacks: [] }
    case 'income': {
      const shares = g.players[prompt.playerId].shares
      const allocation: Record<string, number> = {}
      let left = prompt.available
      for (const [country, n] of Object.entries(shares)) {
        const take = Math.min(n, left)
        if (take > 0) allocation[country] = take
        left -= take
      }
      return { type: 'ALLOCATE_INCOME', playerId: prompt.playerId, allocation }
    }
    case 'competitionTurn':
      return { type: 'COMPETITION_PASS', playerId: prompt.playerId, defenders: Array.from({ length: g.players[prompt.playerId].executives }, () => 'US') }
    case 'lobbyTurn':
      if (prompt.mustPowerPlay) {
        const zone = (Object.keys(g.battlegrounds) as (keyof typeof g.battlegrounds)[]).find((z) => g.battlegrounds[z] && !g.lobbyUsed[`POWER_PLAY:${z}`])!
        return { type: 'LOBBY', playerId: prompt.playerId, event: { kind: 'powerPlay', zone, camp: 'NATO' } }
      }
      return { type: 'LOBBY', playerId: prompt.playerId, event: { kind: 'taxHavens' } }
    case 'moveMarker':
      return { type: 'MOVE_MARKER', playerId: prompt.playerId, country: prompt.options[0] }
    case 'subsidies':
      return { type: 'SUBSIDIES_SWAP', playerId: prompt.playerId, peekIndex: 0, revealedIndex: 0 }
    case 'stimulus':
      return { type: 'STIMULUS_KEEP', playerId: prompt.playerId, index: 0 }
    case 'outlookChoice':
      return { type: 'OUTLOOK_CHOICE', playerId: prompt.playerId, choice: prompt.options[0] }
    case 'useAbility':
      return { type: 'USE_ABILITY', playerId: prompt.playerId, use: false }
    case 'pickOutlook':
      return { type: 'PICK_OUTLOOK', playerId: prompt.playerId, index: 0 }
    case 'crisisDecision':
      return { type: 'CRISIS_DECISION', playerId: prompt.playerId, decision: 'accept' }
    case 'crisisDiscard':
      return { type: 'CRISIS_DISCARD', playerId: prompt.playerId, indices: Array.from({ length: prompt.count }, (_, i) => i) }
    case 'repayment':
      return { type: 'REPAY', playerId: prompt.waiting[0], promptId: prompt.promptId, count: 0 }
  }
}

/** Replaces the game slice (for arranging a position in a test). */
export function withGame(state: GameState, edit: (game: GameState['game']) => void): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameState['game']
  edit(game)
  return { ...state, game }
}
