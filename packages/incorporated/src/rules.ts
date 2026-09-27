// Rules for Incorporated (RULES.md is the source of truth; its rule ids are
// cited throughout) — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// How it's organised: ./engine.ts runs the phase machine as a queue of tasks
// that stops whenever the game needs a decision (`GameData.prompt`); each
// phase lives in its own module (./outlook.ts, ./investment.ts,
// ./competition.ts, ./lobbying.ts, ./earnings.ts). Board, corporation and
// Outlook card content is data (./data/), never named in logic.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, LoggedAction } from '@game-platform/sdk'
import { onAllocateIncome, onCompetitionPass, onDefend, onExpand, onFight } from './competition.ts'
import { displayName, fail, isEliminated, note, RuleError, type Ctx, type GameState } from './context.ts'
import { onCrisisDecision, onCrisisDiscard, onRepay, settleRepayments } from './earnings.ts'
import { finish, pendingFor, PHASE_LABELS, run, setupGame } from './engine.ts'
import {
  onBid,
  onChooseSquare,
  onClosedSell,
  onFreeAttack,
  onInvestPass,
  onPassBid,
  onPickWinner,
  onRemoveCubes,
  onSealedBid,
  onStartAuction,
  onStartPrivateSale,
  revealSealed,
} from './investment.ts'
import { takeLoan } from './loans.ts'
import { onDeferExecutive, onLobby, onMoveMarker, onStimulusKeep, onSubsidiesSwap, onUseLobbyFirst } from './lobbying.ts'
import { onOutlookChoice, onPickOutlook, onTakeUnlocked, onUseOutlookAbility } from './outlook.ts'
import type { GameAction, GameData, GameOptions, PlayerId, Prompt, R3SalesMode } from './types.ts'

export type * from './types.ts'
export type { GameState } from './context.ts'
export { AMBIGUITY_DEFAULTS } from './ambiguities.ts'
export { COUNTRIES, INDUSTRIES, TAX_HAVENS, TOTAL_BONDS, ZONES, ZONE_NAMES } from './data/board.ts'
export { PHASE_LABELS } from './engine.ts'
export { CORPORATIONS } from './data/corporations.ts'
export { OUTLOOK_CARDS } from './data/outlookCards.ts'
export { arrowExists, countryDef, countryName, industrySquares, marketLeader, moveAllowed, squareWeight } from './board.ts'
export { borrowingCapacity, bondsOutstanding, loanProceeds } from './loans.ts'
export { eventAvailable, eventKey } from './lobbying.ts'
export { GROWTH_TRACK, INTEREST_TRACK, growthPercent, interestValue, payoffsToReveal } from './sliders.ts'

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  threeRounds: false,
  freeCubes: false,
  r3SalesMode: 'normal',
  r3FreeCubesOne: false,
  dontStall: false,
  lessCruelLoans: false,
  accumRd: false,
  closedAuctionSco: false,
  qeHyperinflation: false,
  factionTweaks: false,
}

/** The designer's recommended preset (§11): THREE_ROUNDS and FREE_CUBES together. */
export const DESIGNERS_RECOMMENDED: GameOptions = { ...DEFAULT_GAME_OPTIONS, threeRounds: true, freeCubes: true }

const R3_SALES_MODES: readonly R3SalesMode[] = ['normal', 'reverseOnly', 'banned']

/** Fills in possibly-missing options; FREE_CUBES needs THREE_ROUNDS ([AMBIG-16]). */
export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const flag = (key: keyof GameOptions) => o[key] === true
  const threeRounds = flag('threeRounds')
  return {
    threeRounds,
    freeCubes: threeRounds && flag('freeCubes'),
    r3SalesMode: R3_SALES_MODES.includes(o.r3SalesMode as R3SalesMode) ? (o.r3SalesMode as R3SalesMode) : 'normal',
    r3FreeCubesOne: flag('r3FreeCubesOne'),
    dontStall: flag('dontStall'),
    lessCruelLoans: flag('lessCruelLoans'),
    accumRd: flag('accumRd'),
    closedAuctionSco: flag('closedAuctionSco'),
    qeHyperinflation: flag('qeHyperinflation'),
    factionTweaks: flag('factionTweaks'),
  }
}

