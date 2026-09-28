// Phase 4: Lobbying (RULES.md §8), with the ⚑ ACCUM_RD R&D event and the
// ⚑ FACTION_TWEAKS Lobbying abilities (Old Money first, Fortress Derivatives
// last, Budget Stimulus draws 2).

import { AMBIGUITY_DEFAULTS } from './ambiguities.ts'
import { countriesInZone, countryDef, countryName, isCountry, TAX_HAVENS } from './board.ts'
import { addLoose, bopToward, clearSquare, occupySquare, shiftSlider } from './cubes.ts'
import { activeSeats, displayName, expectPrompt, fail, nextSeat, note, player, playerWithCorp, runNext, setPrompt, type Ctx } from './context.ts'
import { ZONES, ZONE_NAMES, type Camp, type ZoneId } from './data/board.ts'
import { describeCards, discardPayoffs, drawPayoffs, payoffAvailable } from './payoffs.ts'
import type { CountryId, DeferExecutiveAction, LobbyAction, LobbyEvent, MoveMarkerAction, PlayerId, PowerPlayResult, StimulusKeepAction, SubsidiesSwapAction, UseAbilityAction } from './types.ts'

export const otherCamp = (camp: Camp): Camp => (camp === 'NATO' ? 'SCO' : 'NATO')

/** The key an event is booked under in `lobbyUsed` — Power Play once per zone (R-LOB-02). */
export function eventKey(event: LobbyEvent): string {
  switch (event.kind) {
    case 'powerPlay':
      return `POWER_PLAY:${event.zone}`
    case 'taxHavens':
      return 'TAX_HAVENS'
    case 'centralBanks':
      return 'CENTRAL_BANKS'
    case 'budget':
      return 'BUDGET'
    case 'rd':
      return 'RD'
    case 'subsidies':
      return 'SUBSIDIES'
  }
}

/**
 * R-LOB-02: Tax Havens is unlimited; everything else once per turn (Power
 * Play once per zone that still has a marker). ⚑ FACTION_TWEAKS: Fortress
 * Derivatives' deferred last executive is blocked only by their own.
 */
export function eventAvailable(ctx: Ctx, playerId: PlayerId, key: string, unblocked: boolean): boolean {
  if (key === 'TAX_HAVENS') return true
  if (key.startsWith('POWER_PLAY:') && ctx.g.battlegrounds[key.slice('POWER_PLAY:'.length) as ZoneId] == null) return false
  const users = ctx.g.lobbyUsed[key] ?? []
  return unblocked ? !users.includes(playerId) : users.length === 0
}

function powerPlayAvailable(ctx: Ctx, playerId: PlayerId, unblocked: boolean): boolean {
  return ZONES.some((zone) => eventAvailable(ctx, playerId, `POWER_PLAY:${zone}`, unblocked))
}

export function startLobbying(ctx: Ctx): void {
  const g = ctx.g
  g.phase = 'lobbying'
  g.lobbyUsed = {}
  g.cursor = null
  g.deferredPlayerId = null
  g.lobbyFirstPlayerId = null
  // ⚑ FACTION_TWEAKS: Old Money may act first, once per game, with a Power Play.
  const oldMoney = playerWithCorp(ctx, 'OLD_MONEY')
  if (ctx.options.factionTweaks && oldMoney && !player(ctx, oldMoney).abilitiesUsed.omLobbyFirst && activeSeats(ctx)[0] !== oldMoney && player(ctx, oldMoney).executives > 0 && powerPlayAvailable(ctx, oldMoney, false)) {
    setPrompt(ctx, { kind: 'useAbility', playerId: oldMoney, ability: 'omLobbyFirst' })
  }
  runNext(ctx, { t: 'lobbyNext' })
}

