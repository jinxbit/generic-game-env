// Kogge's rules engine: setup, the round (auction → Guildmaster → actions)
// and scoring. RULES.md is the spec; rule ids are cited throughout.
//
// Each hook copies the game slice into a draft, mutates only the draft, and
// builds the next state from it with `finish`, which also derives the
// envelope fields the platform reads (pendingPlayerIds, activePlayerId,
// phase, turn). An illegal action throws a RuleError, which rules.ts turns
// into a rejection.
//
// Pure and deterministic: all randomness comes from the framework's Random.
// Server-safe: keep the `.ts` extensions on relative imports.

import type { GameState as PlatformGameState, LobbyState, Random } from '@game-platform/sdk'
import { END_AFTER_FINAL_ROUND, HOUSE_SUPPLY_ON_GUILDMASTER, TAX_ORDER } from './ambiguities.ts'
import { canBid, compareBids, sameBid, sortedBid } from './bids.ts'
import {
  BONUS_COPIES,
  BONUS_GOODS_COST,
  BONUS_TYPES,
  BONUS_VP,
  CITIES,
  CITY_COUNT,
  COLORS,
  DP_TO_WIN,
  GOOD_VP,
  GOODS_COUNTS,
  GOODS_PER_MARKER,
  GUILDMASTER_GOODS,
  GUILDMASTER_LAPS,
  HOUSE_VP,
  LOT_COUNT,
  LOT_SIZE,
  MARKER_COUNTS,
  markerColor,
  RAID_MARKER_COST,
  RAID_VP,
  START_CITY_GOODS,
  START_GOODS,
} from './data.ts'
import type {
  ActionKind,
  Bundle,
  CityState,
  Color,
  GameAction,
  GameData,
  GameOptions,
  Goods,
  GuildTrade,
  Payment,
  PlayerData,
  PlayerId,
  RaidTarget,
  RouteSlot,
  Score,
} from './types.ts'

export type GameState = PlatformGameState<GameData, GameOptions>

export class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message)
}

interface Ctx {
  g: GameData
  random: Random
  options: GameOptions
  /** Set when the game ends. */
  winners: PlayerId[] | null
}

// ---------------------------------------------------------------- helpers

export function emptyGoods(): Goods {
  return { grey: 0, orange: 0, purple: 0, white: 0 }
}

export function goodsTotal(goods: Goods): number {
  return COLORS.reduce((sum, c) => sum + goods[c], 0)
}

function addGoods(into: Goods, from: Goods): void {
  for (const c of COLORS) into[c] += from[c]
}

function hasGoods(holder: Goods, wanted: Goods): boolean {
  return COLORS.every((c) => holder[c] >= wanted[c])
}

function takeGoods(from: Goods, amount: Goods): void {
  for (const c of COLORS) from[c] -= amount[c]
}

function isGoods(value: unknown): value is Goods {
  if (typeof value !== 'object' || value === null) return false
  return COLORS.every((c) => Number.isInteger((value as Goods)[c]) && (value as Goods)[c] >= 0)
}

function isColor(value: unknown): value is Color {
  return typeof value === 'string' && (COLORS as readonly string[]).includes(value)
}

function isMarker(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < CITY_COUNT
}

function handCount(markers: readonly number[]): number[] {
  const counts = Array<number>(CITY_COUNT).fill(0)
  for (const m of markers) counts[m]++
  return counts
}

export function handSize(p: PlayerData): number {
  return p.markers.reduce((a, b) => a + b, 0)
}

function nextCity(city: number): number {
  return (city + 1) % CITY_COUNT
}

/** A random marker from the reserve, weighted by count (R-BRD-02), removed from it; null if empty. */
function drawMarker(g: GameData, random: Random): number | null {
  const total = g.reserve.reduce((a, b) => a + b, 0)
  if (total === 0) return null
  let k = random.int(0, total - 1)
  for (let value = 0; value < CITY_COUNT; value++) {
    if (k < g.reserve[value]) {
      g.reserve[value]--
      return value
    }
    k -= g.reserve[value]
  }
  return null
}

/** R-END-01 */
export function developmentPoints(g: GameData, playerId: PlayerId): number {
  const houses = g.cities.reduce((n, city) => n + city.houses.filter((h) => h.owner === playerId).length, 0)
  return houses + g.players[playerId].bonuses.length
}

/** R-END-04 */
export function scoreOf(g: GameData, playerId: PlayerId): Score {
  const p = g.players[playerId]
  const houses = g.cities.flatMap((city) => city.houses.filter((h) => h.owner === playerId))
  const goods = emptyGoods()
  addGoods(goods, p.goods)
  for (const house of houses) addGoods(goods, house.goods)
  const score = {
    houses: houses.length * HOUSE_VP,
    raids: p.raidMarkers * RAID_VP,
    bonuses: p.bonuses.length * BONUS_VP,
    goods: COLORS.reduce((sum, c) => sum + goods[c] * GOOD_VP[c], 0),
  }
  return { ...score, total: score.houses + score.raids + score.bonuses + score.goods }
}