/** Display names of the §11 flags, for the options editor and listings. */
export const OPTION_LABELS: Record<Exclude<keyof GameOptions, 'r3SalesMode'>, string> = {
  threeRounds: 'Three rounds',
  freeCubes: 'Free cubes',
  r3FreeCubesOne: 'Round-3 free cubes cut to 1',
  dontStall: "Don't stall",
  lessCruelLoans: 'Less cruel loans',
  accumRd: 'Accumulating R&D',
  closedAuctionSco: 'Closed auctions for SCO',
  qeHyperinflation: 'QE / hyperinflation',
  factionTweaks: 'Faction tweaks',
}

export function describeGameOptions(options: GameOptions): string {
  const on = (Object.keys(OPTION_LABELS) as (keyof typeof OPTION_LABELS)[]).filter((key) => options[key]).map((key) => OPTION_LABELS[key])
  if (options.r3SalesMode !== 'normal') on.push(options.r3SalesMode === 'banned' ? 'No final-round sales' : 'Final round: reverse sales only')
  return on.length === 0 ? 'Base rules · 4 rounds' : on.join(' · ')
}

/** R-LOAN-01: voluntary loans at any time during phases 2 and 3. */
function onTakeLoan(ctx: Ctx, playerId: PlayerId): void {
  if (ctx.g.phase !== 'investment' && ctx.g.phase !== 'competition') fail('Loans can only be taken during Investment and Competition.')
  takeLoan(ctx, playerId)
  note(ctx, `${displayName(ctx, playerId)} takes a loan.`)
}

function dispatch(ctx: Ctx, action: GameAction): void {
  switch (action.type) {
    case 'TAKE_LOAN':
      return onTakeLoan(ctx, action.playerId)
    case 'START_AUCTION':
      return onStartAuction(ctx, action)
    case 'START_PRIVATE_SALE':
      return onStartPrivateSale(ctx, action)
    case 'INVEST_PASS':
      return onInvestPass(ctx, action)
    case 'BID':
      return onBid(ctx, action)
    case 'PASS_BID':
      return onPassBid(ctx, action)
    case 'SEALED_BID':
      return onSealedBid(ctx, action)
    case 'PICK_WINNER':
      return onPickWinner(ctx, action)
    case 'CLOSED_SELL':
      return onClosedSell(ctx, action)
    case 'CHOOSE_SQUARE':
      return ctx.g.prompt?.kind === 'chooseSquare' && ctx.g.prompt.reason === 'takeUnlocked' ? onTakeUnlocked(ctx, action) : onChooseSquare(ctx, action)
    case 'REMOVE_CUBES':
      return onRemoveCubes(ctx, action)
    case 'FREE_ATTACK':
      return onFreeAttack(ctx, action)
    case 'ALLOCATE_INCOME':
      return onAllocateIncome(ctx, action)
    case 'FIGHT':
      return onFight(ctx, action)
    case 'DEFEND':
      return onDefend(ctx, action)
    case 'EXPAND':
      return onExpand(ctx, action)
    case 'COMPETITION_PASS':
      return onCompetitionPass(ctx, action)
    case 'LOBBY':
      return onLobby(ctx, action)
    case 'DEFER_EXECUTIVE':
      return onDeferExecutive(ctx, action)
    case 'MOVE_MARKER':
      return onMoveMarker(ctx, action)
    case 'SUBSIDIES_SWAP':
      return onSubsidiesSwap(ctx, action)
    case 'STIMULUS_KEEP':
      return onStimulusKeep(ctx, action)
    case 'OUTLOOK_CHOICE':
      return onOutlookChoice(ctx, action)
    case 'USE_ABILITY':
      return ctx.g.prompt?.kind === 'useAbility' && ctx.g.prompt.ability === 'omLobbyFirst' ? onUseLobbyFirst(ctx, action) : onUseOutlookAbility(ctx, action)
    case 'PICK_OUTLOOK':
      return onPickOutlook(ctx, action)
    case 'CRISIS_DECISION':
      return onCrisisDecision(ctx, action)
    case 'CRISIS_DISCARD':
      return onCrisisDiscard(ctx, action)
    case 'REPAY':
      return onRepay(ctx, action)
    default: {
      const exhaustive: never = action
      fail(`Unknown action: ${(exhaustive as { type?: string }).type}`)
    }
  }
}

/** A deep copy of the game slice to work on — it's plain JSON. */
function workingCopy(game: GameData): GameData {
  return { ...(JSON.parse(JSON.stringify(game)) as GameData), journal: [] }
}

function contextFor(state: GameState, random: Parameters<GameDefinition['applyAction']>[2]): Ctx {
  return { state, options: state.options, random, g: workingCopy(state.game) }
}