export function onUseLobbyFirst(ctx: Ctx, action: UseAbilityAction): void {
  expectPrompt(ctx, 'useAbility', action.playerId)
  ctx.g.prompt = null
  if (!action.use) return
  player(ctx, action.playerId).abilitiesUsed.omLobbyFirst = true
  ctx.g.lobbyFirstPlayerId = action.playerId
  note(ctx, `${displayName(ctx, action.playerId)} acts first in Lobbying.`)
}

/** R-LOB-01: the next player clockwise with an executive left; the deferred Fortress Derivatives executive acts after everyone. */
export function lobbyNext(ctx: Ctx): void {
  const g = ctx.g
  if (g.lobbyFirstPlayerId) {
    setPrompt(ctx, { kind: 'lobbyTurn', playerId: g.lobbyFirstPlayerId, mustPowerPlay: true, canDefer: false })
    return
  }
  const next = nextSeat(ctx, g.cursor, (id) => g.players[id].executives > 0 && id !== g.deferredPlayerId)
  if (next) {
    g.cursor = next
    setPrompt(ctx, { kind: 'lobbyTurn', playerId: next, mustPowerPlay: false, canDefer: canDefer(ctx, next) })
    return
  }
  if (g.deferredPlayerId && activeSeats(ctx).includes(g.deferredPlayerId) && g.players[g.deferredPlayerId].executives > 0) {
    setPrompt(ctx, { kind: 'lobbyTurn', playerId: g.deferredPlayerId, mustPowerPlay: false, canDefer: false })
    return
  }
  runNext(ctx, { t: 'endPhase' }, { t: 'startEarnings' })
}

/** ⚑ FACTION_TWEAKS: Fortress Derivatives' last executive may wait until everyone else is done. */
function canDefer(ctx: Ctx, playerId: PlayerId): boolean {
  const p = player(ctx, playerId)
  if (!ctx.options.factionTweaks || p.corp !== 'FORTRESS_DERIVATIVES' || p.abilitiesUsed.fdLastExecutive || p.executives !== 1) return false
  return activeSeats(ctx).some((id) => id !== playerId && ctx.g.players[id].executives > 0)
}

export function onDeferExecutive(ctx: Ctx, action: DeferExecutiveAction): void {
  const prompt = expectPrompt(ctx, 'lobbyTurn', action.playerId)
  if (!prompt.canDefer) fail("You can't hold back your executive now.")
  player(ctx, action.playerId).abilitiesUsed.fdLastExecutive = true
  ctx.g.deferredPlayerId = action.playerId
  ctx.g.cursor = action.playerId
  ctx.g.prompt = null
  note(ctx, `${displayName(ctx, action.playerId)} holds back their last executive.`)
  runNext(ctx, { t: 'lobbyNext' })
}

export function onLobby(ctx: Ctx, action: LobbyAction): void {
  const prompt = expectPrompt(ctx, 'lobbyTurn', action.playerId)
  const g = ctx.g
  const { playerId } = action
  const event = action.event
  if (!event || typeof event !== 'object') fail('Choose an event.')
  const key = eventKey(event)
  if (key === undefined) fail('Unknown event.')
  const unblocked = g.deferredPlayerId === playerId
  if (prompt.mustPowerPlay && event.kind !== 'powerPlay') fail('Your first action must be a Power Play.')
  if (event.kind === 'powerPlay' && (!ZONES.includes(event.zone) || (event.camp !== 'NATO' && event.camp !== 'SCO'))) fail('Choose a zone and a camp.')
  if (!eventAvailable(ctx, playerId, key, unblocked)) fail('That event is already taken this turn.')
  const p = player(ctx, playerId)
  if (p.executives === 0) fail('You have no executive left.')

  g.prompt = null
  p.executives -= 1
  g.lobbyUsed[key] = [...(g.lobbyUsed[key] ?? []), playerId]
  if (g.lobbyFirstPlayerId === playerId) g.lobbyFirstPlayerId = null
  else if (unblocked) g.deferredPlayerId = null
  else g.cursor = playerId
  runNext(ctx, { t: 'lobbyNext' })
  resolveEvent(ctx, playerId, event)
}

