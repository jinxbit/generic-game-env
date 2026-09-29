// Rules for Magna Grecia (RULES.md is the source of truth; its rule ids are
// cited throughout) — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// How it's organised: ./board.ts holds everything that is a pure function of
// the tiles (cities, roads, connections, market values, what a tile on a cell
// would do, oracle attention); ./data.ts the map and the action cards. This
// module runs the round: the card's turn order, each player's basic actions
// within the card's allowance (R-ACT-04), then one market built or sold, then
// the next player — and draws the next card when a round ends. The envelope's
// `phase`, `activePlayerId` and `pendingPlayerIds` are derived from the game
// in one place (`withEnvelope`), so they can never go stale.
//
// Nothing is secret: tiles, points and the current card are on the table, and
// each round's card is drawn when the round starts rather than sitting in a
// hidden pre-shuffled stack (RULES.md AMBIG-3). The draws — oracle positions
// and the first card in `setup`, one number per new round after that — come
// only from the framework's `Random`.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, GameState as PlatformGameState, LobbyState, Random } from '@game-platform/sdk'
import {
  analyse,
  isCell,
  isStraight,
  marketValue,
  normalizeEnds,
  planCity,
  planMarket,
  ROAD_SHAPES,
  roadProblem,
  updateOracles,
  type Analysis,
} from './board.ts'
import {
  cardById,
  cellLabel,
  CARDS,
  CELLS,
  enhanced,
  MARKETS_PER_PLAYER,
  ORACLE_POINTS,
  oracleCount,
  SLOT_NAMES,
  STARTING_SUPPLY,
  startingPoints,
  TILES_PER_KIND,
  VILLAGES,
} from './data.ts'
import type { ActionCard, Dir, FinalScore, GameAction, GameData, GameOptions, Market, MoveEvent, PlayerData, PlayerId, TurnProgress } from './types.ts'

export type * from './types.ts'
export * from './board.ts'
export * from './data.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export const DEFAULT_GAME_OPTIONS: GameOptions = { rounds: 12 }

export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return { rounds: o.rounds === 8 ? 8 : 12 }
}

class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message)
}

function freshProgress(): TurnProgress {
  return { roads: 0, cities: 0, founded: false, resupplied: null }
}

function isOut(state: GameState, playerId: PlayerId): boolean {
  return state.players.find((p) => p.id === playerId)?.eliminated ?? true
}

export function currentCard(game: GameData): ActionCard {
  return cardById(game.card)
}

/**
 * R-ACT-04: whether a turn that has placed `roads` road tiles and `cities`
 * city tiles and resupplied `resupply` tiles stays within the card — up to
 * two actions at their card values, or one at its enhanced value.
 */
export function withinAllowance(card: ActionCard, roads: number, cities: number, resupply: number): boolean {
  const taken = [roads, cities, resupply].filter((n) => n > 0).length
  if (taken > 2) return false
  const cap = (kind: 'roads' | 'cities' | 'resupply') => (taken === 1 ? enhanced(kind, card[kind]) : card[kind])
  return roads <= cap('roads') && cities <= cap('cities') && resupply <= cap('resupply')
}

/** How many more tiles of each kind the turn player may place or resupply now, by the card alone (R-ACT-02/04). */
export function allowanceLeft(game: GameData): { roads: number; cities: number; resupply: number } {
  const card = currentCard(game)
  const { roads, cities, resupplied } = game.progress
  if (resupplied !== null) return { roads: 0, cities: 0, resupply: 0 }
  const most = (fits: (n: number) => boolean) => {
    let n = 0
    while (n < 20 && fits(n + 1)) n++
    return n
  }
  return {
    roads: most((n) => withinAllowance(card, roads + n, cities, 0)),
    cities: most((n) => withinAllowance(card, roads, cities + n, 0)),
    resupply: most((n) => withinAllowance(card, roads, cities, n)),
  }
}

/** Every legal road placement for the turn player right now (R-ROAD-01..04, R-ACT-04). */
export function legalRoads(game: GameData): { cell: number; ends: [Dir, Dir] }[] {
  const id = game.turnPlayerId
  if (game.step !== 'turn' || !id || game.players[id].supply.roads < 1 || allowanceLeft(game).roads < 1) return []
  const out: { cell: number; ends: [Dir, Dir] }[] = []
  for (let cell = 0; cell < CELLS; cell++) {
    for (const ends of ROAD_SHAPES) if (roadProblem(game, id, cell, ends) === null) out.push({ cell, ends })
  }
  return out
}

