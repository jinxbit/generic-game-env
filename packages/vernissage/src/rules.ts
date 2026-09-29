// Rules for Vernissage (RULES.md is the source of truth; its rule ids are
// cited throughout) — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// How it's organised: ./data.ts holds the components and every pure reading
// of the board (influence, fame values, assets); this module runs the turn —
// fate counter, objections, Trial of Strength, IN payments, buying, playing
// cards — as a step machine on `GameData.step`. `withEnvelope` derives the
// envelope's `phase`, `activePlayerId` and `pendingPlayerIds` from it in one
// place, so they can never go stale.
//
// Hidden information: hands, the face-down piles, the set-aside cards and the
// grey deck are secret (`redactGame`), and a TAKE_CARD entry names the card
// taken, so it is secret from everyone else (`isActionSecret`). Nothing is
// forced on a player whose only option would reveal their hand: holding no
// might card, say, still means answering the Trial with zero.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, GameState as PlatformGameState, LobbyState, LoggedAction, Random } from '@game-platform/sdk'
import {
  AFTER_IN,
  allowedKinds,
  ARTIST_NAMES,
  ARTISTS,
  availableValues,
  brownDeck,
  canBuyAny,
  cardName,
  counterLabel,
  counterWorth,
  COUNTER_KINDS,
  FAME_MAX,
  FAME_START,
  fameValue,
  FATE_DIE,
  FEATHER_PENALTY,
  formatRubens,
  fullPool,
  GREAT_VERNISSAGE,
  GREY_PRICE,
  greyDeck,
  HAND_SIZE,
  hasAllKinds,
  hasInfluence,
  IN_FROM,
  influencedArtists,
  LOAN,
  NOTE_COST,
  nextCounterStep,
  PILE_PRICES,
  PILE_SIZE,
  positionOf,
  SMALL_VERNISSAGE,
  STARTING_CASH,
  TOP_STEP,
  VARIANT_THRESHOLD,
  assetsOf,
} from './data.ts'
import type { ArtistData, ArtistId, Card, Counter, CounterKind, EndReason, GameAction, GameData, GameOptions, PlayerData, PlayerId, Step, TrialResult } from './types.ts'

export type * from './types.ts'
export * from './data.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export const DEFAULT_GAME_OPTIONS: GameOptions = { mightVariant: false }

export const STEP_LABELS: Record<Step, string> = {
  fate: 'Rolling the fate die',
  place: 'Placing a fate counter',
  objections: 'Objections',
  negotiate: 'Negotiating',
  challenge: 'Deciding on a Trial of Strength',
  trial: 'Trial of Strength',
  display: 'Showing works',
  buy: 'Buying a card',
  choose: 'Choosing from a pile',
  play: 'Playing cards',
  ended: 'Game over',
}

export const END_REASONS: Record<EndReason, string> = {
  topCounter: 'a fate counter stayed on the top step',
  topArtist: 'an artist reached the top step',
  twoOut: 'two artists are OUT',
  noCounters: 'no fate counter was left to place',
}

export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return { mightVariant: o.mightVariant === true }
}

class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message)
}

/** `⟦id⟧` in a journal line names a player; describeAction swaps in their name. */
function who(id: PlayerId): string {
  return `⟦${id}⟧`
}

function isOut(state: GameState, playerId: PlayerId): boolean {
  return state.players.find((p) => p.id === playerId)?.eliminated ?? true
}

function activeSeats(state: GameState, game: GameData): PlayerId[] {
  return game.seatOrder.filter((id) => !isOut(state, id))
}

/** Who may act in `game.step` — the one place `pendingPlayerIds` comes from. */
export function pendingOf(game: GameData): PlayerId[] {
  switch (game.step) {
    case 'ended':
      return []
    case 'objections':
      return game.dispute!.objectors.filter((id) => !(id in game.dispute!.responses))
    case 'challenge': {
      const d = game.dispute!
      return objectorsWhoObjected(d.objectors, d.responses).filter((id) => !(id in d.challenges!))
    }
    case 'trial':
      return [...game.trial!.awaiting]
    case 'display':
      return [...game.display!.awaiting]
    default:
      return game.turnPlayerId ? [game.turnPlayerId] : []
  }
}

function objectorsWhoObjected(objectors: PlayerId[], responses: Record<PlayerId, number | null>): PlayerId[] {
  return objectors.filter((id) => responses[id] !== null && responses[id] !== undefined)
}

/** Keeps the envelope in step with `game.step`. */
export function withEnvelope(state: GameState, game: GameData): GameState {
  if (game.step === 'ended') return { ...state, game, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [] }
  const pending = pendingOf(game)
  const active = pending.length === 1 && pending[0] === game.turnPlayerId ? game.turnPlayerId : null
  return { ...state, game, phase: game.step, activePlayerId: active, pendingPlayerIds: pending }
}

/** The working state of one action: a deep copy of `game` the handlers mutate freely. */
interface Ctx {
  state: GameState
  g: GameData
  turn: number
  winners: PlayerId[] | null
  random: Random
}

// ---------------------------------------------------------------- turn flow

