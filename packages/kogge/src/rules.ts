// Kogge — this package's `rules` entry point: the GameDefinition the
// framework calls into, plus read-only helpers for the view. The rules
// themselves live in ./engine.ts; RULES.md is the spec.
//
// Pure and deterministic, and imported by the Edge Functions: keep the `.ts`
// extensions on relative imports and never let React in.

import type { ActionDescription, ActionResult, GameDefinition, LoggedAction } from '@game-platform/sdk'
import { describeBid } from './bids.ts'
import { BONUS_INFO, CITIES } from './data.ts'
import { applyGameAction, eliminatePlayer, RuleError, setupGame, type GameState } from './engine.ts'
import type { Bundle, GameAction, GameData, GameOptions, Goods, Payment, PlayerId } from './types.ts'

export type { GameState } from './engine.ts'
export type * from './types.ts'
export { bidStrength, canBid, compareBids, describeBid, sameBid, sortedBid } from './bids.ts'
export { BONUS_INFO, BONUS_TYPES, CITIES, COLORS, GOOD_VP, markerColor } from './data.ts'
export { buildCost, developmentPoints, emptyGoods, goodsTotal, guildmasterPath, handSize, leftOf, moveCost, scoreOf } from './engine.ts'

export const DEFAULT_GAME_OPTIONS: GameOptions = { taxes: false }

export function normalizeGameOptions(raw: unknown): GameOptions {
  const options = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof GameOptions, unknown>>
  return { taxes: options.taxes === true }
}

const PHASES: Record<string, string> = {
  start: 'Choosing starting cities',
  auction: 'Bidding for turn order',
  guildmaster: 'Moving the Guildmaster',
  actions: 'Sailing and trading',
  raid: 'Raid',
  trade: 'Trade offer',
}

function cityName(city: number): string {
  return `${CITIES[city]?.name ?? '?'} (${city})`
}

function nameOf(state: GameState, id: PlayerId): string {
  return state.players.find((p) => p.id === id)?.displayName ?? 'Someone'
}