function resolveEvent(ctx: Ctx, playerId: PlayerId, event: LobbyEvent): void {
  const g = ctx.g
  const me = displayName(ctx, playerId)
  switch (event.kind) {
    case 'powerPlay':
      powerPlay(ctx, playerId, event.zone, event.camp)
      return
    case 'taxHavens': {
      // R-LOB-10.
      if (player(ctx, playerId).supply > 0) addLoose(ctx, playerId, TAX_HAVENS, 1)
      note(ctx, `${me} lobbies Tax Havens and places a loose cube there.`)
      return
    }
    case 'centralBanks': {
      // R-LOB-11, [AMBIG-14]: exactly 2 steps, clamped.
      if ((event.slider !== 'interest' && event.slider !== 'stress') || (event.direction !== 1 && event.direction !== -1)) fail('Choose Interest or Stress and a direction.')
      shiftSlider(ctx, event.slider, event.direction * AMBIGUITY_DEFAULTS.centralBanksSteps)
      const which = event.slider === 'interest' ? (event.direction > 0 ? 'tightens Interest' : 'eases Interest') : event.direction > 0 ? 'raises Stress' : 'lowers Stress'
      note(ctx, `${me} lobbies the Central Banks and ${which}.`)
      return
    }
    case 'budget': {
      // R-LOB-12.
      if (event.mode === 'austerity') {
        shiftSlider(ctx, 'growth', -1)
        if (g.revealed.length > 0) {
          const index = event.discardIndex
          if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= g.revealed.length) fail('Choose a revealed payoff card to discard.')
          const [card] = g.revealed.splice(index, 1)
          discardPayoffs(ctx, [card])
          note(ctx, `${me} imposes Austerity: Growth −1, ${card} payoff discarded.`)
        } else {
          note(ctx, `${me} imposes Austerity: Growth −1.`)
        }
        return
      }
      if (event.mode !== 'stimulus') fail('Choose Austerity or Stimulus.')
      shiftSlider(ctx, 'growth', 1)
      if (ctx.options.factionTweaks) {
        // ⚑ FACTION_TWEAKS: draw 2, keep 1.
        const drawn = drawPayoffs(ctx, 2)
        note(ctx, `${me} passes a Stimulus: Growth +1, drawing ${drawn.length} payoff card(s) to keep one.`)
        if (drawn.length === 1) keepRevealed(ctx, playerId, drawn[0])
        else if (drawn.length === 2) setPrompt(ctx, { kind: 'stimulus', playerId, drawn })
        return
      }
      const drawn = drawPayoffs(ctx, 1)
      g.revealed.push(...drawn)
      note(ctx, `${me} passes a Stimulus: Growth +1, payoff revealed: ${describeCards(drawn)}.`)
      return
    }
    case 'rd': {
      if (!isCountry(event.country)) fail('Choose a square.')
      const def = countryDef(event.country)
      const square = g.countries[event.country].squares[event.square]
      if (!square || def.stability !== 5) fail('R&D needs a square in a stability-5 country.')
      if (ctx.options.accumRd) {
        // ⚑ ACCUM_RD: fortify a square you occupy.
        if (square.occupant !== playerId) fail('Fortify a square you occupy.')
        if (square.fortified) fail('That square is already fortified.')
        if (player(ctx, playerId).supply === 0) fail('You have no cube left to fortify with.')
        player(ctx, playerId).supply -= 1
        square.fortified = true
        note(ctx, `${me} fortifies the ${def.squares[event.square]} square in ${def.name}.`)
        return
      }
      // R-LOB-13.
      g.rdSquare = { country: event.country, square: event.square }
      note(ctx, `${me} moves R&D to the ${def.squares[event.square]} square in ${def.name}.`)
      return
    }
    case 'subsidies': {
      // R-LOB-14, [AMBIG-21]: the swap is mandatory.
      if (g.revealed.length === 0 || !payoffAvailable(ctx)) fail('Subsidies needs a revealed payoff card and cards left to draw.')
      const peek = drawPayoffs(ctx, 3)
      note(ctx, `${me} lobbies for Subsidies and looks at ${peek.length} payoff card(s).`)
      setPrompt(ctx, { kind: 'subsidies', playerId, peek })
      return
    }
    default:
      fail('Unknown event.')
  }
}