function nextPlayer(ctx: Ctx, from: PlayerId | null): PlayerId | null {
  const seats = ctx.g.seatOrder
  const start = from ? seats.indexOf(from) : -1
  for (let i = 1; i <= seats.length; i++) {
    const candidate = seats[(start + i + seats.length) % seats.length]
    if (!isOut(ctx.state, candidate)) return candidate
  }
  return null
}

/** §4: a new turn, skipping the fate step when there is nothing to place (R-TURN-01, R-FATE-03). */
function startTurn(ctx: Ctx, playerId: PlayerId | null): void {
  const g = ctx.g
  g.turnPlayerId = playerId
  g.fate = null
  g.stepCardPlayed = false
  g.choosing = null
  ctx.turn += 1
  if (!playerId) return
  if (COUNTER_KINDS.every((k) => g.pool[k].every((n) => n === 0))) {
    // AMBIG-17: every counter stands in front of an artist — nothing can move any more.
    finish(ctx, 'noCounters')
    return
  }
  if (influencedArtists(g, playerId).length === 0) {
    g.journal.push(`${who(playerId)} has no influence over any artist and places no counter.`)
    enterBuy(ctx)
    return
  }
  g.step = 'fate'
}

function endTurn(ctx: Ctx): void {
  startTurn(ctx, nextPlayer(ctx, ctx.g.turnPlayerId))
}

function enterBuy(ctx: Ctx): void {
  const g = ctx.g
  if (!g.turnPlayerId || isOut(ctx.state, g.turnPlayerId)) return endTurn(ctx)
  if (canBuyAny(g)) {
    g.step = 'buy'
    return
  }
  g.journal.push('No card is left to buy.')
  enterPlay(ctx)
}

function enterPlay(ctx: Ctx): void {
  const g = ctx.g
  // An empty hand is public (its size is), so skipping the step reveals nothing.
  if (g.players[g.turnPlayerId!].hand.length === 0) return endTurn(ctx)
  g.step = 'play'
}

/** §10. */
function finish(ctx: Ctx, reason: EndReason): void {
  const g = ctx.g
  g.step = 'ended'
  g.endReason = reason
  g.dispute = null
  g.trial = null
  g.display = null
  g.choosing = null
  const standing = activeSeats(ctx.state, g)
  g.finalAssets = Object.fromEntries(standing.map((id) => [id, assetsOf(g, id)]))
  const best = Math.max(...standing.map((id) => g.finalAssets![id]))
  ctx.winners = standing.filter((id) => g.finalAssets![id] === best)
  g.journal.push(`Game over: ${END_REASONS[reason]}.`)
}

// ------------------------------------------------------------ fame and effects

function returnCounters(g: GameData, counters: Counter[]): void {
  for (const c of counters) g.pool[c.kind][c.value - 1] += 1
}

/** R-OUT-01. */
function goOut(g: GameData, artist: ArtistId): void {
  const a = g.artists[artist]
  returnCounters(g, a.counters)
  g.artists[artist] = { ...a, counters: [], fame: 0, out: true }
  if (g.feather === artist) g.feather = null
  g.journal.push(`${ARTIST_NAMES[artist]} is OUT.`)
}

/** R-FAME-02/03, R-IN-03: moves a fame marker, collecting the value of each IN space reached. */
function moveFame(g: GameData, artist: ArtistId, delta: number, inValues: number[]): void {
  const a = g.artists[artist]
  const fame = a.fame + delta
  if (fame <= 0) return goOut(g, artist)
  if (fame >= IN_FROM) {
    const space = Math.min(fame, FAME_MAX)
    inValues.push(fameValue(space))
    g.journal.push(`${ARTIST_NAMES[artist]} is IN at ${formatRubens(fameValue(space))}.`)
    a.fame = AFTER_IN
    return
  }
  a.fame = fame
}

function twoOut(g: GameData): boolean {
  return ARTISTS.filter((artist) => g.artists[artist].out).length >= 2
}

/** §7: a counter that stays takes effect, then whatever it sets off. */
function takeEffect(ctx: Ctx, artist: ArtistId, counter: Counter): void {
  const g = ctx.g
  const a = g.artists[artist]
  const counterStep = nextCounterStep(a)
  a.counters = [...a.counters, counter]
  const inValues: number[] = []
  const feathered = g.feather === artist
  const delta = counterWorth(counter.kind, counter.value) + (feathered ? -FEATHER_PENALTY : 0)
  g.journal.push(`${ARTIST_NAMES[artist]} moves ${delta > 0 ? '+' : '−'}${Math.abs(delta)} on the scale of fame${feathered ? ' (the critic’s feather adds −5)' : ''}.`)
  moveFame(g, artist, delta, inValues)
  if (!g.artists[artist].out && hasAllKinds(g.artists[artist])) vernissage(g, artist, inValues)
  if (twoOut(g)) return finish(ctx, 'twoOut')
  const reason: EndReason | null = g.artists[artist].step >= TOP_STEP ? 'topArtist' : counterStep >= TOP_STEP ? 'topCounter' : null
  if (inValues.length > 0) {
    g.step = 'display'
    g.display = { artist, values: inValues, awaiting: activeSeats(ctx.state, g), then: reason ? 'end' : 'buy' }
    return
  }
  if (reason) return finish(ctx, reason)
  enterBuy(ctx)
}