/** Why the turn player may not put a city tile on `cell`, or null — every check, budget included (§7). */
export function cityProblem(game: GameData, analysis: Analysis, cell: number): string | null {
  const id = game.turnPlayerId!
  const plan = planCity(game, analysis, id, cell)
  if (!plan.ok) return plan.reason
  const n = plan.tiles.length
  const p = game.players[id]
  if (plan.founds && game.progress.founded) return 'Only one city may be founded per turn.'
  if (allowanceLeft(game).cities < n) return n === 2 ? 'Bridging onto the village needs two city tiles this turn.' : 'No city tiles left to place this turn.'
  if (p.supply.cities < n) return n === 2 ? 'Bridging onto the village needs two city tiles in your supply.' : 'You have no city tiles in your supply.'
  if (p.points < n) return n === 2 ? 'Bridging onto the village costs 2 points.' : 'A city tile costs 1 point.'
  return null
}

/** Every cell the turn player may put a city tile on right now. */
export function legalCityCells(game: GameData, analysis: Analysis = analyse(game)): number[] {
  if (game.step !== 'turn' || !game.turnPlayerId) return []
  const out: number[] = []
  for (let cell = 0; cell < CELLS; cell++) if (cityProblem(game, analysis, cell) === null) out.push(cell)
  return out
}

/** Every place the turn player could build a market in right now, with its cost (R-MKT-01/02). */
export function legalMarkets(game: GameData, analysis: Analysis = analyse(game)): { cell: number; cost: number }[] {
  const id = game.turnPlayerId
  if (game.step !== 'turn' || !id || game.players[id].markets < 1) return []
  const seen = new Set<string>()
  const out: { cell: number; cost: number }[] = []
  for (const cell of [...game.cities.map((c) => c.id), ...VILLAGES.map((v) => v.cell)]) {
    const plan = planMarket(game, analysis, id, cell)
    if (!plan.ok || seen.has(plan.place) || plan.cost > game.players[id].points) continue
    seen.add(plan.place)
    out.push({ cell: plan.cell, cost: plan.cost })
  }
  return out
}

/** The turn player's markets they could sell right now, with their value (R-MKT-05). */
export function sellableMarkets(game: GameData, analysis: Analysis = analyse(game)): { market: Market; value: number }[] {
  const id = game.turnPlayerId
  if (game.step !== 'turn' || !id) return []
  return game.markets.filter((m) => m.owner === id && !m.sold).map((market) => ({ market, value: marketValue(game, analysis, market) })).filter((m) => m.value > 0)
}

/** R-END-01 for one player, from the board as it stands. */
export function scoreOf(game: GameData, playerId: PlayerId, analysis: Analysis = analyse(game)): FinalScore {
  const points = game.players[playerId]?.points ?? 0
  const markets = game.markets.filter((m) => m.owner === playerId).reduce((total, m) => total + marketValue(game, analysis, m), 0)
  const cityIds = new Set(game.cities.filter((c) => c.owner === playerId).map((c) => c.id))
  const oracles = game.oracles.filter((o) => o.attention !== null && cityIds.has(o.attention)).length * ORACLE_POINTS
  return { points, markets, oracles, total: points + markets + oracles }
}

/** Keeps the envelope in step with the game — `pendingPlayerIds` is derived here and nowhere else. */
export function withEnvelope(state: GameState, game: GameData): GameState {
  if (game.step === 'ended') return { ...state, game, turn: game.round, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [] }
  const id = game.turnPlayerId
  return { ...state, game, turn: game.round, phase: 'turn', activePlayerId: id, pendingPlayerIds: id ? [id] : [] }
}

/** R-SETUP-05 / AMBIG-3: the next card, uniformly from those whose border colour hasn't come up yet in this block of four. */
function drawCard(game: GameData, random: Random): number {
  const blockStart = game.usedCards.length - (game.usedCards.length % 4)
  const shown = new Set(game.usedCards.slice(blockStart).map((id) => cardById(id).border))
  const eligible = game.deck.filter((id) => !shown.has(cardById(id).border))
  const card = eligible[random.int(0, eligible.length - 1)]
  game.deck = game.deck.filter((id) => id !== card)
  game.usedCards = [...game.usedCards, card]
  return card
}

/** R-ROUND-02: this card's players in turn order, skipping unplayed colours and conceded players. */
function orderFor(state: GameState, game: GameData, card: ActionCard): PlayerId[] {
  return card.order.map((slot) => game.seatOrder[slot]).filter((id): id is PlayerId => id !== undefined && !isOut(state, id))
}

