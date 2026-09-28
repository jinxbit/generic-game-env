// Phase 3: Competition (RULES.md §7).

import { countryName, defendersOf, isCountry, looseOf, moveAllowed, TAX_HAVENS } from './board.ts'
import { addLoose, occupySquare, removeLoose } from './cubes.ts'
import { activeSeats, displayName, expectPrompt, fail, nextSeat, note, player, requireWhole, runNext, setPrompt, type Ctx } from './context.ts'
import { pay, requireAffordable } from './loans.ts'
import type { AllocateIncomeAction, Attack, CompetitionPassAction, CountryId, DefendAction, ExpandAction, FightAction, PlayerId, Task } from './types.ts'

export function startCompetition(ctx: Ctx): void {
  const g = ctx.g
  g.phase = 'competition'
  g.passed = []
  g.cursor = null
  runNext(ctx, ...activeSeats(ctx).map((playerId): Task => ({ t: 'income', playerId })), { t: 'competitionNext' })
}

function shareCountries(ctx: Ctx, playerId: PlayerId): CountryId[] {
  const shares = player(ctx, playerId).shares
  return Object.keys(shares).filter((country) => (shares[country] ?? 0) > 0)
}

/**
 * R-COMP-01: one loose cube per share, in that share's country. Short of
 * cubes, the owner chooses where the ones they have go ([AMBIG-10]) — unless
 * there's nothing to choose.
 */
export function income(ctx: Ctx, playerId: PlayerId): void {
  const p = player(ctx, playerId)
  const countries = shareCountries(ctx, playerId)
  const needed = countries.reduce((sum, c) => sum + p.shares[c], 0)
  if (needed === 0 || p.supply === 0) return
  if (p.supply >= needed || countries.length === 1) {
    for (const country of countries) addLoose(ctx, playerId, country, Math.min(p.shares[country], p.supply))
    return
  }
  setPrompt(ctx, { kind: 'income', playerId, available: p.supply })
}

export function onAllocateIncome(ctx: Ctx, action: AllocateIncomeAction): void {
  const prompt = expectPrompt(ctx, 'income', action.playerId)
  const p = player(ctx, action.playerId)
  const allocation = action.allocation && typeof action.allocation === 'object' ? action.allocation : {}
  let total = 0
  for (const [country, count] of Object.entries(allocation)) {
    requireWhole(count, 'Each count')
    if (count > (p.shares[country] ?? 0)) fail(`You have only ${p.shares[country] ?? 0} share(s) in ${countryName(country)}.`)
    total += count
  }
  if (total !== prompt.available) fail(`Place exactly ${prompt.available} cube(s).`)
  ctx.g.prompt = null
  for (const [country, count] of Object.entries(allocation)) addLoose(ctx, action.playerId, country, count)
}

/** R-COMP-02: the next player clockwise who hasn't passed, or cleanup once everyone has. */
export function competitionNext(ctx: Ctx): void {
  const g = ctx.g
  const next = nextSeat(ctx, g.cursor, (id) => !g.passed.includes(id))
  if (!next) {
    runNext(ctx, { t: 'competitionCleanup' }, { t: 'endPhase' }, { t: 'startLobbying' })
    return
  }
  setPrompt(ctx, { kind: 'competitionTurn', playerId: next })
}

/** R-COMP-12: every loose cube on the board goes back to supply. (Executives return with endPhase.) */
export function competitionCleanup(ctx: Ctx): void {
  for (const [country, state] of Object.entries(ctx.g.countries)) {
    for (const [playerId, count] of Object.entries(state.loose)) removeLoose(ctx, playerId, country, count)
  }
}

const totalLoose = (ctx: Ctx, playerId: PlayerId): number => Object.values(ctx.g.countries).reduce((sum, c) => sum + looseOf(c, playerId), 0)