function goodsText(goods: Goods): string {
  const parts = (Object.entries(goods) as [string, number][]).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${c}`)
  return parts.length ? parts.join(', ') : 'nothing'
}

function bundleText(bundle: Bundle): string {
  const parts = [goodsText(bundle.goods)].filter((t) => t !== 'nothing')
  if (bundle.markers.length) parts.push(`marker${bundle.markers.length === 1 ? '' : 's'} ${bundle.markers.join('+')}`)
  return parts.length ? parts.join(' and ') : 'nothing'
}

function paymentText(payments: Payment[]): string {
  if (!payments.length) return ''
  return ` paying ${payments.map((p) => (p.kind === 'good' ? `a ${p.color} good` : `marker ${p.value}`)).join(' and ')}`
}

/** What a move brought about beyond itself: reveals, a new turn order, a new round, the end. */
function consequences(before: GameState, after: GameState): string[] {
  const lines: string[] = []
  const [b, a] = [before.game, after.game]
  if (b.stage === 'start' && a.stage !== 'start') {
    lines.push(`Starting cities: ${a.seatOrder.filter((id) => a.players[id].city !== null).map((id) => `${nameOf(after, id)} → ${cityName(a.players[id].city!)}`).join(', ')}.`)
  } else if (b.stage === 'start' && a.startAttempt > b.startAttempt) {
    lines.push('Three or more players chose the same city: they choose again.')
  }
  if (a.lastAuction && a.lastAuction !== b.lastAuction && a.lastAuction.round !== b.lastAuction?.round) {
    const skipped = a.lastAuction.bids.filter((bid) => !bid.markers).map((bid) => nameOf(after, bid.playerId))
    if (skipped.length) lines.push(`${skipped.join(', ')} could not bid.`)
    lines.push(`Turn order: ${a.lastAuction.order.map((id) => nameOf(after, id)).join(', ')}.`)
  }
  if (a.round > b.round && after.status === 'active') lines.push(`Round ${a.round} begins.`)
  if (after.status === 'completed' && before.status !== 'completed') {
    lines.push(`Game over — ${after.winnerPlayerIds.map((id) => nameOf(after, id)).join(' and ')} win${after.winnerPlayerIds.length === 1 ? 's' : ''}.`)
  }
  return lines
}

function describe(action: GameAction, before: GameState, after: GameState): ActionDescription {
  const g = before.game
  const here = g.players[action.playerId]?.city ?? 0
  const join = (first: string, redacted?: string): ActionDescription => {
    const rest = consequences(before, after)
    return { message: [first, ...rest].join(' '), ...(redacted ? { redactedMessage: [redacted, ...rest].join(' ') } : {}) }
  }
  switch (action.type) {
    case 'START_PICK':
      return join(`{player} chose ${cityName(action.value)} to start.`, '{player} chose a starting city.')
    case 'BID':
      return join(`{player} bid ${describeBid(action.markers)}.`)
    case 'MOVE_GUILDMASTER':
      return join(`{player} moved the Guildmaster ${action.steps === 1 ? 'one city' : 'two cities'}, to ${cityName(after.game.guildmaster)}.${after.game.guildmasterLaps > g.guildmasterLaps ? ' It passed its starting city.' : ''}`)
    case 'MOVE': {
      const pay = paymentText(action.payments)
      if (action.route === 'passage') return join(`{player} took the Secret Passage to ${cityName(after.game.players[action.playerId].city!)}${pay}.`)
      const slot = g.cities[here].routes[action.route]
      const dest = after.game.cities[here].routes[action.route].value!
      const stayed = after.game.players[action.playerId].city === here
      if (slot.faceDown) return join(`{player} turned up a face-down ${dest} in ${cityName(here)}${stayed ? ' — a city they raided, so they stay' : ` and sailed to ${cityName(dest)}`}${pay}.`)
      return join(`{player} sailed to ${cityName(dest)}${pay}.`)
    }
    case 'END_MOVEMENT':
      return join(`{player} stopped in ${cityName(here)}.`)
    case 'BUILD_HOUSE':
      return join(`{player} built a house in ${cityName(here)}.`)
    case 'GUILD_TRADE': {
      const t = action.trade
      switch (t.kind) {
        case 'raidMarker':
          return join(`{player} traded three ${t.value}s to the Guildmaster for a second Raid marker.`)
        case 'bonus':
          return join(`{player} sold six ${t.color} goods to the Guildmaster for the ${BONUS_INFO[t.bonus].name} bonus.`)
        case 'buyMarker':
          return join(`{player} bought a ${t.value} from the Guildmaster for a good.`)
        case 'sellMarker':
          return join(`{player} sold a ${t.value} to the Guildmaster for a good.`)
      }
      break
    }
    case 'BUY_ROUTES':
      return join(`{player} bought markers ${g.market[action.lot]?.join('+') ?? '?'} for a ${action.payment} good.`)
    case 'CITY_TRADE':
      return join(`{player} traded a ${action.give} good with ${cityName(here)} for ${action.take.join(' and ')}.`)
    case 'CHANGE_ROUTE': {
      const old = g.cities[here].routes[action.slot].value
      return join(`{player} swapped the ${old} route in ${cityName(here)} for a face-down ${action.value}.`, `{player} swapped the ${old} route in ${cityName(here)} for a face-down marker.`)
    }
    case 'RAID':
      return join(
        action.target.kind === 'city'
          ? `{player} raided ${cityName(here)} and took every good there.`
          : `{player} raided ${nameOf(before, action.target.victim)} in ${cityName(here)}.`,
      )
    case 'RAID_DIVIDE':
      return join(`{player} split their goods: ${goodsText(action.group)} or the rest.`)
    case 'RAID_TAKE': {
      const raid = g.raid
      const loot = raid?.step === 'take' ? goodsText(raid.groups[action.group]) : 'a group'
      return join(`{player} took ${loot}.`)
    }
    case 'RAID_ROUTE': {
      const raid = g.raid
      const raider = raid ? nameOf(before, raid.raider) : 'The raider'
      const city = raid ? after.game.players[raid.raider].city! : here
      return join(`{player} sent ${raider} to ${cityName(city)}.`)
    }
    case 'PROPOSE_TRADE':
      return join(`{player} offered ${nameOf(before, action.to)} ${bundleText(action.give)} for ${bundleText(action.get)}.`)
    case 'RESPOND_TRADE':
      return join(`{player} ${action.accept ? 'accepted' : 'declined'} the trade.`)
    case 'END_TURN':
      return join('{player} ended their turn.')
  }
  return join('{player} moved.')
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'kogge',
  rulesVersion: 1,
  title: 'Kogge',
  turnLabel: 'Round',
  minPlayers: 2,
  maxPlayers: 4,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    return options.taxes ? 'Taxes variant' : 'Base rules'
  },

  setup: setupGame,

  applyAction(state, action, random): ActionResult<GameState> {
    try {
      return { ok: true, state: applyGameAction(state, action, random) }
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, error: error.message }
      throw error
    }
  },

  onPlayerEliminated: eliminatePlayer,

  nextForcedAction() {
    return null
  },

  redactGame(state, viewerId) {
    const g = state.game
    if (state.status !== 'active') return g
    const players = Object.fromEntries(
      Object.entries(g.players).map(([id, p]) => [
        id,
        id === viewerId ? p : { ...p, markers: p.markers.map(() => 0), hiddenHand: p.markers.reduce((a, b) => a + b, 0) },
      ]),
    )
    const cities = g.cities.map((city) => ({
      ...city,
      routes: city.routes.map((slot) => (slot.faceDown && slot.placedBy !== viewerId ? { ...slot, value: null } : slot)) as typeof city.routes,
    }))
    const startPicks = Object.fromEntries(Object.entries(g.startPicks).map(([id, pick]) => [id, id === viewerId || g.players[id]?.city !== null ? pick : null]))
    const reserve = g.reserve.map(() => 0)
    return { ...g, players, cities, startPicks, reserve, hiddenReserve: g.reserve.reduce((a, b) => a + b, 0) }
  },

  isActionSecret(entry: LoggedAction, state, viewerId) {
    const action = entry.action as GameAction
    const g = state.game
    if (state.status !== 'active' || action.playerId === viewerId) return false
    if (action.type === 'START_PICK') return g.stage === 'start' && action.attempt === g.startAttempt && g.players[action.playerId]?.city === null
    if (action.type === 'CHANGE_ROUTE') return g.cities.some((city) => city.routes.some((slot) => slot.faceDown && slot.placementId === action.placementId))
    return false
  },

  describeAction: describe,

  describePhase(phase) {
    return (phase && PHASES[phase]) || 'In progress'
  },
}