/** Movement cost of the next move (R-MOV-01..03). */
export function moveCost(g: GameData, playerId: PlayerId, moves: number, passage: boolean): number {
  const bonus = g.players[playerId].bonuses
  const base = moves === 0 ? 0 : moves === 1 && bonus.includes('moves') ? 0 : 1
  return base + (passage ? 1 : 0)
}

/** The player to `playerId`'s left who is still playing (R-ACT-06). */
export function leftOf(g: GameData, playerId: PlayerId): PlayerId {
  const seats = g.seatOrder
  const i = seats.indexOf(playerId)
  for (let k = 1; k < seats.length; k++) {
    const candidate = seats[(i + k) % seats.length]
    if (g.order.includes(candidate)) return candidate
  }
  return playerId
}

// ---------------------------------------------------------------- setup

/** R-SET-01..07 */
export function setupGame(lobby: LobbyState<GameOptions>, random: Random): GameState {
  const ids = lobby.turnOrder
  const reserve = [...MARKER_COUNTS]
  const supply: Goods = { ...GOODS_COUNTS }

  // R-SET-01
  const cities: CityState[] = CITIES.map((info) => {
    const goods = emptyGoods()
    goods[info.color] = START_CITY_GOODS
    supply[info.color] -= START_CITY_GOODS
    return { goods, routes: [faceUp(0), faceUp(0)], houses: [], raids: [] }
  })

  // R-SET-02
  const players: Record<PlayerId, PlayerData> = {}
  for (const id of ids) {
    for (let v = 0; v < CITY_COUNT; v++) reserve[v]--
    takeGoods(supply, START_GOODS)
    players[id] = { city: null, goods: { ...START_GOODS }, markers: Array<number>(CITY_COUNT).fill(1), raidMarkers: 1, secondRaidTaken: false, bonuses: [] }
  }

  const g: GameData = {
    stage: 'start',
    round: 0,
    seatOrder: [...ids],
    order: [...ids],
    players,
    cities,
    reserve,
    supply,
    bonusesAvailable: Object.fromEntries(BONUS_TYPES.map((b) => [b, BONUS_COPIES])) as GameData['bonusesAvailable'],
    market: [],
    guildmaster: 0,
    guildmasterStart: 0,
    guildmasterLaps: 0,
    startPicks: Object.fromEntries(ids.map((id) => [id, null])),
    startAttempt: 1,
    bids: [],
    lastAuction: null,
    turn: null,
    raid: null,
    offer: null,
    nextPlacementId: 1,
    scores: null,
  }

  // R-SET-03 / R-SET-05: the drawn marker goes straight back.
  const start = drawMarker(g, random) ?? 0
  g.reserve[start]++
  g.guildmaster = start
  g.guildmasterStart = start

  // R-SET-04
  const [first, second] = startingRoutes(random)
  for (let c = 0; c < CITY_COUNT; c++) {
    g.cities[c].routes = [faceUp(first[c]), faceUp(second[c])]
    g.reserve[first[c]]--
    g.reserve[second[c]]--
  }

  const state: GameState = { ...lobby, status: 'active', game: g }
  return finish(state, { g, random, options: lobby.options, winners: null })
}

function faceUp(value: number): RouteSlot {
  return { value, faceDown: false, placedBy: null, placementId: null }
}

/** R-SET-04: two shuffled sets of 0–8, no city showing its own number or the same number twice. */
function startingRoutes(random: Random): [number[], number[]] {
  const values = Array.from({ length: CITY_COUNT }, (_, i) => i)
  const tries = 200
  let first: number[] | null = null
  for (let t = 0; t < tries && !first; t++) {
    const a = random.shuffle(values)
    if (a.every((v, c) => v !== c)) first = a
  }
  if (first) {
    for (let t = 0; t < tries; t++) {
      const b = random.shuffle(values)
      if (b.every((v, c) => v !== c && v !== first[c])) return [first, b]
    }
  }
  // Practically unreachable; a fixed valid layout keeps setup total.
  return [values.map((c) => (c + 1) % CITY_COUNT), values.map((c) => (c + 2) % CITY_COUNT)]
}

// ---------------------------------------------------------------- envelope

/** Everyone who may act right now (the platform's pendingPlayerIds). */
export function pendingOf(g: GameData): PlayerId[] {
  switch (g.stage) {
    case 'start':
      return g.order.filter((id) => g.players[id].city === null && g.startPicks[id] === null)
    case 'auction': {
      const next = nextBidder(g)
      return next ? [next] : []
    }
    case 'guildmaster':
      return g.order.slice(0, 1)
    case 'actions':
      if (g.offer) return [g.offer.to]
      if (g.raid) return [g.raid.step === 'divide' ? g.raid.victim : g.raid.step === 'take' ? g.raid.raider : g.raid.chooser]
      return g.turn ? [g.turn.playerId] : []
    case 'over':
      return []
  }
}

export function phaseOf(g: GameData): string {
  if (g.stage === 'actions' && g.offer) return 'trade'
  if (g.stage === 'actions' && g.raid) return 'raid'
  return g.stage
}