function keepRevealed(ctx: Ctx, playerId: PlayerId, card: string): void {
  ctx.g.revealed.push(card as never)
  note(ctx, `${displayName(ctx, playerId)} reveals a ${card} payoff.`)
}

export function onStimulusKeep(ctx: Ctx, action: StimulusKeepAction): void {
  const prompt = expectPrompt(ctx, 'stimulus', action.playerId)
  const kept = prompt.drawn[action.index]
  if (!Number.isInteger(action.index) || kept == null) fail('Keep one of the drawn cards.')
  ctx.g.prompt = null
  keepRevealed(ctx, action.playerId, kept)
  discardPayoffs(ctx, prompt.drawn.filter((c, i): c is NonNullable<typeof c> => i !== action.index && c !== null))
}

export function onSubsidiesSwap(ctx: Ctx, action: SubsidiesSwapAction): void {
  const prompt = expectPrompt(ctx, 'subsidies', action.playerId)
  const g = ctx.g
  const chosen = prompt.peek[action.peekIndex]
  const replaced = g.revealed[action.revealedIndex]
  if (!Number.isInteger(action.peekIndex) || chosen == null) fail('Choose one of the cards you looked at.')
  if (!Number.isInteger(action.revealedIndex) || replaced === undefined) fail('Choose a revealed payoff card to replace.')
  g.prompt = null
  g.revealed[action.revealedIndex] = chosen
  discardPayoffs(ctx, [replaced, ...prompt.peek.filter((c, i): c is NonNullable<typeof c> => i !== action.peekIndex && c !== null)])
  note(ctx, `${displayName(ctx, action.playerId)} swaps a revealed ${replaced} payoff for a ${chosen}.`)
}

/** R-LOB-03/04/09: roll for camp S in zone Z's battleground. */
function powerPlay(ctx: Ctx, playerId: PlayerId, zone: ZoneId, camp: Camp): void {
  const g = ctx.g
  const country = g.battlegrounds[zone] as CountryId
  const def = countryDef(country)
  const me = displayName(ctx, playerId)
  let result: PowerPlayResult
  if (def.localBonus?.kind === 'autoWin' && def.localBonus.camp === camp) {
    result = { playerId, zone, country, camp, roll: null, modified: null, target: def.stability, success: true }
    note(ctx, `${me} makes a Power Play in ${def.name} for ${camp} — an automatic win.`)
  } else {
    const roll = ctx.random.int(1, 6)
    const bop = camp === 'NATO' ? g.sliders.bop : -g.sliders.bop
    const local = def.localBonus?.kind === 'modifier' ? (def.localBonus.camp === camp ? def.localBonus.amount : -def.localBonus.amount) : 0
    const modified = roll + bop + local
    const success = roll === 6 || (roll !== 1 && modified >= def.stability)
    result = { playerId, zone, country, camp, roll, modified, target: def.stability, success }
    note(ctx, `${me} makes a Power Play in ${def.name} for ${camp}: rolled ${roll}, ${modified} against ${def.stability} — ${success ? 'success' : 'failure'}.`)
  }
  g.lastPowerPlay = result
  if (result.success) winBattleground(ctx, playerId, zone, country, camp)
}