/** The move an eliminated player's pending decision defaults to: pass, decline, or the first option. */
function defaultAction(ctx: Ctx, prompt: Prompt, playerId: PlayerId): GameAction | null {
  switch (prompt.kind) {
    case 'investTurn':
    case 'lobbyTurn':
    case 'income':
      return null
    case 'competitionTurn':
      return { type: 'COMPETITION_PASS', playerId, defenders: [] }
    case 'auction':
      return { type: 'PASS_BID', playerId }
    case 'sealedTie':
      return { type: 'PICK_WINNER', playerId, winnerId: prompt.tied[0] }
    case 'closedSell':
      return { type: 'CLOSED_SELL', playerId, sell: false }
    case 'chooseSquare':
      return { type: 'CHOOSE_SQUARE', playerId, square: prompt.optional ? null : prompt.options[0] }
    case 'removeCubes':
      return { type: 'REMOVE_CUBES', playerId, cubes: prompt.options.slice(0, prompt.count) }
    case 'freeAttack':
      return { type: 'FREE_ATTACK', playerId, attacks: [] }
    case 'moveMarker':
      return { type: 'MOVE_MARKER', playerId, country: prompt.options[0] }
    case 'subsidies':
      return { type: 'SUBSIDIES_SWAP', playerId, peekIndex: 0, revealedIndex: 0 }
    case 'stimulus':
      return { type: 'STIMULUS_KEEP', playerId, index: 0 }
    case 'outlookChoice':
      return { type: 'OUTLOOK_CHOICE', playerId, choice: prompt.options[0] }
    case 'useAbility':
      return { type: 'USE_ABILITY', playerId, use: false }
    case 'pickOutlook':
      return { type: 'PICK_OUTLOOK', playerId, index: 0 }
    case 'crisisDecision':
      return { type: 'CRISIS_DECISION', playerId, decision: 'accept' }
    case 'crisisDiscard':
      return { type: 'CRISIS_DISCARD', playerId, indices: Array.from({ length: prompt.count }, (_, i) => i) }
    case 'sealedAuction':
    case 'repayment':
      return null
  }
  void ctx
}

/**
 * After a concession: every decision the leaver owed is made for them —
 * passing, declining, or taking the first option — until the game waits on
 * someone still playing.
 */
function settleForEliminated(ctx: Ctx): void {
  for (let i = 0; i < 1000; i++) {
    run(ctx)
    const g = ctx.g
    const prompt = g.prompt
    if (!prompt || g.phase === 'ended') return
    if (prompt.kind === 'sealedAuction') {
      if (pendingFor(prompt, (id) => isEliminated(ctx, id)).length > 0) return
      revealSealed(ctx)
      continue
    }
    if (prompt.kind === 'repayment') {
      prompt.waiting = prompt.waiting.filter((id) => !isEliminated(ctx, id))
      for (const id of Object.keys(prompt.decisions)) if (isEliminated(ctx, id) && prompt.decisions[id] === null) delete prompt.decisions[id]
      if (prompt.waiting.length > 0) return
      settleRepayments(ctx)
      continue
    }
    const stuck = pendingFor(prompt, () => false).find((id) => isEliminated(ctx, id))
    if (!stuck) return
    const action = defaultAction(ctx, prompt, stuck)
    if (action) {
      dispatch(ctx, action)
      continue
    }
    g.prompt = null
    if (prompt.kind === 'investTurn') g.queue.unshift({ t: 'investmentNext' })
    if (prompt.kind === 'lobbyTurn') {
      if (g.lobbyFirstPlayerId === stuck) g.lobbyFirstPlayerId = null
      if (g.deferredPlayerId === stuck) g.deferredPlayerId = null
      g.queue.unshift({ t: 'lobbyNext' })
    }
  }
  throw new Error('Could not settle the game after a player left.')
}