function finish(state: GameState, ctx: Ctx): GameState {
  const { g } = ctx
  if (ctx.winners) {
    g.stage = 'over'
    g.turn = null
    g.raid = null
    g.offer = null
    return { ...state, game: g, status: 'completed', phase: null, turn: g.round, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds: ctx.winners }
  }
  const pending = pendingOf(g)
  return {
    ...state,
    game: g,
    turn: g.round,
    phase: phaseOf(g),
    pendingPlayerIds: pending,
    activePlayerId: g.stage === 'start' ? null : (pending[0] ?? null),
  }
}

// ---------------------------------------------------------------- start picks (R-SET-07/08)

function applyStartPick(ctx: Ctx, playerId: PlayerId, attempt: number, value: number): void {
  const { g } = ctx
  if (g.stage !== 'start') fail('Starting cities have been chosen.')
  const p = g.players[playerId]
  if (p.city !== null) fail('Your boat is already placed.')
  if (attempt !== g.startAttempt) fail('That pick is out of date.')
  if (!isMarker(value) || p.markers[value] < 1) fail('Pick a route marker from your hand.')
  if (g.cities[value].houses.length >= 2) fail(`${CITIES[value].name} already has two houses.`)
  if (g.startPicks[playerId] === value) fail(`You already picked ${value}.`)
  g.startPicks[playerId] = value
  const waiting = g.order.filter((id) => g.players[id].city === null)
  if (waiting.every((id) => g.startPicks[id] !== null)) resolveStartPicks(ctx)
}

function resolveStartPicks(ctx: Ctx): void {
  const { g } = ctx
  const waiting = g.order.filter((id) => g.players[id].city === null)
  const byCity = new Map<number, PlayerId[]>()
  for (const id of waiting) {
    const city = g.startPicks[id] as number
    byCity.set(city, [...(byCity.get(city) ?? []), id])
  }
  let repick = false
  for (const [city, ids] of byCity) {
    if (g.cities[city].houses.length + ids.length > 2) {
      // Too many for one city: all of them pick again (R-SET-07).
      for (const id of ids) g.startPicks[id] = null
      repick = true
      continue
    }
    for (const id of ids) {
      g.players[id].city = city
      g.cities[city].houses.push({ owner: id, goods: emptyGoods() })
    }
  }
  if (repick) {
    g.startAttempt++
    return
  }
  // R-SET-08: lowest city first; players sharing a city in random order.
  const cityOf = (id: PlayerId) => g.players[id].city as number
  const order: PlayerId[] = []
  for (let c = 0; c < CITY_COUNT; c++) {
    const here = g.order.filter((id) => cityOf(id) === c)
    order.push(...(here.length > 1 ? ctx.random.shuffle(here) : here))
  }
  g.order = order
  startRound(ctx)
}

// ---------------------------------------------------------------- auction (R-AUC)

function startRound(ctx: Ctx): void {
  const { g, random } = ctx
  g.round++
  g.turn = null
  // R-AUC-00
  for (const id of g.order) {
    if (!g.players[id].bonuses.includes('route')) continue
    const drawn = drawMarker(g, random)
    if (drawn !== null) g.players[id].markers[drawn]++
  }
  // R-AUC-01
  for (const lot of g.market) for (const m of lot) g.reserve[m]++
  g.market = []
  for (let i = 0; i < LOT_COUNT; i++) {
    const lot: number[] = []
    for (let k = 0; k < LOT_SIZE; k++) {
      const drawn = drawMarker(g, random)
      if (drawn !== null) lot.push(drawn)
    }
    if (lot.length > 0) g.market.push(sortedBid(lot))
  }
  g.bids = []
  g.stage = 'auction'
  advanceAuction(ctx)
}

/** The next player in turn order still to bid. */
function nextBidder(g: GameData): PlayerId | null {
  return g.order.find((id) => !g.bids.some((b) => b.playerId === id)) ?? null
}

function takenBids(g: GameData): number[][] {
  return g.bids.flatMap((b) => (b.markers ? [b.markers] : []))
}

/** Skips players who can't bid (R-AUC-05); resolves once everyone is done. */
function advanceAuction(ctx: Ctx): void {
  const { g } = ctx
  for (let next = nextBidder(g); next; next = nextBidder(g)) {
    if (canBid(g.players[next].markers, takenBids(g))) return
    g.bids.push({ playerId: next, markers: null })
  }
  resolveAuction(ctx)
}

function applyBid(ctx: Ctx, playerId: PlayerId, markers: unknown): void {
  const { g } = ctx
  if (g.stage !== 'auction') fail('Not bidding now.')
  if (nextBidder(g) !== playerId) fail('It is not your turn to bid.')
  if (!Array.isArray(markers) || markers.length === 0 || !markers.every(isMarker)) fail('Bid one or more route markers.')
  const hand = g.players[playerId].markers
  const counts = handCount(markers)
  if (counts.some((n, v) => n > hand[v])) fail('You don’t have those markers.')
  if (takenBids(g).some((bid) => sameBid(bid, markers))) fail('That exact bid has already been made.') // R-AUC-04
  for (let v = 0; v < CITY_COUNT; v++) hand[v] -= counts[v]
  g.bids.push({ playerId, markers: sortedBid(markers) })
  advanceAuction(ctx)
}