/** §7.1. */
function vernissage(g: GameData, artist: ArtistId, inValues: number[]): void {
  const a = g.artists[artist]
  const to = Math.min(TOP_STEP, nextCounterStep(a))
  returnCounters(g, a.counters)
  a.counters = []
  a.step = to
  const position = positionOf(g, artist)
  const bonus = position === 1 ? GREAT_VERNISSAGE : position === 2 ? SMALL_VERNISSAGE : 0
  const name = position === 1 ? 'a Great Vernissage' : position === 2 ? 'a Small Vernissage' : 'a Vernissage'
  if (g.feather === artist) {
    g.journal.push(`${ARTIST_NAMES[artist]} holds ${name} and climbs to step ${to}, but the critic’s feather denies the bonus.`)
    return
  }
  g.journal.push(`${ARTIST_NAMES[artist]} holds ${name} and climbs to step ${to}${bonus ? ` (+${bonus})` : ''}.`)
  if (bonus) moveFame(g, artist, bonus, inValues)
}

// ---------------------------------------------------------------- validation

function requireTurnPlayer(g: GameData, playerId: PlayerId, steps: readonly Step[]): void {
  if (g.turnPlayerId !== playerId) fail("It isn't your turn.")
  if (!steps.includes(g.step)) fail(`You can't do that now (${STEP_LABELS[g.step].toLowerCase()}).`)
}

function requireArtist(artist: unknown): ArtistId {
  if (!ARTISTS.includes(artist as ArtistId)) fail(`Unknown artist: ${String(artist)}`)
  return artist as ArtistId
}

function requireCount(count: unknown, max: number, what: string): number {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) fail('Choose a whole number, 0 or more.')
  if (count > max) fail(`You have only ${max} ${what}.`)
  return count
}

function requireStep(step: unknown): number {
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > TOP_STEP) fail(`Choose a step from 1 to ${TOP_STEP}.`)
  return step
}

function takeFromHand(g: GameData, playerId: PlayerId, cardId: unknown, kind: Card['kind']): Card {
  const p = g.players[playerId]
  const card = p.hand.find((c) => c !== null && c.id === cardId)
  if (!card || card.kind !== kind) fail('That card is not in your hand.')
  p.hand = p.hand.filter((c) => c !== card)
  return card
}

// ------------------------------------------------------------------ handlers

/** R-FATE-01. */
function onRollFate(ctx: Ctx, playerId: PlayerId): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['fate'])
  g.fate = FATE_DIE[ctx.random.int(0, FATE_DIE.length - 1)]
  g.step = 'place'
}

/** R-FATE-02..06. */
function onPlaceCounter(ctx: Ctx, playerId: PlayerId, rawArtist: unknown, rawKind: unknown, rawValue: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['place'])
  const artist = requireArtist(rawArtist)
  if (!hasInfluence(g, playerId, artist)) fail(`You have no influence over ${ARTIST_NAMES[artist]}.`)
  const kinds = allowedKinds(g, g.fate!)
  if (!kinds.includes(rawKind as CounterKind)) fail(`The fate die lets you take ${kinds.join(' or ')}.`)
  const kind = rawKind as CounterKind
  if (typeof rawValue !== 'number' || !availableValues(g, kind).includes(rawValue)) fail(`No ${kind} counter of that value is left.`)
  const counter: Counter = { kind, value: rawValue }
  g.pool[kind][rawValue - 1] -= 1
  g.journal.push(`${who(playerId)} places ${counterLabel(kind, rawValue)} in front of ${ARTIST_NAMES[artist]} (step ${nextCounterStep(g.artists[artist])}).`)
  const objectors = activeSeats(ctx.state, g).filter((id) => id !== playerId && hasInfluence(g, id, artist))
  if (objectors.length === 0) return takeEffect(ctx, artist, counter)
  g.dispute = { artist, counter, objectors, responses: {}, challenges: null }
  g.step = 'objections'
}

/** R-OBJ-01. */
function onRespond(ctx: Ctx, playerId: PlayerId, value: unknown): void {
  const g = ctx.g
  const d = g.dispute
  if (g.step !== 'objections' || !d || !d.objectors.includes(playerId)) fail('You have no say over this counter.')
  if (playerId in d.responses) fail('You have already answered.')
  if (value !== null) {
    if (typeof value !== 'number' || value === d.counter.value || !availableValues(g, d.counter.kind).includes(value)) {
      fail(`Propose another ${d.counter.kind} value that is still available.`)
    }
    g.journal.push(`${who(playerId)} objects and proposes ${counterLabel(d.counter.kind, value)}.`)
  }
  d.responses = { ...d.responses, [playerId]: value }
  afterResponses(ctx)
}

