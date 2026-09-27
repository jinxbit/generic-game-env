// The phase machine (RULES.md §4.1): runs queued tasks until the game needs a
// decision (a prompt) or ends, and keeps the platform envelope in step with it.

import type { LobbyState, Random } from '@game-platform/sdk'
import { ALL_COUNTRY_IDS, countryDef, MAJOR_COUNTRIES } from './board.ts'
import { competitionCleanup, competitionNext, income, startCompetition } from './competition.ts'
import { activeSeats, isEliminated, type Ctx, type GameState } from './context.ts'
import { AMBIGUITY_DEFAULTS } from './ambiguities.ts'
import { INDUSTRIES, INVESTMENT_CARDS, PAYOFF_CARDS_PER_INDUSTRY, RD_START, SETUP_LOCKS, ZONES, type ZoneId } from './data/board.ts'
import { CORPORATIONS, EXECUTIVES_BY_PLAYER_COUNT, type PlayerCountKey } from './data/corporations.ts'
import { OUTLOOK_CARDS } from './data/outlookCards.ts'
import { crisisApply, endGame, interest, payoff, repayment, startEarnings } from './earnings.ts'
import { closedSellOffer, freeCubes, investmentNext, placeBought, removeSold, replaceSeller, reverseAuction, saleCost, settlePurchase, startInvestment } from './investment.ts'
import { lobbyNext, startLobbying } from './lobbying.ts'
import { offerUnlocked, outlookDraw, playOutlook, revealPayoffs, runEffect, startRound } from './outlook.ts'
import { growthIndexOf } from './sliders.ts'
import type { CountryState, CorpPlayer, GameData, GameOptions, Industry, PhaseId, PlayerId, Prompt, Task } from './types.ts'

/** Upper bound on tasks per action — a loop that never settles is a bug, not a hang. */
const MAX_TASKS = 10_000

/** Runs queued tasks until a prompt is waiting, the queue is empty, or the game has ended. */
export function run(ctx: Ctx): void {
  for (let i = 0; ctx.g.prompt === null && ctx.g.queue.length > 0; i++) {
    if (i >= MAX_TASKS) throw new Error('The phase machine did not settle.')
    runTask(ctx, ctx.g.queue.shift() as Task)
  }
}