/** Starts round `game.round + 1` (or ends the game). Mutates `game`; returns the winners if it ended. */
function nextRound(state: GameState, game: GameData, random: Random): PlayerId[] | null {
  if (game.round >= game.rounds) return finish(state, game)
  game.round += 1
  game.card = drawCard(game, random)
  game.roundOrder = orderFor(state, game, currentCard(game))
  game.turnPlayerId = game.roundOrder[0] ?? null
  game.events = [...game.events, { kind: 'round', round: game.round, card: game.card }]
  return null
}

/** Passes the card on (R-ROUND-03), or starts the next round. Mutates `game`; returns the winners if the game ended. */
function passCard(state: GameState, game: GameData, random: Random): PlayerId[] | null {
  game.progress = freshProgress()
  const at = game.turnPlayerId ? game.roundOrder.indexOf(game.turnPlayerId) : -1
  const next = game.roundOrder.slice(at + 1).find((id) => !isOut(state, id))
  if (next) {
    game.turnPlayerId = next
    return null
  }
  return nextRound(state, game, random)
}

/** R-END-01/02. Mutates `game`; returns the winners. */
function finish(state: GameState, game: GameData): PlayerId[] {
  game.step = 'ended'
  game.turnPlayerId = null
  const analysis = analyse(game)
  const standing = game.seatOrder.filter((id) => !isOut(state, id))
  game.finalScores = Object.fromEntries(game.seatOrder.map((id) => [id, scoreOf(game, id, analysis)]))
  const best = Math.max(...standing.map((id) => game.finalScores![id].total))
  return standing.filter((id) => game.finalScores![id].total === best)
}

function requireTurn(game: GameData, playerId: PlayerId): PlayerData {
  if (game.step !== 'turn' || game.turnPlayerId !== playerId) fail("It isn't your turn.")
  return game.players[playerId]
}

function requirePlacing(game: GameData): void {
  if (game.progress.resupplied !== null) fail('You have resupplied — resupply comes last, so no more tiles this turn.')
}

/** After tiles change: R-ORACLE-02..04. Mutates `game`. */
function afterTiles(game: GameData, mover: PlayerId): void {
  const { oracles, events } = updateOracles(game, analyse(game), mover)
  game.oracles = oracles
  game.events = [...game.events, ...events]
}

/** R-ROAD-01..05. */
function onPlaceRoad(game: GameData, playerId: PlayerId, rawCell: unknown, rawEnds: unknown): void {
  const p = requireTurn(game, playerId)
  requirePlacing(game)
  if (!isCell(rawCell)) fail('Choose a space on the board.')
  const ends = normalizeEnds(rawEnds)
  if (!ends) fail('A road tile joins two different sides of its space.')
  if (p.supply.roads < 1) fail('You have no road tiles in your supply.')
  if (!withinAllowance(currentCard(game), game.progress.roads + 1, game.progress.cities, 0)) fail('The card allows no more road tiles this turn.')
  const problem = roadProblem(game, playerId, rawCell, ends)
  if (problem) fail(problem)
  const roads = [...game.roads]
  roads[rawCell] = { owner: playerId, ends }
  game.roads = roads
  game.players[playerId] = { ...p, supply: { ...p.supply, roads: p.supply.roads - 1 } }
  game.progress = { ...game.progress, roads: game.progress.roads + 1 }
  afterTiles(game, playerId)
}