function afterResponses(ctx: Ctx): void {
  const d = ctx.g.dispute!
  if (d.objectors.some((id) => !(id in d.responses))) return
  if (objectorsWhoObjected(d.objectors, d.responses).length === 0) return settle(ctx, d.counter)
  ctx.g.step = 'negotiate'
}

/** The dispute ends with `counter` staying (R-OBJ-02..04, R-TRIAL-03). */
function settle(ctx: Ctx, counter: Counter): void {
  const artist = ctx.g.dispute!.artist
  ctx.g.dispute = null
  ctx.g.trial = null
  takeEffect(ctx, artist, counter)
}

/** R-OBJ-03. */
function onNegotiate(ctx: Ctx, playerId: PlayerId, value: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['negotiate'])
  const d = g.dispute!
  if (value === null) {
    g.journal.push(`${who(playerId)} refuses every proposal.`)
    d.challenges = {}
    g.step = 'challenge'
    return
  }
  const proposals = Object.values(d.responses).filter((v): v is number => v !== null)
  if (typeof value !== 'number' || !proposals.includes(value)) fail('Agree to one of the proposed values, or refuse.')
  g.pool[d.counter.kind][d.counter.value - 1] += 1
  g.pool[d.counter.kind][value - 1] -= 1
  g.journal.push(`${who(playerId)} agrees to ${counterLabel(d.counter.kind, value)}.`)
  settle(ctx, { kind: d.counter.kind, value })
}

/** R-OBJ-04. */
function onChallenge(ctx: Ctx, playerId: PlayerId, challenge: unknown): void {
  const g = ctx.g
  const d = g.dispute
  if (g.step !== 'challenge' || !d || !pendingOf(g).includes(playerId)) fail('You have no Trial of Strength to decide on.')
  if (typeof challenge !== 'boolean') fail('Say whether you call a Trial of Strength.')
  d.challenges = { ...d.challenges!, [playerId]: challenge }
  g.journal.push(challenge ? `${who(playerId)} calls a Trial of Strength.` : `${who(playerId)} lets it go.`)
  afterChallenges(ctx)
}

function afterChallenges(ctx: Ctx): void {
  const g = ctx.g
  const d = g.dispute!
  const deciding = objectorsWhoObjected(d.objectors, d.responses)
  if (deciding.some((id) => !(id in d.challenges!))) return
  const contras = deciding.filter((id) => d.challenges![id])
  if (contras.length === 0) return settle(ctx, d.counter)
  g.trial = { contras, might: {}, side: 'contra', round: 1, awaiting: [...contras], added: 0 }
  g.step = 'trial'
}

/** R-TRIAL-01. */
function onCommitMight(ctx: Ctx, playerId: PlayerId, rawCount: unknown): void {
  const g = ctx.g
  const t = g.trial
  if (g.step !== 'trial' || !t || !t.awaiting.includes(playerId)) fail('It is not your turn to commit might cards.')
  const hand = g.players[playerId].hand
  const mights = hand.filter((c): c is Card => c !== null && c.kind === 'might')
  const count = requireCount(rawCount, mights.length, 'might cards')
  const committed = mights.slice(0, count)
  g.players[playerId].hand = hand.filter((c) => !committed.includes(c as Card))
  t.might = { ...t.might, [playerId]: [...(t.might[playerId] ?? []), ...committed] }
  t.added += count
  t.awaiting = t.awaiting.filter((id) => id !== playerId)
  g.journal.push(`${who(playerId)} commits ${count} might card${count === 1 ? '' : 's'}${t.might[playerId].length > count ? ` (${t.might[playerId].length} in all)` : ''}.`)
  afterCommit(ctx)
}

function afterCommit(ctx: Ctx): void {
  const t = ctx.g.trial!
  if (t.awaiting.length > 0) return
  if (t.side === 'contra') {
    if (t.round > 1 && t.added === 0) return decideTrial(ctx)
    t.side = 'pro'
    t.awaiting = [ctx.g.turnPlayerId!]
    t.added = 0
    return
  }
  if (t.added === 0) return decideTrial(ctx)
  t.side = 'contra'
  t.round += 1
  t.awaiting = [...t.contras]
  t.added = 0
}

