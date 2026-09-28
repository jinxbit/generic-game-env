// Test helpers for Kogge — this package's `testing` entry point.

import { createNewGame, registerGame, type PlayMode, type Random, type Uint32Source } from '@game-platform/sdk'
import { act, seatPlayers } from '@game-platform/sdk/testing'
import { canBid, sameBid } from './bids.ts'
import { COLORS } from './data.ts'
import { goodsTotal, pendingOf, phaseOf, type GameState } from './engine.ts'
import { gameDefinition, normalizeGameOptions } from './rules.ts'
import type { Color, GameAction, GameData, GameOptions, Goods, Payment, PlayerId } from './types.ts'

export { act, withoutTimestamps } from '@game-platform/sdk/testing'

/** A deterministic stream of 32-bit numbers for a test (a plain LCG). */
export function testRandom(seed = 1): Uint32Source {
  let x = seed >>> 0 || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x
  }
}

/** A fresh genesis with players `p1..pN` (Alice, Bob, ...). Defaults: 3 players, live, base rules. */
export function newGame(params: { players?: number; playMode?: PlayMode; hiddenInformationEnabled?: boolean; options?: Partial<GameOptions>; seed?: number; gameId?: string } = {}): GameState {
  registerGame(gameDefinition)
  return createNewGame({
    gameId: params.gameId ?? 'game_1',
    gameType: gameDefinition.id,
    playMode: params.playMode ?? 'live',
    hiddenInformationEnabled: params.hiddenInformationEnabled,
    options: normalizeGameOptions(params.options ?? {}),
    players: seatPlayers(params.players ?? 3),
    setupRandom: testRandom(params.seed ?? 1),
  }) as GameState
}

/** Applies a game action with test randomness, throwing on rejection. */
export function play(state: GameState, action: GameAction, random: number | Uint32Source = state.actionHistory.length + 7): GameState {
  return act(state, action, { random: typeof random === 'number' ? testRandom(random) : random })
}

/** Edits a copy of the game slice to arrange a position for a test, re-deriving whose move it is. */
export function arrange(state: GameState, edit: (game: GameData) => void): GameState {
  const game = JSON.parse(JSON.stringify(state.game)) as GameData
  edit(game)
  const pending = pendingOf(game)
  return { ...state, game, turn: game.round, phase: phaseOf(game), pendingPlayerIds: pending, activePlayerId: game.stage === 'start' ? null : (pending[0] ?? null) }
}

/**
 * A position in the Actions phase: `playerId`'s turn, their boat in `city`
 * (which the edit may change further). Everyone else has already had a turn.
 */
export function atTurn(state: GameState, playerId: PlayerId, city: number, edit: (game: GameData) => void = () => {}): GameState {
  return arrange(state, (g) => {
    g.stage = 'actions'
    g.bids = []
    g.order = [...g.order.filter((id) => id !== playerId), playerId]
    g.players[playerId].city = city
    g.turn = { playerId, moves: 0, moved: false, movementDone: false, used: [] }
    edit(g)
  })
}

/** Picks distinct starting cities 0, 1, 2… for every player, in seat order. */
export function startAll(state: GameState, cities?: number[]): GameState {
  const g = state.game
  return g.seatOrder.reduce((s, id, i) => play(s, { type: 'START_PICK', playerId: id, attempt: s.game.startAttempt, value: cities?.[i] ?? i }), state)
}

export function goods(partial: Partial<Goods> = {}): Goods {
  return { grey: 0, orange: 0, purple: 0, white: 0, ...partial }
}

/** The cheapest thing a player can pay a move with, or null. */
function cheapestPayment(g: GameData, id: PlayerId): Payment | null {
  const p = g.players[id]
  const value = p.markers.findIndex((n) => n > 0)
  if (value >= 0) return { kind: 'marker', value }
  const color = COLORS.find((c) => p.goods[c] > 0)
  return color ? { kind: 'good', color } : null
}

/** The smallest legal bid: the lowest single marker not yet bid, or a pair. */
function smallestBid(g: GameData, id: PlayerId): number[] {
  const hand = g.players[id].markers
  const taken = g.bids.flatMap((b) => (b.markers ? [b.markers] : []))
  for (let v = 0; v < hand.length; v++) if (hand[v] > 0 && !taken.some((b) => sameBid(b, [v]))) return [v]
  for (let a = 0; a < hand.length; a++) {
    for (let b = a; b < hand.length; b++) {
      const bid = [a, b]
      if ((a === b ? hand[a] >= 2 : hand[a] > 0 && hand[b] > 0) && !taken.some((t) => sameBid(t, bid))) return bid
    }
  }
  if (!canBid(hand, taken)) throw new Error('No bid possible')
  return hand.flatMap((n, v) => Array<number>(n).fill(v))
}

/** Answers whatever the game is waiting on with a simple legal move. */
export function simplestMove(state: GameState, random?: Random): GameAction {
  const g = state.game
  const id = state.pendingPlayerIds[0]
  const r = <T,>(items: T[]): T => (random ? random.pick(items) : items[0])
  switch (g.stage) {
    case 'start': {
      const hand = g.players[id].markers
      const free = hand.map((_, v) => v).filter((v) => g.cities[v].houses.length === 0 && !Object.values(g.startPicks).includes(v))
      return { type: 'START_PICK', playerId: id, attempt: g.startAttempt, value: r(free.length ? free : [0]) }
    }
    case 'auction':
      return { type: 'BID', playerId: id, markers: smallestBid(g, id) }
    case 'guildmaster':
      return { type: 'MOVE_GUILDMASTER', playerId: id, steps: r([1, 2] as const) }
    case 'actions': {
      if (g.offer) return { type: 'RESPOND_TRADE', playerId: id, accept: false }
      const raid = g.raid
      if (raid?.step === 'divide') {
        const own = g.players[id].goods
        const half = goodsTotal(own) / 2
        const group: Goods = { grey: 0, orange: 0, purple: 0, white: 0 }
        let n = 0
        for (const c of COLORS as Color[]) {
          const k = Math.min(own[c], Math.floor(half) - n)
          group[c] = k
          n += k
        }
        return { type: 'RAID_DIVIDE', playerId: id, group }
      }
      if (raid?.step === 'take') return { type: 'RAID_TAKE', playerId: id, group: 0 }
      if (raid?.step === 'route') return { type: 'RAID_ROUTE', playerId: id, route: r([0, 1] as const) }
      const turn = g.turn!
      if (!turn.movementDone && turn.moves === 0) {
        const here = g.players[id].city!
        const routes = ([0, 1] as const).filter((i) => {
          const slot = g.cities[here].routes[i]
          return slot.faceDown || !g.cities[slot.value!].raids.includes(id)
        })
        if (routes.length) return { type: 'MOVE', playerId: id, route: r(routes), payments: [] }
      }
      if (random && !turn.movementDone && random.next() < 0.3) {
        const pay = cheapestPayment(g, id)
        const here = g.players[id].city!
        const slot = g.cities[here].routes[0]
        if (pay && turn.moves === 1 && (slot.faceDown || !g.cities[slot.value!].raids.includes(id))) {
          const payments = g.players[id].bonuses.includes('moves') ? [] : [pay]
          return { type: 'MOVE', playerId: id, route: 0, payments }
        }
      }
      return { type: 'END_TURN', playerId: id }
    }
    case 'over':
      throw new Error('The game is over')
  }
}