/** R-CITY-01..09. */
function onPlaceCity(game: GameData, playerId: PlayerId, rawCell: unknown): void {
  const p = requireTurn(game, playerId)
  requirePlacing(game)
  if (!isCell(rawCell)) fail('Choose a space on the board.')
  const before = analyse(game)
  const problem = cityProblem(game, before, rawCell)
  if (problem) fail(problem)
  const plan = planCity(game, before, playerId, rawCell)
  if (!plan.ok) fail(plan.reason)
  const n = plan.tiles.length
  const cityTiles = [...game.cityTiles]
  for (const tile of plan.tiles) cityTiles[tile] = playerId
  game.cityTiles = cityTiles
  let player: PlayerData = { ...p, points: p.points - n, supply: { ...p.supply, cities: p.supply.cities - n } }
  game.progress = { ...game.progress, cities: game.progress.cities + n, founded: game.progress.founded || plan.founds }
  if (plan.founds) {
    game.cities = [...game.cities, { id: plan.city, owner: playerId }]
    // R-CITY-08: a free market, unless the founder already has one in the village.
    if (player.markets > 0 && !game.markets.some((m) => m.owner === playerId && m.cell === plan.city)) {
      game.markets = [...game.markets, { owner: playerId, cell: plan.city, sold: false }]
      player = { ...player, markets: player.markets - 1 }
      game.events = [...game.events, { kind: 'foundingMarket', owner: playerId, city: plan.city }]
    }
  } else if (plan.village !== null) {
    // R-CITY-09 / AMBIG-8: an absorbed village's market leaves if its owner already has one in the city.
    const after = analyse(game)
    const inCity = (m: Market) => after.cityOf[m.cell] === plan.city
    const kept: Market[] = []
    for (const m of game.markets) {
      const duplicate = m.cell === plan.village && inCity(m) && game.markets.some((o) => o !== m && o.owner === m.owner && inCity(o))
      if (!duplicate) {
        kept.push(m)
        continue
      }
      game.events = [...game.events, { kind: 'marketRemoved', owner: m.owner, cell: m.cell, sold: m.sold }]
      if (!m.sold) {
        const owner = m.owner === playerId ? player : game.players[m.owner]
        const back = { ...owner, markets: owner.markets + 1 }
        if (m.owner === playerId) player = back
        else game.players[m.owner] = back
      }
    }
    game.markets = kept
  }
  game.players[playerId] = player
  afterTiles(game, playerId)
}

function requireCount(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail(`Choose a whole number of ${what}.`)
  return value
}

/** R-ACT-02/05. */
function onResupply(game: GameData, playerId: PlayerId, rawRoads: unknown, rawCities: unknown): void {
  const p = requireTurn(game, playerId)
  if (game.progress.resupplied !== null) fail('You have already resupplied this turn.')
  const roads = requireCount(rawRoads, 'road tiles')
  const cities = requireCount(rawCities, 'city tiles')
  const total = roads + cities
  if (total < 1) fail('Resupply at least one tile.')
  if (roads > p.staging.roads) fail(`Only ${p.staging.roads} road tile${p.staging.roads === 1 ? '' : 's'} left to resupply.`)
  if (cities > p.staging.cities) fail(`Only ${p.staging.cities} city tile${p.staging.cities === 1 ? '' : 's'} left to resupply.`)
  if (!withinAllowance(currentCard(game), game.progress.roads, game.progress.cities, total)) {
    const left = allowanceLeft(game).resupply
    fail(left === 0 ? 'The card allows no resupply this turn.' : `The card allows resupplying at most ${left} tiles this turn.`)
  }
  game.players[playerId] = {
    ...p,
    supply: { roads: p.supply.roads + roads, cities: p.supply.cities + cities },
    staging: { roads: p.staging.roads - roads, cities: p.staging.cities - cities },
  }
  game.progress = { ...game.progress, resupplied: total }
}

/** R-MKT-01/02/06. */
function onBuildMarket(game: GameData, playerId: PlayerId, rawCell: unknown): void {
  const p = requireTurn(game, playerId)
  if (!isCell(rawCell)) fail('Choose a village or city.')
  if (p.markets < 1) fail('You have no markets left.')
  const plan = planMarket(game, analyse(game), playerId, rawCell)
  if (!plan.ok) fail(plan.reason)
  if (plan.cost > p.points) fail(`That market costs ${plan.cost} points; you have ${p.points}.`)
  game.markets = [...game.markets, { owner: playerId, cell: plan.cell, sold: false }]
  game.players[playerId] = { ...p, points: p.points - plan.cost, markets: p.markets - 1 }
}

/** R-MKT-05/06. Returns the value sold for. */
function onSellMarket(game: GameData, playerId: PlayerId, rawCell: unknown): number {
  const p = requireTurn(game, playerId)
  const index = game.markets.findIndex((m) => m.owner === playerId && m.cell === rawCell)
  if (index < 0) fail("You don't have a market there.")
  const market = game.markets[index]
  if (market.sold) fail('That market is already sold.')
  const value = marketValue(game, analyse(game), market)
  if (value === 0) fail('Only an active market worth at least 1 point can be sold.')
  const markets = [...game.markets]
  markets[index] = { ...market, sold: true }
  game.markets = markets
  game.players[playerId] = { ...p, points: p.points + value }
  return value
}