/** R-TRIAL-02..06: every participant rolls, ties with the pro player roll again. */
function decideTrial(ctx: Ctx): void {
  const g = ctx.g
  const t = g.trial!
  const d = g.dispute!
  const pro = g.turnPlayerId!
  const might = (id: PlayerId) => t.might[id]?.length ?? 0
  const participants = [...t.contras, pro]
  const result: TrialResult = { artist: d.artist, winner: 'pro', pro, rolls: participants.map((id) => ({ playerId: id, might: might(id), dice: [] })), discarded: [] }
  const roll = (id: PlayerId): number => {
    const dice: [number, number] = [ctx.random.int(1, 6), ctx.random.int(1, 6)]
    result.rolls.find((r) => r.playerId === id)!.dice.push(dice)
    return dice[0] + dice[1] + might(id)
  }
  let rolling = participants
  const totals: Record<PlayerId, number> = {}
  for (let round = 0; ; round++) {
    for (const id of rolling) totals[id] = roll(id)
    if (round === 0 && ctx.state.options.mightVariant) {
      result.discarded = participants.filter((id) => totals[id] >= VARIANT_THRESHOLD && might(id) > 0)
    }
    const best = Math.max(...t.contras.filter((id) => rolling.includes(id)).map((id) => totals[id]))
    if (totals[pro] > best) break
    if (best > totals[pro]) {
      result.winner = 'contra'
      break
    }
    rolling = [...t.contras.filter((id) => rolling.includes(id) && totals[id] === best), pro]
    if (round > 50) break // Unreachable in practice; keeps a pathological source from looping forever.
  }
  // R-TRIAL-05/06: might cards go home, less any the variant discards.
  for (const [id, cards] of Object.entries(t.might)) {
    const back = result.discarded.includes(id) ? cards.slice(1) : cards
    g.players[id].hand = [...g.players[id].hand, ...back]
  }
  g.lastTrial = result
  const line = result.rolls.map((r) => `${who(r.playerId)} ${r.dice.map(([a, b]) => `${a}+${b}`).join(', then ')}${r.might ? ` +${r.might} might` : ''}`).join('; ')
  g.journal.push(`Trial of Strength: ${line}. ${result.winner === 'pro' ? `${who(pro)} wins` : 'The objectors win'}.`)
  for (const id of result.discarded) g.journal.push(`${who(id)} discards a might card (variant).`)
  const step = g.artists[d.artist].step
  const loseAgent = (id: PlayerId) => {
    const p = g.players[id]
    p.agents = p.agents.map((s) => (s === step ? null : s))
  }
  if (result.winner === 'pro') {
    // R-TRIAL-03.
    for (const id of t.contras) loseAgent(id)
    return settle(ctx, d.counter)
  }
  // R-TRIAL-04.
  returnCounters(g, [d.counter])
  loseAgent(pro)
  g.journal.push(`The ${d.counter.kind} counter is removed and ${who(pro)} loses their agent on step ${step}.`)
  g.dispute = null
  g.trial = null
  enterBuy(ctx)
}

/** R-IN-01/02. */
function onDisplay(ctx: Ctx, playerId: PlayerId, rawCount: unknown): void {
  const g = ctx.g
  const d = g.display
  if (g.step !== 'display' || !d || !d.awaiting.includes(playerId)) fail('You have nothing to decide about showing works.')
  const p = g.players[playerId]
  const hidden = p.hand.filter((c): c is Card => c !== null && c.kind === 'work' && c.artist === d.artist)
  const count = requireCount(rawCount, hidden.length, `hidden works by ${ARTIST_NAMES[d.artist]}`)
  const shown = hidden.slice(0, count)
  p.hand = p.hand.filter((c) => !shown.includes(c as Card))
  p.shown = [...p.shown, ...shown]
  if (count > 0) g.journal.push(`${who(playerId)} shows ${count} work${count === 1 ? '' : 's'} by ${ARTIST_NAMES[d.artist]}.`)
  d.awaiting = d.awaiting.filter((id) => id !== playerId)
  afterDisplay(ctx)
}

function afterDisplay(ctx: Ctx): void {
  const g = ctx.g
  const d = g.display!
  if (d.awaiting.length > 0) return
  const total = d.values.reduce((a, b) => a + b, 0)
  for (const id of activeSeats(ctx.state, g)) {
    const p = g.players[id]
    const count = p.shown.filter((c) => c.kind === 'work' && c.artist === d.artist).length
    if (count === 0) continue
    p.cash += count * total
    g.journal.push(`${who(id)} receives ${formatRubens(count * total)} for ${count} shown work${count === 1 ? '' : 's'}.`)
  }
  g.display = null
  if (d.then === 'end') {
    const artist = g.artists[d.artist]
    return finish(ctx, artist.step >= TOP_STEP ? 'topArtist' : 'topCounter')
  }
  if (d.then === 'next') return endTurn(ctx)
  enterBuy(ctx)
}

/** R-BUY-04: pays, borrowing as needed. */
function pay(g: GameData, playerId: PlayerId, amount: number): void {
  const p = g.players[playerId]
  while (p.cash < amount) {
    p.cash += LOAN
    p.notes += 1
    g.journal.push(`${who(playerId)} borrows ${formatRubens(LOAN)} for a ${formatRubens(NOTE_COST)} promissory note.`)
  }
  p.cash -= amount
}

/** R-BUY-01/02. */
function onBuyPile(ctx: Ctx, playerId: PlayerId, pile: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['buy'])
  if (typeof pile !== 'number' || !Number.isInteger(pile) || pile < 0 || pile >= g.piles.length) fail('Choose one of the seven piles.')
  if (g.piles[pile].length === 0) fail('That pile is empty.')
  pay(g, playerId, PILE_PRICES[pile])
  g.choosing = pile
  g.step = 'choose'
}