/** R-LOB-05..08: what a successful Power Play does. */
function winBattleground(ctx: Ctx, playerId: PlayerId, zone: ZoneId, country: CountryId, camp: Camp): void {
  const g = ctx.g
  const def = countryDef(country)
  const losing = otherCamp(camp)
  const c = g.countries[country]
  c.affiliation = camp
  if (!def.isMajor) {
    // R-LOB-05: the player takes C's square (the first one, for a country with more than one); a fortified square can't be flipped.
    const square = c.squares[0]
    if (!square.fortified && square.occupant !== playerId && player(ctx, playerId).supply > 0) occupySquare(ctx, playerId, country, 0)
    note(ctx, `${def.name} joins ${camp}.`)
    moveMarkerFrom(ctx, playerId, zone, camp, losing, true)
    return
  }
  if (def.startingCamp === camp) {
    // R-LOB-07, [AMBIG-12]: the marker moves to a minor of the losing camp, if any.
    note(ctx, `${def.name} stays ${camp}.`)
    moveMarkerFrom(ctx, playerId, zone, camp, losing, false)
    return
  }
  // R-LOB-08: the major flips — cubes wiped, shares discarded, marker gone.
  c.squares.forEach((s, i) => {
    if (s.occupant !== null && s.occupant !== 'LOCK' && !s.fortified) clearSquare(ctx, country, i)
  })
  for (const [owner, count] of Object.entries(c.loose)) {
    player(ctx, owner).supply += count
  }
  c.loose = {}
  for (const id of g.seatOrder) g.players[id].shares[country] = 0
  if (AMBIGUITY_DEFAULTS.flippedMajorDiscardsBankShares) g.bank[country] = 0
  if (!g.retiredMajors.includes(country)) g.retiredMajors.push(country)
  bopToward(ctx, camp)
  g.battlegrounds[zone] = null
  note(ctx, `${def.name} flips to ${camp}: every cube there is removed and its shares are discarded. ${ZONE_NAMES[zone]} is resolved.`)
}

/**
 * Moves zone Z's marker to a country of the losing camp — a minor if there is
 * one, else (after a minor was won) a major. With no country of the losing
 * camp left the zone is resolved (R-LOB-06, [AMBIG-11]).
 */
function moveMarkerFrom(ctx: Ctx, playerId: PlayerId, zone: ZoneId, winner: Camp, losing: Camp, majorsAllowed: boolean): void {
  const g = ctx.g
  const losingCountries = countriesInZone(zone).filter((c) => g.countries[c.id].affiliation === losing)
  const minors = losingCountries.filter((c) => !c.isMajor).map((c) => c.id)
  const options = minors.length > 0 ? minors : majorsAllowed ? losingCountries.map((c) => c.id) : []
  if (losingCountries.length === 0 && AMBIGUITY_DEFAULTS.zoneResolutionEverywhere) {
    g.battlegrounds[zone] = null
    bopToward(ctx, winner)
    note(ctx, `${ZONE_NAMES[zone]} is resolved for ${winner}; Balance of Power moves toward ${winner}.`)
    return
  }
  if (options.length === 0) {
    g.battlegrounds[zone] = null
    note(ctx, `The ${ZONE_NAMES[zone]} battleground marker is removed.`)
    return
  }
  if (options.length === 1) {
    placeMarker(ctx, zone, options[0])
    return
  }
  setPrompt(ctx, { kind: 'moveMarker', playerId, zone, options })
}

function placeMarker(ctx: Ctx, zone: ZoneId, country: CountryId): void {
  ctx.g.battlegrounds[zone] = country
  ctx.g.countries[country].affiliation = 'BATTLEGROUND'
  note(ctx, `The ${ZONE_NAMES[zone]} battleground moves to ${countryName(country)}.`)
}

export function onMoveMarker(ctx: Ctx, action: MoveMarkerAction): void {
  const prompt = expectPrompt(ctx, 'moveMarker', action.playerId)
  if (!prompt.options.includes(action.country)) fail('Choose one of the offered countries.')
  ctx.g.prompt = null
  placeMarker(ctx, prompt.zone, action.country)
}