function resolveAuction(ctx: Ctx): void {
  const { g } = ctx
  const inGame = g.bids.filter((b) => g.order.includes(b.playerId))
  // R-AUC-03/05/06: strongest first, earlier bidder on a tie, non-bidders last.
  const ranked = inGame
    .map((bid, index) => ({ bid, index }))
    .sort((x, y) => {
      if (!x.bid.markers || !y.bid.markers) return (x.bid.markers ? 0 : 1) - (y.bid.markers ? 0 : 1) || x.index - y.index
      return compareBids(y.bid.markers, x.bid.markers) || x.index - y.index
    })
  g.order = ranked.map((r) => r.bid.playerId)
  // R-AUC-07: two goods per marker bid, highest city first.
  const used = handCount(g.bids.flatMap((b) => b.markers ?? []))
  for (let city = CITY_COUNT - 1; city >= 0; city--) {
    if (used[city] > 0) supplyCity(g, city, used[city] * GOODS_PER_MARKER, true)
    g.reserve[city] += used[city]
  }
  g.lastAuction = { round: g.round, bids: g.bids, order: [...g.order] }
  g.bids = []
  g.stage = 'guildmaster'
}

/** Places up to `count` goods of the city's colour from the supply, sharing them with its houses (R-AUC-08). */
function supplyCity(g: GameData, city: number, count: number, houseRule: boolean): void {
  const color = CITIES[city].color
  let placed = Math.min(count, g.supply[color])
  g.supply[color] -= placed
  const houses = g.cities[city].houses
  if (houseRule && houses.length > 0 && placed >= houses.length) {
    for (const house of houses) house.goods[color]++
    placed -= houses.length
  }
  g.cities[city].goods[color] += placed
}

// ---------------------------------------------------------------- Guildmaster (R-GM)

/** Where the Guildmaster ends after `steps` cities, skipping raided ones, and the cities it passes. */
export function guildmasterPath(g: GameData, steps: number): number[] {
  const path: number[] = []
  let city = g.guildmaster
  let counted = 0
  for (let guard = 0; guard < CITY_COUNT * steps && counted < steps; guard++) {
    city = nextCity(city)
    path.push(city)
    if (g.cities[city].raids.length === 0) counted++
  }
  // Every other city raided: it can't go anywhere.
  if (counted < steps) return []
  return path
}

function applyMoveGuildmaster(ctx: Ctx, playerId: PlayerId, steps: unknown): void {
  const { g } = ctx
  if (g.stage !== 'guildmaster') fail('The Guildmaster doesn’t move now.')
  if (g.order[0] !== playerId) fail('Only the starting player moves the Guildmaster.')
  if (steps !== 1 && steps !== 2) fail('Move the Guildmaster one or two cities.')
  const path = guildmasterPath(g, steps)
  // R-END-03: reaching (or passing) its start counts.
  for (const city of path) if (city === g.guildmasterStart) g.guildmasterLaps++
  if (path.length > 0) g.guildmaster = path[path.length - 1]
  const city = g.guildmaster
  supplyCity(g, city, GUILDMASTER_GOODS, HOUSE_SUPPLY_ON_GUILDMASTER)
  if (ctx.options.taxes) {
    // R-GM-01a
    for (const id of g.order) {
      const p = g.players[id]
      if (p.city !== city) continue
      const color = TAX_ORDER.find((c) => p.goods[c] > 0)
      if (color) {
        p.goods[color]--
        g.supply[color]++
      }
    }
    const own = CITIES[city].color
    for (const c of COLORS) {
      if (c === own) continue
      g.supply[c] += g.cities[city].goods[c]
      g.cities[city].goods[c] = 0
    }
  }
  if (!END_AFTER_FINAL_ROUND && g.guildmasterLaps >= GUILDMASTER_LAPS) {
    endOnPoints(ctx)
    return
  }
  g.stage = 'actions'
  beginTurn(g, g.order[0])
}

// ---------------------------------------------------------------- turns (R-MOV, R-ACT)

function beginTurn(g: GameData, playerId: PlayerId): void {
  g.turn = { playerId, moves: 0, moved: false, movementDone: false, used: [] }
  collectHouseGoods(g, playerId)
}

/** R-MOV-06 */
function collectHouseGoods(g: GameData, playerId: PlayerId): void {
  const p = g.players[playerId]
  if (p.city === null) return
  for (const house of g.cities[p.city].houses) {
    if (house.owner !== playerId) continue
    addGoods(p.goods, house.goods)
    house.goods = emptyGoods()
  }
}

function requireTurn(g: GameData, playerId: PlayerId): NonNullable<GameData['turn']> {
  if (g.stage !== 'actions' || !g.turn) fail('Not in the Actions phase.')
  if (g.turn.playerId !== playerId) fail('It is not your turn.')
  if (g.raid) fail('Finish the raid first.')
  if (g.offer) fail('Wait for the answer to your trade offer.')
  return g.turn
}

/** Starts an action (R-ACT): ends movement (R-MOV-07) and marks the action used. */
function beginAction(g: GameData, playerId: PlayerId, kind: ActionKind): { p: PlayerData; city: number } {
  const turn = requireTurn(g, playerId)
  if (turn.used.includes(kind)) fail('You have already done that this turn.')
  turn.movementDone = true
  turn.used.push(kind)
  const p = g.players[playerId]
  return { p, city: p.city as number }
}