function runTask(ctx: Ctx, task: Task): void {
  switch (task.t) {
    case 'startRound':
      return startRound(ctx)
    case 'outlookDraw':
      return outlookDraw(ctx)
    case 'playOutlook':
      return playOutlook(ctx, task.cardId)
    case 'effect':
      return runEffect(ctx, task)
    case 'offerUnlocked':
      return offerUnlocked(ctx, task)
    case 'revealPayoffs':
      return revealPayoffs(ctx)
    case 'endPhase':
      return endPhase(ctx)
    case 'startInvestment':
      return startInvestment(ctx)
    case 'investmentNext':
      return investmentNext(ctx)
    case 'settlePurchase':
      return settlePurchase(ctx, task)
    case 'placeBought':
      return placeBought(ctx, task)
    case 'reverseAuction':
      return reverseAuction(ctx, task)
    case 'closedSellOffer':
      return closedSellOffer(ctx, task)
    case 'removeSold':
      return removeSold(ctx, task)
    case 'saleCost':
      return saleCost(ctx, task)
    case 'replaceSeller':
      return replaceSeller(ctx, task)
    case 'freeCubes':
      return freeCubes(ctx, task)
    case 'startCompetition':
      return startCompetition(ctx)
    case 'income':
      return income(ctx, task.playerId)
    case 'competitionNext':
      return competitionNext(ctx)
    case 'competitionCleanup':
      return competitionCleanup(ctx)
    case 'startLobbying':
      return startLobbying(ctx)
    case 'lobbyNext':
      return lobbyNext(ctx)
    case 'startEarnings':
      return startEarnings(ctx)
    case 'crisisApply':
      return crisisApply(ctx, task)
    case 'payoff':
      return payoff(ctx)
    case 'interest':
      return interest(ctx)
    case 'repayment':
      return repayment(ctx, task.stage)
    case 'endGame':
      return endGame(ctx)
    default: {
      const exhaustive: never = task
      throw new Error(`Unknown task: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** R-TURN-02: at the end of every phase all executives return — defenders, parked and killed ones included. */
function endPhase(ctx: Ctx): void {
  for (const id of ctx.g.seatOrder) {
    const p = ctx.g.players[id]
    p.executives = isEliminated(ctx, id) ? 0 : p.executiveCount
    p.parkedExecutives = 0
  }
  for (const country of Object.values(ctx.g.countries)) country.defenders = {}
}

/** Who owes the game a decision right now. */
export function pendingFor(prompt: Prompt | null, eliminated: (id: PlayerId) => boolean): PlayerId[] {
  if (!prompt) return []
  switch (prompt.kind) {
    case 'auction':
      return [prompt.current]
    case 'sealedAuction':
      return Object.keys(prompt.bids).filter((id) => !prompt.submitted.includes(id) && !eliminated(id))
    case 'repayment':
      return prompt.waiting.filter((id) => !eliminated(id))
    default:
      return [prompt.playerId]
  }
}

/** Copies the working state back into a GameState, with the envelope derived from it. */
export function finish(ctx: Ctx): GameState {
  const g = ctx.g
  const ended = g.phase === 'ended'
  const pending = ended ? [] : pendingFor(g.prompt, (id) => isEliminated(ctx, id))
  const base: GameState = {
    ...ctx.state,
    game: g,
    turn: g.round,
    phase: ended ? null : g.phase,
    pendingPlayerIds: pending,
    activePlayerId: pending.length === 1 && g.prompt?.kind !== 'sealedAuction' && g.prompt?.kind !== 'repayment' ? pending[0] : null,
  }
  if (!ended) return base
  const seats = activeSeats(ctx)
  const best = Math.max(...seats.map((id) => g.players[id].cash ?? 0))
  return { ...base, status: 'completed', winnerPlayerIds: seats.filter((id) => (g.players[id].cash ?? 0) === best) }
}

/** R-SET-01..10: builds genesis and runs it up to the first decision. */
export function setupGame(lobby: LobbyState<GameOptions>, random: Random): GameState {
  const state = initialState(lobby, random)
  const ctx: Ctx = { state, options: lobby.options, random, g: state.game }
  run(ctx)
  return finish(ctx)
}

/** The set-up table before turn 1 starts (R-SET-01..10). */
export function initialState(lobby: LobbyState<GameOptions>, random: Random): GameState {
  const options = lobby.options
  const count = lobby.players.length
  const countKey = `${count}p` as PlayerCountKey

  // R-SET-08/09: corporations at random ([AMBIG-5]: no auction), play order by corporation.
  const corps = random.shuffle(CORPORATIONS).slice(0, count)
  const corpOf = new Map(lobby.players.map((p, i) => [p.id, corps[i]]))
  const seatOrder = [...lobby.players.map((p) => p.id)].sort((a, b) => (corpOf.get(a)?.turnOrder ?? 0) - (corpOf.get(b)?.turnOrder ?? 0))

  // R-SET-04/05.
  const outlook = random.shuffle(OUTLOOK_CARDS.map((c) => c.id))
  const outlookCount = options.threeRounds ? AMBIGUITY_DEFAULTS.threeRoundsOutlookCards : 4
  const payoffDeck = random.shuffle(INDUSTRIES.flatMap((industry): Industry[] => Array.from({ length: PAYOFF_CARDS_PER_INDUSTRY }, () => industry)))

  // The board, with R-SET-06's locks.
  const countries: Record<string, CountryState> = {}
  for (const id of ALL_COUNTRY_IDS) {
    const def = countryDef(id)
    countries[id] = { affiliation: def.startAffiliation, squares: def.squares.map(() => ({ occupant: null, fortified: false })), loose: {}, defenders: {} }
  }
  for (const { country, count: locks } of SETUP_LOCKS) {
    const squares = countries[country].squares
    for (let i = squares.length - locks; i < squares.length; i++) squares[i].occupant = 'LOCK'
  }
  const battlegrounds = Object.fromEntries(ZONES.map((zone) => [zone, ALL_COUNTRY_IDS.find((id) => countryDef(id).zone === zone && countries[id].affiliation === 'BATTLEGROUND') ?? null])) as Record<ZoneId, string | null>

  // R-SET-07/10: the bank, then each corporation's starting shares, cubes and cash.
  const bank: Record<string, number> = { ...INVESTMENT_CARDS }
  const players: Record<PlayerId, CorpPlayer> = {}
  for (const id of seatOrder) {
    const corp = corpOf.get(id)!
    const setup = corp.setup[countKey]
    // R-SET-02, [AMBIG-3].
    const executives = EXECUTIVES_BY_PLAYER_COUNT[count] + (corp.id === 'OLD_MONEY' && AMBIGUITY_DEFAULTS.oldMoneyExtraExecutiveAt.includes(count) ? 1 : 0)
    const shares: Record<string, number> = Object.fromEntries(MAJOR_COUNTRIES.map((c) => [c, 0]))
    for (const [country, n] of Object.entries(setup.shares)) {
      shares[country] += n
      bank[country] -= n
    }
    let supply = corp.cubes
    for (const cube of setup.cubes) {
      const def = countryDef(cube.country)
      const square = def.squares.findIndex((industry, i) => industry === cube.industry && countries[cube.country].squares[i].occupant === null)
      if (square < 0) throw new Error(`No free ${cube.industry} square in ${def.name} for ${corp.name}'s setup`)
      countries[cube.country].squares[square].occupant = id
      supply -= 1
    }
    players[id] = { corp: corp.id, cash: setup.cash, bonds: 0, shares, supply, executives, executiveCount: executives, parkedExecutives: 0, abilitiesUsed: {} }
  }

  const game: GameData = {
    round: 0,
    totalRounds: outlookCount,
    phase: 'outlook',
    // R-SET-01.
    sliders: { growth: growthIndexOf(2), interest: 0, stress: 1, bop: options.threeRounds ? 2 : 3 },
    seatOrder,
    players,
    countries,
    battlegrounds,
    // R-SET-03.
    rdSquare: options.accumRd ? null : { ...RD_START },
    bank,
    retiredMajors: [],
    outlookDeck: outlook.slice(0, outlookCount),
    outlookOut: outlook.slice(outlookCount),
    outlookPlayed: [],
    payoffDeck,
    payoffDiscard: [],
    revealed: [],
    lobbyUsed: {},
    passed: [],
    cursor: null,
    deferredPlayerId: null,
    lobbyFirstPlayerId: null,
    queue: [{ t: 'startRound' }],
    prompt: null,
    nextPromptId: 1,
    crisisOccurred: false,
    lastPowerPlay: null,
    lastCrisis: null,
    lastEarnings: null,
    finalScores: null,
    journal: [],
  }
  return { ...lobby, status: 'active', turnOrder: seatOrder, game }
}

/** The phase a GameState.phase label names, for describePhase. */
export const PHASE_LABELS: Record<Exclude<PhaseId, 'ended'>, string> = {
  outlook: 'Global Outlook',
  investment: 'Investment',
  competition: 'Competition',
  lobbying: 'Lobbying',
  earnings: 'Earnings',
}