function apply(state: GameState, action: GameAction, random: Random): GameState {
  // A working copy the handlers may reassign fields of — `players` is copied
  // too because they replace entries in it. Never mutate `state` (replay and
  // undo keep it).
  const game: GameData = { ...state.game, players: { ...state.game.players }, events: [] }
  const actor = state.players.find((p) => p.id === action.playerId)
  if (!actor) fail(`Unknown player: ${action.playerId}`)
  if (actor.eliminated) fail('You are no longer in this game.')
  let winners: PlayerId[] | null = null
  switch (action.type) {
    case 'PLACE_ROAD':
      onPlaceRoad(game, action.playerId, action.cell, action.ends)
      break
    case 'PLACE_CITY':
      onPlaceCity(game, action.playerId, action.cell)
      break
    case 'RESUPPLY':
      onResupply(game, action.playerId, action.roads, action.cities)
      break
    case 'BUILD_MARKET':
      onBuildMarket(game, action.playerId, action.cell)
      winners = passCard(state, game, random)
      break
    case 'SELL_MARKET':
      onSellMarket(game, action.playerId, action.cell)
      winners = passCard(state, game, random)
      break
    case 'END_TURN':
      requireTurn(game, action.playerId)
      winners = passCard(state, game, random)
      break
    default: {
      const unknown: never = action
      fail(`Unknown action: ${String((unknown as { type: unknown }).type)}`)
    }
  }
  const next = withEnvelope(state, game)
  return winners ? { ...next, winnerPlayerIds: winners } : next
}

/** Whether the turn player has anything to do but end the turn. */
export function hasChoice(game: GameData): boolean {
  const id = game.turnPlayerId
  if (game.step !== 'turn' || !id) return false
  const p = game.players[id]
  const left = allowanceLeft(game)
  if (left.resupply > 0 && p.staging.roads + p.staging.cities > 0) return true
  const analysis = analyse(game)
  if (sellableMarkets(game, analysis).length > 0) return true
  if (legalMarkets(game, analysis).length > 0) return true
  if (left.cities > 0 && p.supply.cities > 0 && p.points > 0 && legalCityCells(game, analysis).length > 0) return true
  return legalRoads(game).length > 0
}

export function slotName(slot: number): string {
  return SLOT_NAMES[slot] ?? `colour ${slot + 1}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function describeCard(card: ActionCard): string {
  return `roads ${card.roads}, cities ${card.cities}, resupply ${card.resupply}`
}

/** Log lines for what a move set off: founding markets, oracles turning, a new round. */
function eventLines(after: GameState): { playerId: string | null; message: string }[] {
  const g = after.game
  return g.events.map((event: MoveEvent) => {
    switch (event.kind) {
      case 'foundingMarket':
        return { playerId: event.owner, message: `{player} placed a free market in the new city at ${cellLabel(event.city)}.` }
      case 'marketRemoved':
        return { playerId: event.owner, message: `{player}'s ${event.sold ? 'sold ' : ''}market in the absorbed village at ${cellLabel(event.cell)} left the board (one market per city).` }
      case 'oracle':
        return {
          playerId: event.owner,
          message: `The oracle at ${cellLabel(event.oracle)} ${event.from === null ? 'turned' : 'switched'} its attention to {player}'s city at ${cellLabel(event.to)}.`,
        }
      case 'round': {
        const card = cardById(event.card)
        const order = g.roundOrder.map((id) => after.players.find((p) => p.id === id)?.displayName ?? id).join(', ')
        return { playerId: null, message: `Round ${event.round} of ${g.rounds}: the card gives ${describeCard(card)}. Turn order: ${order}.` }
      }
    }
  })
}

function describe(action: GameAction, before: GameState, after: GameState): string {
  const g = after.game
  switch (action.type) {
    case 'PLACE_ROAD': {
      const ends = normalizeEnds(action.ends)!
      return `{player} built a ${isStraight(ends) ? 'straight' : 'curved'} road at ${cellLabel(action.cell)}.`
    }
    case 'PLACE_CITY': {
      const beforeTiles = new Set(before.game.cityTiles.flatMap((owner, cell) => (owner ? [cell] : [])))
      const placed = g.cityTiles.flatMap((owner, cell) => (owner && !beforeTiles.has(cell) ? [cell] : []))
      const founded = g.cities.length > before.game.cities.length
      const where = placed.map(cellLabel).join(' and ')
      return founded ? `{player} founded a city at ${where}.` : `{player} expanded a city at ${where}.`
    }
    case 'RESUPPLY': {
      const parts = [action.roads > 0 ? plural(action.roads, 'road tile') : '', action.cities > 0 ? plural(action.cities, 'city tile') : ''].filter(Boolean)
      return `{player} resupplied ${parts.join(' and ')}.`
    }
    case 'BUILD_MARKET': {
      const cost = before.game.players[action.playerId].points - g.players[action.playerId].points
      const market = g.markets[g.markets.length - 1]
      const inCity = before.game.cities.some((c) => c.id === market.cell)
      return `{player} built a market in the ${inCity ? 'city' : 'village'} at ${cellLabel(market.cell)} for ${plural(cost, 'point')}.`
    }
    case 'SELL_MARKET': {
      const value = g.players[action.playerId].points - before.game.players[action.playerId].points
      return `{player} sold their market at ${cellLabel(action.cell)} for ${plural(value, 'point')}.`
    }
    case 'END_TURN':
      return '{player} ended their turn.'
  }
}