/** ⚑ DONT_STALL: once every other player has passed, each action costs $1 more. */
function stallSurcharge(ctx: Ctx, playerId: PlayerId): number {
  if (!ctx.options.dontStall) return 0
  return activeSeats(ctx).every((id) => id === playerId || ctx.g.passed.includes(id)) ? 1 : 0
}

/** [AMBIG-20] ⚑ DONT_STALL: a Fight must make 2 attacks and an Expand 2 moves, unless only 1 cube is available. */
function requireTwo(ctx: Ctx, playerId: PlayerId, count: number, what: string): void {
  if (ctx.options.dontStall && count < 2 && totalLoose(ctx, playerId) >= 2) fail(`Don't stall: ${what} must use 2 cubes while you have 2 or more.`)
}

function afterTurn(ctx: Ctx, playerId: PlayerId): void {
  ctx.g.prompt = null
  ctx.g.cursor = playerId
  runNext(ctx, { t: 'competitionNext' })
}

/**
 * One attack (R-COMP-04/05), applied to the working state. `onlyCountry`
 * restricts it to one country (⚑ FREE_CUBES' investment-phase attack).
 */
export function executeAttack(ctx: Ctx, playerId: PlayerId, attack: Attack, onlyCountry?: CountryId): string {
  if (!attack || typeof attack !== 'object' || !isCountry(attack.country)) fail('Unknown attack.')
  const { country } = attack
  if (onlyCountry !== undefined && country !== onlyCountry) fail(`This attack must be in ${countryName(onlyCountry)}.`)
  const c = ctx.g.countries[country]
  if (looseOf(c, playerId) === 0) fail(`You have no loose cube in ${countryName(country)}.`)
  const me = displayName(ctx, playerId)
  if (attack.kind === 'grab') {
    const s = c.squares[attack.square]
    if (!s) fail('No such square.')
    if (s.occupant !== null) fail('That square is not empty.')
    removeLoose(ctx, playerId, country)
    occupySquare(ctx, playerId, country, attack.square)
    return `${me} grabs a square in ${countryName(country)}.`
  }
  if (attack.kind !== 'kill') fail('Unknown attack.')
  // R-COMP-03: no attacks in Tax Havens beyond grabbing its square.
  if (country === TAX_HAVENS) fail('Tax Havens cubes can only grab its square, never attack.')
  const target = attack.target
  if (!target || typeof target !== 'object') fail('Choose a target.')
  if (target.kind === 'loose') {
    if (target.playerId === playerId || looseOf(c, target.playerId) === 0) fail("That player has no loose cube there.")
    removeLoose(ctx, target.playerId, country)
    removeLoose(ctx, playerId, country)
    return `${me} kills ${displayName(ctx, target.playerId)}'s loose cube in ${countryName(country)}.`
  }
  if (target.kind === 'defender') {
    if (target.playerId === playerId || defendersOf(c, target.playerId) === 0) fail('That player has no defender there.')
    c.defenders[target.playerId] -= 1
    if (c.defenders[target.playerId] === 0) delete c.defenders[target.playerId]
    player(ctx, target.playerId).parkedExecutives += 1
    removeLoose(ctx, playerId, country)
    return `${me} kills ${displayName(ctx, target.playerId)}'s defending executive in ${countryName(country)}.`
  }
  if (target.kind === 'square') {
    const s = c.squares[target.square]
    if (!s || s.occupant === null || s.occupant === 'LOCK' || s.occupant === playerId) fail("That square has no opponent's cube.")
    if (s.fortified) fail('Fortified squares cannot be attacked.')
    const victim = s.occupant
    if (looseOf(c, victim) > 0 || defendersOf(c, victim) > 0) fail(`${displayName(ctx, victim)}'s cube is protected by their loose cubes or defenders.`)
    s.occupant = null
    player(ctx, victim).supply += 1
    removeLoose(ctx, playerId, country)
    return `${me} kills ${displayName(ctx, victim)}'s cube on a square in ${countryName(country)}.`
  }
  fail('Unknown target.')
}