/** R-BUY-02. */
function onTakeCard(ctx: Ctx, playerId: PlayerId, cardId: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['choose'])
  const pile = g.piles[g.choosing!]
  if (cardId !== null) {
    const card = pile.find((c) => c !== null && c.id === cardId)
    if (!card) fail('That card is not in the pile.')
    g.piles[g.choosing!] = pile.filter((c) => c !== card)
    g.players[playerId].hand.push(card)
  }
  g.choosing = null
  enterPlay(ctx)
}

/** R-BUY-01/03. */
function onBuyGrey(ctx: Ctx, playerId: PlayerId): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['buy'])
  if (g.greyDeck.length === 0) {
    if (g.greyDiscard.length === 0) fail('No grey card is left.')
    g.greyDeck = ctx.random.shuffle(g.greyDiscard)
    g.greyDiscard = []
    g.journal.push('The grey discard is shuffled into a new grey deck.')
  }
  pay(g, playerId, GREY_PRICE)
  const [top, ...rest] = g.greyDeck
  g.greyDeck = rest
  g.players[playerId].hand.push(top)
  enterPlay(ctx)
}

function checkAgents(agents: (number | null)[]): void {
  const placed = agents.filter((s): s is number => s !== null)
  if (new Set(placed).size !== placed.length) fail('Two of your agents may not share a step.')
}

/** R-PLAY-01/02. */
function onPlayUnlimited(ctx: Ctx, playerId: PlayerId, cardId: unknown, agents: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['play'])
  if (g.stepCardPlayed) fail('You have already played a step change card this turn.')
  const p = g.players[playerId]
  if (!Array.isArray(agents) || agents.length !== p.agents.length) fail('Say where each of your three agents goes.')
  const next = agents.map((s, i) => {
    if (s === null) {
      if (p.agents[i] !== null) fail('Agents on the staircase stay on it.')
      return null
    }
    return requireStep(s)
  })
  checkAgents(next)
  takeFromHand(g, playerId, cardId, 'unlimited')
  p.agents = next
  g.stepCardPlayed = true
  g.journal.push(`${who(playerId)} plays an unlimited step change: agents on ${describeAgents(next)}.`)
  if (p.hand.length === 0) endTurn(ctx)
}

/** R-PLAY-03. */
function onPlayLimited(ctx: Ctx, playerId: PlayerId, cardId: unknown, agent: unknown, to: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['play'])
  if (g.stepCardPlayed) fail('You have already played a step change card this turn.')
  const p = g.players[playerId]
  const card = p.hand.find((c) => c !== null && c.id === cardId)
  if (!card || card.kind !== 'limited') fail('That card is not in your hand.')
  if (typeof agent !== 'number' || !Number.isInteger(agent) || agent < 0 || agent >= p.agents.length) fail('Choose one of your agents.')
  const step = requireStep(to)
  const from = p.agents[agent]
  if (from === null && step > card.steps) fail(`A new agent may go no higher than step ${card.steps}.`)
  if (from !== null && (step === from || Math.abs(step - from) > card.steps)) fail(`Move the agent 1 to ${card.steps} step${card.steps === 1 ? '' : 's'}.`)
  const next = p.agents.map((s, i) => (i === agent ? step : s))
  checkAgents(next)
  takeFromHand(g, playerId, cardId, 'limited')
  g.greyDiscard = [...g.greyDiscard, card]
  p.agents = next
  g.stepCardPlayed = true
  g.journal.push(`${who(playerId)} plays a step change (${card.steps}): ${from === null ? 'a new agent to' : `an agent from step ${from} to`} step ${step}.`)
  if (p.hand.length === 0) endTurn(ctx)
}

/** R-CRITIC-01/02. */
function onPlayCritic(ctx: Ctx, playerId: PlayerId, cardId: unknown, rawArtist: unknown): void {
  const g = ctx.g
  requireTurnPlayer(g, playerId, ['play'])
  const artist = requireArtist(rawArtist)
  if (!hasInfluence(g, playerId, artist)) fail(`You have no influence over ${ARTIST_NAMES[artist]}.`)
  takeFromHand(g, playerId, cardId, 'critic')
  g.feather = artist
  g.journal.push(`${who(playerId)} plays a critic card: the critic’s feather goes to ${ARTIST_NAMES[artist]} (−${FEATHER_PENALTY}).`)
  moveFame(g, artist, -FEATHER_PENALTY, [])
  if (twoOut(g)) return finish(ctx, 'twoOut')
  endTurn(ctx)
}

function describeAgents(agents: (number | null)[]): string {
  const placed = agents.filter((s): s is number => s !== null).sort((a, b) => a - b)
  return placed.length > 0 ? `step${placed.length === 1 ? '' : 's'} ${placed.join(', ')}` : 'none'
}