function payAll(g: GameData, p: PlayerData, payments: unknown, count: number): void {
  if (!Array.isArray(payments) || payments.length !== count) fail(count === 0 ? 'This move is free.' : `This move costs ${count} good${count === 1 ? '' : 's'} or route marker${count === 1 ? '' : 's'}.`)
  const goods = emptyGoods()
  const markers = Array<number>(CITY_COUNT).fill(0)
  for (const pay of payments as Payment[]) {
    if (pay?.kind === 'good' && isColor(pay.color)) goods[pay.color]++
    else if (pay?.kind === 'marker' && isMarker(pay.value)) markers[pay.value]++
    else fail('Pay with goods or route markers.')
  }
  if (!hasGoods(p.goods, goods) || markers.some((n, v) => n > p.markers[v])) fail('You can’t pay that.')
  takeGoods(p.goods, goods)
  addGoods(g.supply, goods)
  for (let v = 0; v < CITY_COUNT; v++) {
    p.markers[v] -= markers[v]
    g.reserve[v] += markers[v]
  }
}

function applyMove(ctx: Ctx, playerId: PlayerId, route: unknown, payments: unknown): void {
  const { g } = ctx
  const turn = requireTurn(g, playerId)
  if (turn.movementDone) fail('Your movement is over.')
  const p = g.players[playerId]
  const here = p.city as number
  const passage = route === 'passage'
  let dest: number
  let slot: RouteSlot | null = null
  if (passage) {
    // R-MOV-03
    if (!p.bonuses.includes('passage')) fail('You don’t have the Secret Passage.')
    if (g.guildmaster === here) fail('The Guildmaster is already here.')
    dest = g.guildmaster
    if (g.cities[dest].raids.includes(playerId)) fail('You may never return to a city you raided.')
  } else {
    if (route !== 0 && route !== 1) fail('Choose one of the two routes.')
    slot = g.cities[here].routes[route]
    dest = slot.value as number
    if (!slot.faceDown && g.cities[dest].raids.includes(playerId)) fail('You may never return to a city you raided.') // R-MOV-05
  }
  payAll(g, p, payments, moveCost(g, playerId, turn.moves, passage))
  turn.moves++
  if (slot?.faceDown) {
    // R-MOV-04: revealed for good; a move into your own raid is used up.
    slot.faceDown = false
    slot.placedBy = null
    slot.placementId = null
    if (g.cities[dest].raids.includes(playerId)) return
  }
  p.city = dest
  turn.moved = true
  collectHouseGoods(g, playerId)
}

function applyEndMovement(g: GameData, playerId: PlayerId): void {
  const turn = requireTurn(g, playerId)
  if (turn.movementDone) fail('Your movement is already over.')
  turn.movementDone = true
}

/** R-ACT-01 */
function applyBuild(ctx: Ctx, playerId: PlayerId): void {
  const { g } = ctx
  const { p, city } = beginAction(g, playerId, 'build')
  const houses = g.cities[city].houses
  if (houses.length >= 2) fail('This city already has two houses.')
  const cost = buildCost(city, houses.length)
  if (!hasGoods(p.goods, cost.goods)) fail('Building needs one good of each colour other than the city’s.')
  if (p.markers[city] < cost.markers) fail(`Building here needs ${cost.markers} route marker${cost.markers === 1 ? '' : 's'} numbered ${city}.`)
  takeGoods(p.goods, cost.goods)
  addGoods(g.supply, cost.goods)
  p.markers[city] -= cost.markers
  g.reserve[city] += cost.markers
  houses.push({ owner: playerId, goods: emptyGoods() })
  checkDevelopment(ctx, playerId)
}

export function buildCost(city: number, existingHouses: number): { goods: Goods; markers: number } {
  const goods = emptyGoods()
  for (const c of COLORS) if (c !== CITIES[city].color) goods[c] = 1
  return { goods, markers: existingHouses === 0 ? 1 : 2 }
}

/** R-END-02 */
function checkDevelopment(ctx: Ctx, playerId: PlayerId): void {
  if (developmentPoints(ctx.g, playerId) >= DP_TO_WIN) {
    ctx.g.scores = Object.fromEntries(ctx.g.seatOrder.map((id) => [id, scoreOf(ctx.g, id)]))
    ctx.winners = [playerId]
  }
}