export function onFight(ctx: Ctx, action: FightAction): void {
  expectPrompt(ctx, 'competitionTurn', action.playerId)
  const attacks = Array.isArray(action.attacks) ? action.attacks : []
  if (attacks.length < 1 || attacks.length > 2) fail('A Fight is 1 or 2 attacks.')
  requireTwo(ctx, action.playerId, attacks.length, 'a Fight')
  const surcharge = stallSurcharge(ctx, action.playerId)
  if (surcharge) requireAffordable(ctx, action.playerId, surcharge)
  for (const attack of attacks) note(ctx, executeAttack(ctx, action.playerId, attack))
  if (surcharge) pay(ctx, action.playerId, surcharge)
  afterTurn(ctx, action.playerId)
}

export function onDefend(ctx: Ctx, action: DefendAction): void {
  expectPrompt(ctx, 'competitionTurn', action.playerId)
  const p = player(ctx, action.playerId)
  if (p.executives === 0) fail('You have no executive left to defend with.')
  placeDefender(ctx, action.playerId, action.country)
  const surcharge = stallSurcharge(ctx, action.playerId)
  if (surcharge) {
    requireAffordable(ctx, action.playerId, surcharge)
    pay(ctx, action.playerId, surcharge)
  }
  afterTurn(ctx, action.playerId)
}

/** R-COMP-07: an executive defends any country but Tax Havens, where there's nothing to defend against. */
function placeDefender(ctx: Ctx, playerId: PlayerId, country: CountryId): void {
  if (!isCountry(country) || country === TAX_HAVENS) fail('Defend a country on the board (not Tax Havens).')
  const c = ctx.g.countries[country]
  c.defenders[playerId] = defendersOf(c, playerId) + 1
  player(ctx, playerId).executives -= 1
  note(ctx, `${displayName(ctx, playerId)} defends ${countryName(country)}.`)
}

/** R-COMP-08/09/10: $1 for up to 2 movements of loose cubes along legal arrows. */
export function onExpand(ctx: Ctx, action: ExpandAction): void {
  expectPrompt(ctx, 'competitionTurn', action.playerId)
  const moves = Array.isArray(action.moves) ? action.moves : []
  if (moves.length < 1 || moves.length > 2) fail('An Expand is 1 or 2 movements.')
  requireTwo(ctx, action.playerId, moves.length, 'an Expand')
  const cost = 1 + stallSurcharge(ctx, action.playerId)
  requireAffordable(ctx, action.playerId, cost)
  for (const move of moves) {
    if (!move || !isCountry(move.from) || !isCountry(move.to)) fail('Unknown move.')
    if (looseOf(ctx.g.countries[move.from], action.playerId) === 0) fail(`You have no loose cube in ${countryName(move.from)}.`)
    if (!moveAllowed(ctx.g, move.from, move.to)) fail(`A cube can't move from ${countryName(move.from)} to ${countryName(move.to)}.`)
    removeLoose(ctx, action.playerId, move.from)
    addLoose(ctx, action.playerId, move.to, 1)
    note(ctx, `${displayName(ctx, action.playerId)} moves a cube from ${countryName(move.from)} to ${countryName(move.to)}.`)
  }
  pay(ctx, action.playerId, cost)
  afterTurn(ctx, action.playerId)
}

/** R-COMP-11: every executive left in the pool is placed as a defender, then the player is out for the phase. */
export function onCompetitionPass(ctx: Ctx, action: CompetitionPassAction): void {
  expectPrompt(ctx, 'competitionTurn', action.playerId)
  const defenders = Array.isArray(action.defenders) ? action.defenders : []
  const p = player(ctx, action.playerId)
  if (defenders.length !== p.executives) fail(`Place all ${p.executives} remaining executive(s) as defenders.`)
  for (const country of defenders) placeDefender(ctx, action.playerId, country)
  ctx.g.passed.push(action.playerId)
  note(ctx, `${displayName(ctx, action.playerId)} passes.`)
  afterTurn(ctx, action.playerId)
}