function apply(state: GameState, action: GameAction, random: Random): GameState {
  const actor = state.players.find((p) => p.id === action.playerId)
  if (!actor) fail(`Unknown player: ${action.playerId}`)
  if (actor.eliminated) fail('You are no longer in this game.')
  // A deep working copy: handlers mutate it freely. Never mutate `state` (replay and undo keep it).
  const g = JSON.parse(JSON.stringify(state.game)) as GameData
  g.journal = []
  const ctx: Ctx = { state, g, turn: state.turn, winners: null, random }
  switch (action.type) {
    case 'ROLL_FATE':
      onRollFate(ctx, action.playerId)
      break
    case 'PLACE_COUNTER':
      onPlaceCounter(ctx, action.playerId, action.artist, action.kind, action.value)
      break
    case 'RESPOND':
      onRespond(ctx, action.playerId, action.value)
      break
    case 'NEGOTIATE':
      onNegotiate(ctx, action.playerId, action.value)
      break
    case 'CHALLENGE':
      onChallenge(ctx, action.playerId, action.challenge)
      break
    case 'COMMIT_MIGHT':
      onCommitMight(ctx, action.playerId, action.count)
      break
    case 'DISPLAY':
      onDisplay(ctx, action.playerId, action.count)
      break
    case 'BUY_PILE':
      onBuyPile(ctx, action.playerId, action.pile)
      break
    case 'BUY_GREY':
      onBuyGrey(ctx, action.playerId)
      break
    case 'TAKE_CARD':
      onTakeCard(ctx, action.playerId, action.cardId)
      break
    case 'PLAY_UNLIMITED':
      onPlayUnlimited(ctx, action.playerId, action.cardId, action.agents)
      break
    case 'PLAY_LIMITED':
      onPlayLimited(ctx, action.playerId, action.cardId, action.agent, action.to)
      break
    case 'PLAY_CRITIC':
      onPlayCritic(ctx, action.playerId, action.cardId, action.artist)
      break
    case 'END_TURN':
      requireTurnPlayer(g, action.playerId, ['play'])
      endTurn(ctx)
      break
    default: {
      const unknown: never = action
      fail(`Unknown action: ${String((unknown as { type: unknown }).type)}`)
    }
  }
  const next = withEnvelope({ ...state, turn: ctx.turn }, g)
  return ctx.winners ? { ...next, winnerPlayerIds: ctx.winners } : next
}

// ---------------------------------------------------------------------- setup

function newPlayer(): PlayerData {
  return { cash: STARTING_CASH, notes: 0, agents: [1, 2, null], hand: [], shown: [] }
}

/** R-SETUP-01..07. */
function setup(lobby: LobbyState<GameOptions>, random: Random): GameState {
  let brown = random.shuffle(brownDeck())
  const players: Record<PlayerId, PlayerData> = {}
  for (const id of lobby.turnOrder) {
    const player = newPlayer()
    // R-SETUP-04 (AMBIG-6): three works is redrawn.
    for (;;) {
      player.hand = brown.slice(0, HAND_SIZE)
      if (player.hand.some((c) => c!.kind !== 'work')) break
      brown = random.shuffle(brown)
    }
    brown = brown.slice(HAND_SIZE)
    players[id] = player
  }
  const piles = PILE_PRICES.map((_, i) => brown.slice(i * PILE_SIZE, (i + 1) * PILE_SIZE))
  const aside = brown.slice(PILE_PRICES.length * PILE_SIZE)
  const artists = Object.fromEntries(ARTISTS.map((id): [ArtistId, ArtistData] => [id, { step: 1, counters: [], fame: FAME_START, out: false }])) as Record<ArtistId, ArtistData>
  const game: GameData = {
    artists,
    pool: fullPool(),
    feather: null,
    players,
    piles,
    aside,
    greyDeck: random.shuffle(greyDeck()),
    greyDiscard: [],
    seatOrder: [...lobby.turnOrder],
    turnPlayerId: lobby.turnOrder[0] ?? null,
    step: 'fate',
    fate: null,
    dispute: null,
    trial: null,
    display: null,
    choosing: null,
    stepCardPlayed: false,
    lastTrial: null,
    journal: [],
    endReason: null,
    finalAssets: null,
  }
  return withEnvelope({ ...lobby, status: 'active', turn: 1 } as GameState, game)
}

function without<T>(record: Record<PlayerId, T>, id: PlayerId): Record<PlayerId, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))
}