function headline(action: GameAction): string {
  switch (action.type) {
    case 'SEALED_BID':
      return `{player} submits a sealed bid of $${action.amount}.`
    case 'REPAY':
      return `{player} will repay ${action.count} bond(s).`
    case 'CHOOSE_SQUARE':
      return action.square === null ? '{player} declines the square.' : '{player} chooses a square.'
    case 'FREE_ATTACK':
      return '{player} makes no attack.'
    case 'ALLOCATE_INCOME':
      return '{player} places their income cubes.'
    case 'USE_ABILITY':
      return action.use ? '{player} uses their ability.' : '{player} declines their ability.'
    default:
      return '{player} acts.'
  }
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'incorporated',
  rulesVersion: 1,
  title: 'Incorporated',
  turnLabel: 'Turn',
  minPlayers: 2,
  maxPlayers: 4,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions: describeGameOptions,

  setup(lobby, random) {
    return setupGame(lobby, random)
  },

  applyAction(state, action, random): ActionResult<GameState> {
    const player = state.players.find((p) => p.id === action.playerId)
    if (!player || !(action.playerId in state.game.players)) return { ok: false, error: `Unknown player: ${action.playerId}` }
    if (player.eliminated) return { ok: false, error: 'You are no longer in this game.' }
    if (state.game.phase === 'ended') return { ok: false, error: 'The game is over.' }
    const ctx = contextFor(state, random)
    try {
      dispatch(ctx, action)
      run(ctx)
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, error: error.message }
      throw error
    }
    return { ok: true, state: finish(ctx) }
  },

  onPlayerEliminated(state, playerId, random) {
    const ctx = contextFor(state, random)
    const p = ctx.g.players[playerId]
    if (p) p.executives = 0
    if (!ctx.g.passed.includes(playerId)) ctx.g.passed.push(playerId)
    note(ctx, `${displayName(ctx, playerId)} leaves the game.`)
    settleForEliminated(ctx)
    return finish(ctx)
  },

  nextForcedAction() {
    return null
  },

  redactGame(state, viewerId) {
    if (state.status !== 'active') return state.game
    const g = state.game
    const bigBrother = g.seatOrder.find((id) => g.players[id].corp === 'BIG_BROTHER' && !state.players.find((p) => p.id === id)?.eliminated)
    const chooser = bigBrother ?? g.seatOrder.find((id) => !state.players.find((p) => p.id === id)?.eliminated) ?? null
    const hide = <T>(items: T[]) => items.map(() => null)
    return {
      ...g,
      // §1.1: cash is private.
      players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, id === viewerId ? p : { ...p, cash: null }])),
      payoffDeck: hide(g.payoffDeck),
      // R-GEN-01: the discard pile may not be inspected.
      payoffDiscard: hide(g.payoffDiscard),
      // R-EARN-07 / [AMBIG-23]: only the Outlook chooser sees the top card.
      outlookDeck: g.outlookDeck.map((card, i) => (i === 0 && viewerId !== null && viewerId === chooser ? card : null)),
      outlookOut: hide(g.outlookOut),
      prompt: redactPrompt(g.prompt, viewerId),
    }
  },

  isActionSecret(entry: LoggedAction, state, viewerId) {
    const action = entry.action as GameAction
    const prompt = state.game.prompt
    if (state.status !== 'active' || action.playerId === viewerId) return false
    if (action.type === 'SEALED_BID') return prompt?.kind === 'sealedAuction' && prompt.auctionId === action.auctionId
    if (action.type === 'REPAY') return prompt?.kind === 'repayment' && prompt.promptId === action.promptId
    return false
  },

  describeAction(action, _before, after): ActionDescription {
    const lines = after.game.journal
    if (action.type === 'SEALED_BID') return { message: [headline(action), ...lines].join(' '), redactedMessage: '{player} submits a sealed bid.' }
    if (action.type === 'REPAY') return { message: [headline(action), ...lines].join(' '), redactedMessage: '{player} decides on repayments.' }
    return { message: lines.length > 0 ? lines.join(' ') : headline(action) }
  },

  describePhase(phase) {
    return phase && phase in PHASE_LABELS ? PHASE_LABELS[phase as keyof typeof PHASE_LABELS] : 'In progress'
  },
}

function redactPrompt(prompt: Prompt | null, viewerId: PlayerId | null): Prompt | null {
  if (!prompt) return prompt
  const mine = 'playerId' in prompt && prompt.playerId === viewerId
  switch (prompt.kind) {
    case 'subsidies':
      return mine ? prompt : { ...prompt, peek: prompt.peek.map(() => null) }
    case 'stimulus':
      return mine ? prompt : { ...prompt, drawn: prompt.drawn.map(() => null) }
    case 'pickOutlook':
      return mine ? prompt : { ...prompt, drawn: prompt.drawn.map(() => null) }
    case 'sealedAuction':
      return { ...prompt, bids: Object.fromEntries(Object.entries(prompt.bids).map(([id, bid]) => [id, id === viewerId ? bid : null])) }
    case 'repayment':
      return { ...prompt, decisions: Object.fromEntries(Object.entries(prompt.decisions).map(([id, n]) => [id, id === viewerId ? n : null])) }
    default:
      return prompt
  }
}