/** R-ACT-02 */
function applyGuildTrade(ctx: Ctx, playerId: PlayerId, trade: GuildTrade): void {
  const { g } = ctx
  const { p, city } = beginAction(g, playerId, 'guildmaster')
  if (g.guildmaster !== city) fail('The Guildmaster isn’t here.')
  switch (trade?.kind) {
    case 'raidMarker': {
      if (p.secondRaidTaken) fail('You already have your second Raid marker.')
      if (!isMarker(trade.value) || p.markers[trade.value] < RAID_MARKER_COST) fail(`That takes ${RAID_MARKER_COST} identical route markers.`)
      p.markers[trade.value] -= RAID_MARKER_COST
      g.reserve[trade.value] += RAID_MARKER_COST
      p.raidMarkers++
      p.secondRaidTaken = true
      return
    }
    case 'bonus': {
      if (!isColor(trade.color) || p.goods[trade.color] < BONUS_GOODS_COST) fail(`That takes ${BONUS_GOODS_COST} goods of one colour.`)
      if (!BONUS_TYPES.includes(trade.bonus) || g.bonusesAvailable[trade.bonus] < 1) fail('That bonus marker is gone.')
      p.goods[trade.color] -= BONUS_GOODS_COST
      g.supply[trade.color] += BONUS_GOODS_COST
      g.bonusesAvailable[trade.bonus]--
      p.bonuses.push(trade.bonus)
      checkDevelopment(ctx, playerId)
      return
    }
    case 'buyMarker': {
      if (!isMarker(trade.value)) fail('Choose a route marker.')
      const color = markerColor(trade.value)
      if (p.goods[color] < 1) fail(`That takes a ${color} good.`)
      if (g.reserve[trade.value] < 1) fail(`No ${trade.value} left in the reserve.`)
      p.goods[color]--
      g.supply[color]++
      g.reserve[trade.value]--
      p.markers[trade.value]++
      return
    }
    case 'sellMarker': {
      if (!isMarker(trade.value) || p.markers[trade.value] < 1) fail('You don’t have that marker.')
      const color = markerColor(trade.value)
      if (g.supply[color] < 1) fail(`No ${color} goods left in the supply.`)
      p.markers[trade.value]--
      g.reserve[trade.value]++
      g.supply[color]--
      p.goods[color]++
      return
    }
    default:
      fail('Choose a Guildmaster trade.')
  }
}

/** R-ACT-03 */
function applyBuyRoutes(ctx: Ctx, playerId: PlayerId, lot: unknown, payment: unknown): void {
  const { g } = ctx
  const { p } = beginAction(g, playerId, 'buyRoutes')
  if (!Number.isInteger(lot) || (lot as number) < 0 || (lot as number) >= g.market.length) fail('Choose a lot from the market.')
  if (!isColor(payment) || p.goods[payment] < 1) fail('Pay one good you have.')
  p.goods[payment]--
  g.supply[payment]++
  for (const m of g.market[lot as number]) p.markers[m]++
  g.market.splice(lot as number, 1)
}

/** R-ACT-04 */
function applyCityTrade(ctx: Ctx, playerId: PlayerId, give: unknown, take: unknown): void {
  const { g } = ctx
  const turn = requireTurn(g, playerId)
  if (!turn.moved) fail('You can only trade with a city after moving this turn.')
  const { p, city } = beginAction(g, playerId, 'cityTrade')
  if (!isColor(give) || p.goods[give] < 1) fail('Give a good you have.')
  const count = p.bonuses.includes('trading') ? 3 : 2
  if (!Array.isArray(take) || take.length !== count || !take.every(isColor)) fail(`Take ${count} goods.`)
  if (take.includes(give)) fail('Take goods of a different colour from the one you give.')
  const wanted = emptyGoods()
  for (const c of take as Color[]) wanted[c]++
  const here = g.cities[city].goods
  if (!hasGoods(here, wanted)) fail('The city doesn’t have those goods.')
  p.goods[give]--
  here[give]++
  takeGoods(here, wanted)
  addGoods(p.goods, wanted)
}

/** R-ACT-05 */
function applyChangeRoute(ctx: Ctx, playerId: PlayerId, slotIndex: unknown, value: unknown, placementId: unknown): void {
  const { g } = ctx
  const { p, city } = beginAction(g, playerId, 'changeRoute')
  if (slotIndex !== 0 && slotIndex !== 1) fail('Choose one of the two routes.')
  const slot = g.cities[city].routes[slotIndex]
  if (slot.faceDown) fail('Only a face-up route can be exchanged.')
  if (!isMarker(value) || p.markers[value] < 1) fail('Place a route marker from your hand.')
  if (value === city) fail('A city can’t hold a route to itself.')
  if (placementId !== g.nextPlacementId) fail('That exchange is out of date.')
  p.markers[value]--
  p.markers[slot.value as number]++
  g.cities[city].routes[slotIndex] = { value, faceDown: true, placedBy: playerId, placementId: g.nextPlacementId }
  g.nextPlacementId++
}

/** R-ACT-06 */
function applyRaid(ctx: Ctx, playerId: PlayerId, target: RaidTarget): void {
  const { g } = ctx
  const turn = requireTurn(g, playerId)
  const p = g.players[playerId]
  if (turn.used.includes('raid')) fail('You have already raided this turn.')
  if (p.raidMarkers < 1) fail('You have no Raid marker left.')
  const city = p.city as number
  if (target?.kind === 'player') {
    const victim = target.victim
    if (victim === playerId || !g.order.includes(victim) || g.players[victim].city !== city) fail('Raid a player whose boat is in this city.')
    if (goodsTotal(g.players[victim].goods) === 0) fail('That player has no goods.')
  } else if (target?.kind !== 'city') fail('Raid a player or the city.')
  beginAction(g, playerId, 'raid')
  p.raidMarkers--
  g.cities[city].raids.push(playerId)
  if (target.kind === 'city') {
    const here = g.cities[city]
    addGoods(p.goods, here.goods)
    here.goods = emptyGoods()
    for (const house of here.houses) {
      addGoods(p.goods, house.goods)
      house.goods = emptyGoods()
    }
    g.raid = { step: 'route', raider: playerId, chooser: leftOf(g, playerId), city }
    return
  }
  const victimGoods = g.players[target.victim].goods
  const colors = COLORS.filter((c) => victimGoods[c] > 0)
  g.raid = { step: 'divide', raider: playerId, victim: target.victim, city }
  // One colour: there's only one way to split, so don't ask.
  if (colors.length === 1) {
    const half = emptyGoods()
    half[colors[0]] = Math.ceil(victimGoods[colors[0]] / 2)
    divide(g, half)
  }
}