/** §11: a player leaves. */
function eliminate(state: GameState, playerId: PlayerId, random: Random): GameState {
  const g = JSON.parse(JSON.stringify(state.game)) as GameData
  g.journal = []
  const ctx: Ctx = { state, g, turn: state.turn, winners: null, random }
  if (g.players[playerId]) g.players[playerId].agents = g.players[playerId].agents.map(() => null)
  if (state.status !== 'active' || g.step === 'ended') return { ...state, game: g }
  if (g.turnPlayerId === playerId) {
    if (g.step === 'display') {
      // R-LEAVE-02: the payment still happens.
      g.display!.awaiting = g.display!.awaiting.filter((id) => id !== playerId)
      if (g.display!.then === 'buy') g.display!.then = 'next'
      afterDisplay(ctx)
    } else {
      if (g.dispute) returnCounters(g, [g.dispute.counter])
      if (g.trial) for (const [id, cards] of Object.entries(g.trial.might)) g.players[id].hand.push(...cards)
      g.dispute = null
      g.trial = null
      endTurn(ctx)
    }
  } else {
    const d = g.dispute
    if (d && d.objectors.includes(playerId)) {
      d.objectors = d.objectors.filter((id) => id !== playerId)
      d.responses = without(d.responses, playerId)
      if (d.challenges) d.challenges = without(d.challenges, playerId)
    }
    if (g.step === 'objections') afterResponses(ctx)
    else if (g.step === 'negotiate' && objectorsWhoObjected(d!.objectors, d!.responses).length === 0) settle(ctx, d!.counter)
    else if (g.step === 'challenge') afterChallenges(ctx)
    else if (g.step === 'trial' && g.trial!.contras.includes(playerId)) {
      // R-LEAVE-03.
      const t = g.trial!
      g.players[playerId].hand.push(...(t.might[playerId] ?? []))
      t.might = without(t.might, playerId)
      t.contras = t.contras.filter((id) => id !== playerId)
      t.awaiting = t.awaiting.filter((id) => id !== playerId)
      if (t.contras.length === 0) {
        for (const [id, cards] of Object.entries(t.might)) g.players[id].hand.push(...cards)
        settle(ctx, d!.counter)
      } else afterCommit(ctx)
    } else if (g.step === 'display') {
      g.display!.awaiting = g.display!.awaiting.filter((id) => id !== playerId)
      afterDisplay(ctx)
    }
  }
  const next = withEnvelope({ ...state, turn: ctx.turn }, g)
  return ctx.winners ? { ...next, winnerPlayerIds: ctx.winners } : next
}

// ----------------------------------------------------------------- narration

function headline(action: GameAction, before: GameState, after: GameState): string {
  switch (action.type) {
    case 'ROLL_FATE':
      return `{player} rolls the fate die: ${after.game.fate}.`
    case 'BUY_PILE':
      return `{player} buys pile ${action.pile + 1} for ${formatRubens(PILE_PRICES[action.pile])}.`
    case 'BUY_GREY':
      return `{player} buys a grey card for ${formatRubens(GREY_PRICE)}.`
    case 'TAKE_CARD': {
      const card = action.cardId === null ? null : before.game.piles[before.game.choosing!].find((c) => c?.id === action.cardId)
      return card ? `{player} takes ${cardName(card)} from pile ${before.game.choosing! + 1}.` : `{player} takes no card from pile ${before.game.choosing! + 1}.`
    }
    case 'RESPOND':
      return action.value === null ? '{player} accepts the counter.' : ''
    case 'DISPLAY':
      return action.count === 0 ? '{player} shows no works.' : ''
    case 'END_TURN':
      return '{player} ends their turn.'
    default:
      return ''
  }
}

function describe(action: GameAction, before: GameState, after: GameState): ActionDescription {
  const name = (id: string) => after.players.find((p) => p.id === id)?.displayName ?? 'Someone'
  const lines = after.game.journal.map((line) => line.replace(/⟦([^⟧]*)⟧/g, (_, id: string) => (id === action.playerId ? '{player}' : name(id))))
  if (after.status === 'completed' && after.winnerPlayerIds.length > 0) lines.push(`Winner${after.winnerPlayerIds.length === 1 ? '' : 's'}: ${after.winnerPlayerIds.map(name).join(', ')}.`)
  const message = [headline(action, before, after), ...lines].filter(Boolean).join(' ') || '{player} moves.'
  if (action.type === 'TAKE_CARD') {
    return { message, redactedMessage: [`{player} makes their choice from pile ${before.game.choosing! + 1}.`, ...lines].join(' ') }
  }
  return { message }
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'vernissage',
  rulesVersion: 1,
  title: 'Vernissage',
  turnLabel: 'Turn',
  minPlayers: 3,
  maxPlayers: 5,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    return options.mightVariant ? 'Might-card variant' : 'Standard rules'
  },

  setup,

  applyAction(state, action, random): ActionResult<GameState> {
    if (state.status !== 'active') return { ok: false, error: 'The game is over.' }
    try {
      return { ok: true, state: apply(state, action, random) }
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, error: error.message }
      throw error
    }
  },

  onPlayerEliminated: eliminate,

  nextForcedAction() {
    return null
  },

  redactGame(state, viewerId) {
    const g = state.game
    if (state.status !== 'active') return g
    const hide = (cards: readonly (Card | null)[]) => cards.map(() => null)
    const seesPile = (i: number) => g.step === 'choose' && g.choosing === i && viewerId !== null && viewerId === g.turnPlayerId
    return {
      ...g,
      players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, id === viewerId ? p : { ...p, hand: hide(p.hand) }])),
      piles: g.piles.map((pile, i) => (seesPile(i) ? pile : hide(pile))),
      aside: hide(g.aside),
      greyDeck: hide(g.greyDeck),
    }
  },

  isActionSecret(entry: LoggedAction, state, viewerId) {
    // R-BUY-02: which card was taken stays between the buyer and the pile.
    const action = entry.action as GameAction
    return state.status === 'active' && action.type === 'TAKE_CARD' && action.playerId !== viewerId
  },

  describeAction: describe,

  describePhase(phase) {
    return phase && phase in STEP_LABELS ? STEP_LABELS[phase as Step] : 'In progress'
  },
}