function finalLines(before: GameState, after: GameState): { playerId: string | null; message: string }[] {
  if (before.status !== 'active' || after.status !== 'completed' || !after.game.finalScores) return []
  return after.game.seatOrder
    .filter((id) => !isOut(after, id))
    .map((id) => {
      const s = after.game.finalScores![id]
      return { playerId: id, message: `{player} scored ${s.total}: ${s.points} on the track, ${s.markets} from markets, ${s.oracles} from oracles.` }
    })
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'magna-grecia',
  rulesVersion: 1,
  title: 'Magna Grecia',
  turnLabel: 'Round',
  minPlayers: 2,
  maxPlayers: 4,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    return options.rounds === 8 ? 'Short game (8 rounds)' : '12 rounds'
  },

  setup(lobby: LobbyState<GameOptions>, random: Random) {
    const count = lobby.turnOrder.length
    const points = startingPoints(count)
    const players: Record<PlayerId, PlayerData> = Object.fromEntries(
      lobby.turnOrder.map((id, slot) => [
        id,
        {
          slot,
          points,
          supply: { roads: STARTING_SUPPLY, cities: STARTING_SUPPLY },
          staging: { roads: TILES_PER_KIND - STARTING_SUPPLY, cities: TILES_PER_KIND - STARTING_SUPPLY },
          markets: MARKETS_PER_PLAYER,
        },
      ]),
    )
    // R-SETUP-02: oracles at random on inland villages.
    const inland = VILLAGES.filter((v) => !v.green).map((v) => v.cell)
    const oracles = random
      .shuffle(inland)
      .slice(0, oracleCount(count))
      .sort((a, b) => a - b)
      .map((cell) => ({ cell, attention: null }))
    const game: GameData = {
      cityTiles: Array.from({ length: CELLS }, () => null),
      roads: Array.from({ length: CELLS }, () => null),
      cities: [],
      markets: [],
      oracles,
      players,
      seatOrder: [...lobby.turnOrder],
      rounds: lobby.options.rounds,
      round: 0,
      card: 0,
      deck: CARDS.map((c) => c.id),
      usedCards: [],
      roundOrder: [],
      turnPlayerId: null,
      progress: freshProgress(),
      step: 'turn',
      events: [],
      finalScores: null,
    }
    const state = { ...lobby, status: 'active' } as GameState
    nextRound(state, game, random)
    return withEnvelope(state, { ...game, events: [] })
  },

  applyAction(state, action, random): ActionResult<GameState> {
    if (state.status !== 'active') return { ok: false, error: 'The game is over.' }
    try {
      return { ok: true, state: apply(state, action, random) }
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, error: error.message }
      throw error
    }
  },

  onPlayerEliminated(state, playerId, random) {
    // R-LEAVE-01: their pieces stay; if it was their turn, the card moves on.
    if (state.status !== 'active' || state.game.turnPlayerId !== playerId) return state
    const game: GameData = { ...state.game, players: { ...state.game.players }, events: [] }
    const winners = passCard(state, game, random)
    const next = withEnvelope(state, game)
    return winners ? { ...next, winnerPlayerIds: winners } : next
  },

  nextForcedAction(state) {
    // Nothing left to do this turn: pass the card on rather than ask.
    const g = state.game
    if (state.status !== 'active' || g.step !== 'turn' || !g.turnPlayerId || hasChoice(g)) return null
    return { type: 'END_TURN', playerId: g.turnPlayerId }
  },

  redactGame(state) {
    return state.game
  },

  isActionSecret() {
    return false
  },

  describeAction(action, before, after): ActionDescription {
    return { message: describe(action, before, after), extraLines: [...eventLines(after), ...finalLines(before, after)] }
  },

  describePhase(phase) {
    return phase === 'turn' ? 'Building' : 'In progress'
  },
}