function divide(g: GameData, group: Goods): void {
  const raid = g.raid
  if (raid?.step !== 'divide') fail('Nothing to divide.')
  const rest = { ...g.players[raid.victim].goods }
  takeGoods(rest, group)
  g.raid = { step: 'take', raider: raid.raider, victim: raid.victim, city: raid.city, groups: [group, rest] }
}

function applyRaidDivide(ctx: Ctx, playerId: PlayerId, group: unknown): void {
  const { g } = ctx
  const raid = g.raid
  if (raid?.step !== 'divide' || raid.victim !== playerId) fail('You aren’t dividing goods now.')
  const goods = g.players[playerId].goods
  if (!isGoods(group) || !hasGoods(goods, group)) fail('Split the goods you have.')
  if (Math.abs(2 * goodsTotal(group) - goodsTotal(goods)) > 1) fail('The two groups must be as equal as possible.')
  divide(g, { ...group })
}

function applyRaidTake(ctx: Ctx, playerId: PlayerId, group: unknown): void {
  const { g } = ctx
  const raid = g.raid
  if (raid?.step !== 'take' || raid.raider !== playerId) fail('You aren’t choosing loot now.')
  if (group !== 0 && group !== 1) fail('Choose one of the two groups.')
  const loot = raid.groups[group]
  takeGoods(g.players[raid.victim].goods, loot)
  addGoods(g.players[playerId].goods, loot)
  g.raid = { step: 'route', raider: playerId, chooser: leftOf(g, playerId), city: raid.city }
}

function applyRaidRoute(ctx: Ctx, playerId: PlayerId, route: unknown): void {
  const { g } = ctx
  const raid = g.raid
  if (raid?.step !== 'route' || raid.chooser !== playerId) fail('You aren’t choosing the raider’s route.')
  if (route !== 0 && route !== 1) fail('Choose one of the two routes.')
  const slot = g.cities[raid.city].routes[route]
  const dest = slot.value as number
  if (slot.faceDown) {
    slot.faceDown = false
    slot.placedBy = null
    slot.placementId = null
  }
  const raider = g.players[raid.raider]
  // "If any action would force you to move to a city with your Raid token, your movement simply ends."
  if (!g.cities[dest].raids.includes(raid.raider)) {
    raider.city = dest
    collectHouseGoods(g, raid.raider)
  }
  g.raid = null
  endTurn(ctx, raid.raider)
}

/** R-ACT-07 */
function applyProposeTrade(ctx: Ctx, playerId: PlayerId, to: unknown, give: Bundle, get: Bundle): void {
  const { g } = ctx
  requireTurn(g, playerId)
  const p = g.players[playerId]
  if (typeof to !== 'string' || to === playerId || !g.order.includes(to) || g.players[to].city !== p.city) fail('Trade with a player whose boat is in your city.')
  if (!isBundle(give) || !isBundle(get)) fail('Offer goods and route markers.')
  if (goodsTotal(give.goods) + give.markers.length + goodsTotal(get.goods) + get.markers.length === 0) fail('Offer something.')
  if (!holds(p, give)) fail('You don’t have what you offer.')
  g.offer = { from: playerId, to, give: { goods: { ...give.goods }, markers: sortedBid(give.markers) }, get: { goods: { ...get.goods }, markers: sortedBid(get.markers) } }
}

function isBundle(value: unknown): value is Bundle {
  const b = value as Bundle
  return typeof b === 'object' && b !== null && isGoods(b.goods) && Array.isArray(b.markers) && b.markers.every(isMarker)
}

function holds(p: PlayerData, bundle: Bundle): boolean {
  return hasGoods(p.goods, bundle.goods) && handCount(bundle.markers).every((n, v) => n <= p.markers[v])
}

function moveBundle(from: PlayerData, to: PlayerData, bundle: Bundle): void {
  takeGoods(from.goods, bundle.goods)
  addGoods(to.goods, bundle.goods)
  for (const m of bundle.markers) {
    from.markers[m]--
    to.markers[m]++
  }
}

function applyRespondTrade(ctx: Ctx, playerId: PlayerId, accept: unknown): void {
  const { g } = ctx
  const offer = g.offer
  if (!offer || offer.to !== playerId) fail('No trade offer is waiting for you.')
  if (accept === true) {
    const [from, to] = [g.players[offer.from], g.players[offer.to]]
    if (!holds(to, offer.get)) fail('You don’t have what they ask for.')
    moveBundle(from, to, offer.give)
    moveBundle(to, from, offer.get)
  } else if (accept !== false) fail('Accept or decline.')
  g.offer = null
}

function applyEndTurn(ctx: Ctx, playerId: PlayerId): void {
  requireTurn(ctx.g, playerId)
  endTurn(ctx, playerId)
}

/** Hands the turn to the next player in `order` after `playerId`, or ends the round. */
function endTurn(ctx: Ctx, playerId: PlayerId, order: readonly PlayerId[] = ctx.g.order): void {
  const { g } = ctx
  const next = order.slice(order.indexOf(playerId) + 1).find((id) => g.order.includes(id))
  if (next) {
    beginTurn(g, next)
    return
  }
  // R-RND-02
  if (g.guildmasterLaps >= GUILDMASTER_LAPS) endOnPoints(ctx)
  else startRound(ctx)
}

/** R-END-03/04 */
function endOnPoints(ctx: Ctx): void {
  const { g } = ctx
  g.scores = Object.fromEntries(g.seatOrder.map((id) => [id, scoreOf(g, id)]))
  const best = Math.max(...g.order.map((id) => g.scores![id].total))
  ctx.winners = g.order.filter((id) => g.scores![id].total === best)
}

// ---------------------------------------------------------------- entry points

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function applyGameAction(state: GameState, action: GameAction, random: Random): GameState {
  if (state.status !== 'active') fail('The game is over.')
  const ctx: Ctx = { g: clone(state.game), random, options: state.options, winners: null }
  const { g } = ctx
  const playerId = action.playerId
  if (!g.order.includes(playerId)) fail('You are not playing in this game.')
  // A starting pick may be changed until everyone has picked (R-SET-07).
  if (!state.pendingPlayerIds.includes(playerId) && action.type !== 'START_PICK') fail('It is not your turn.')
  switch (action.type) {
    case 'START_PICK':
      applyStartPick(ctx, playerId, action.attempt, action.value)
      break
    case 'BID':
      applyBid(ctx, playerId, action.markers)
      break
    case 'MOVE_GUILDMASTER':
      applyMoveGuildmaster(ctx, playerId, action.steps)
      break
    case 'MOVE':
      applyMove(ctx, playerId, action.route, action.payments)
      break
    case 'END_MOVEMENT':
      applyEndMovement(g, playerId)
      break
    case 'BUILD_HOUSE':
      applyBuild(ctx, playerId)
      break
    case 'GUILD_TRADE':
      applyGuildTrade(ctx, playerId, action.trade)
      break
    case 'BUY_ROUTES':
      applyBuyRoutes(ctx, playerId, action.lot, action.payment)
      break
    case 'CITY_TRADE':
      applyCityTrade(ctx, playerId, action.give, action.take)
      break
    case 'CHANGE_ROUTE':
      applyChangeRoute(ctx, playerId, action.slot, action.value, action.placementId)
      break
    case 'RAID':
      applyRaid(ctx, playerId, action.target)
      break
    case 'RAID_DIVIDE':
      applyRaidDivide(ctx, playerId, action.group)
      break
    case 'RAID_TAKE':
      applyRaidTake(ctx, playerId, action.group)
      break
    case 'RAID_ROUTE':
      applyRaidRoute(ctx, playerId, action.route)
      break
    case 'PROPOSE_TRADE':
      applyProposeTrade(ctx, playerId, action.to, action.give, action.get)
      break
    case 'RESPOND_TRADE':
      applyRespondTrade(ctx, playerId, action.accept)
      break
    case 'END_TURN':
      applyEndTurn(ctx, playerId)
      break
    default:
      fail(`Unknown action: ${String((action as { type: unknown }).type)}`)
  }
  return finish(state, ctx)
}

/**
 * After a CONCEDE (the framework already dropped the player from turnOrder
 * and pendingPlayerIds): take them out of turn order and advance whatever
 * they were holding up. Their houses and boat stay on the board [AMBIG-9].
 */
export function eliminatePlayer(state: GameState, playerId: PlayerId, random: Random): GameState {
  if (state.status !== 'active') return state
  const ctx: Ctx = { g: clone(state.game), random, options: state.options, winners: null }
  const { g } = ctx
  const oldOrder = [...g.order]
  g.order = g.order.filter((id) => id !== playerId)
  if (g.offer && (g.offer.from === playerId || g.offer.to === playerId)) g.offer = null
  switch (g.stage) {
    case 'start':
      delete g.startPicks[playerId]
      if (g.order.filter((id) => g.players[id].city === null).every((id) => g.startPicks[id] !== null)) resolveStartPicks(ctx)
      break
    case 'auction':
      advanceAuction(ctx)
      break
    case 'actions': {
      const raid = g.raid
      if (raid && raid.raider === playerId) g.raid = null
      else if (raid && raid.step !== 'route' && raid.victim === playerId) g.raid = { step: 'route', raider: raid.raider, chooser: leftOf(g, raid.raider), city: raid.city }
      else if (raid?.step === 'route' && raid.chooser === playerId) g.raid = { ...raid, chooser: leftOf(g, raid.raider) }
      if (g.turn?.playerId === playerId) endTurn(ctx, playerId, oldOrder)
      break
    }
    default:
      break
  }
  return finish(state, ctx)
}

