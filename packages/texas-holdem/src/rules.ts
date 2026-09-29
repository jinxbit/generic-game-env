// Rules for Texas Hold'em (RULES.md is the source of truth; its rule ids are
// cited throughout) — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// How it's organised: ./cards.ts holds everything that's a pure function of
// cards and chips (the deck, hand ranking, side pots); this module runs the
// tournament — deal, bet street by street, settle, bust, next hand — on
// `GameData`, from which the envelope's `phase`, `activePlayerId`,
// `pendingPlayerIds`, `turn` and the busted players' `eliminated` flags are
// always derived (`withEnvelope`), so they can never go stale.
//
// One submitted action runs until someone must decide again: a call that
// closes a street deals the next one, an all-in with nobody left to bet runs
// the board out, and a hand that ends settles and deals the next hand, all in
// the same action (RULES.md AMBIG-3). So there's never a forced follow-up.
//
// Hidden information: a player's hole cards are theirs alone (R-HAND-01), so
// `redactGame` masks everyone else's. Cards are drawn from the framework's
// `Random` at the moment they're dealt, from the cards the hand hasn't dealt
// yet (AMBIG-1) — no deck order is ever stored, so there is no undealt card
// to hide. A redacted viewer never receives the numbers an entry drew
// (packages/sdk/src/redaction.ts), and nothing an action or its narration
// says is secret — hole cards are only ever named once shown at a showdown —
// so `isActionSecret` is always false.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, GameState as PlatformGameState, LobbyState, Random } from '@game-platform/sdk'
import { bestHand, buildPots, cardsLabel, compareScores, formatChips, FULL_DECK, handName, type BestHand } from './cards.ts'
import type { Card, GameAction, GameData, GameOptions, PlayerData, PlayerId, PotResult, ShownHand, Step, Street } from './types.ts'

export type * from './types.ts'
export * from './cards.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export const DEFAULT_GAME_OPTIONS: GameOptions = { startingStack: 1000, bigBlind: 20, blindsDoubleEvery: 10, maxHands: 0 }

/** Bounds the options editor offers and normalizeGameOptions clamps to (RULES.md §8). */
export const OPTION_RANGES: Record<keyof GameOptions, { min: number; max: number }> = {
  startingStack: { min: 100, max: 1_000_000 },
  bigBlind: { min: 2, max: 100_000 },
  blindsDoubleEvery: { min: 0, max: 100 },
  maxHands: { min: 0, max: 1000 },
}

export const STEP_LABELS: Record<Step, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  ended: 'Game over',
}

const NEXT_STREET: Record<Exclude<Street, 'river'>, Street> = { preflop: 'flop', flop: 'turn', turn: 'river' }

function clampInt(value: unknown, fallback: number, range: { min: number; max: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.max(range.min, Math.min(range.max, n))
}

/** Fills in and clamps possibly-missing/out-of-range options from a stored settings row. */
export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bigBlind = clampInt(o.bigBlind, DEFAULT_GAME_OPTIONS.bigBlind, OPTION_RANGES.bigBlind)
  return {
    startingStack: clampInt(o.startingStack, DEFAULT_GAME_OPTIONS.startingStack, OPTION_RANGES.startingStack),
    // Even, so the small blind is exactly half (R-BLIND-01).
    bigBlind: bigBlind % 2 === 0 ? bigBlind : bigBlind + 1,
    blindsDoubleEvery: clampInt(o.blindsDoubleEvery, DEFAULT_GAME_OPTIONS.blindsDoubleEvery, OPTION_RANGES.blindsDoubleEvery),
    maxHands: clampInt(o.maxHands, DEFAULT_GAME_OPTIONS.maxHands, OPTION_RANGES.maxHands),
  }
}

/** R-BLIND-01: the blinds of hand `hand`. */
export function blindsFor(options: GameOptions, hand: number): { small: number; big: number } {
  const level = options.blindsDoubleEvery > 0 ? Math.floor((Math.max(1, hand) - 1) / options.blindsDoubleEvery) : 0
  const big = options.bigBlind * 2 ** level
  return { small: Math.floor(big / 2), big }
}

// ---------------------------------------------------------------------------
// Read-only helpers — used by the rules, the view and the tests.

/** Seat order starting after `fromId`, wrapping round, ending with `fromId` itself. */
export function seatsAfter(game: GameData, fromId: PlayerId): PlayerId[] {
  const seats = game.seatOrder
  const start = seats.indexOf(fromId)
  return seats.map((_, k) => seats[(start + 1 + k) % seats.length])
}

/** Everyone still contesting the hand, in seat order. */
export function contendersOf(game: GameData): PlayerId[] {
  return game.seatOrder.filter((id) => game.players[id].status === 'in')
}

/** Every chip bet this hand, on every street. */
export function potTotal(game: GameData): number {
  return game.seatOrder.reduce((total, id) => total + game.players[id].contributed, 0)
}

/** Whether anyone else still in the hand has chips left to bet with. */
function othersCanBet(game: GameData, playerId: PlayerId): boolean {
  return contendersOf(game).some((id) => id !== playerId && game.players[id].stack > 0)
}

/**
 * What `playerId` must put in to stay in the hand (capped by their stack).
 * Normally up to the current bet — pre-flop that's the full big blind even
 * when the big blind posted less (R-BET-05) — but when nobody else could bet
 * any more, only up to what the others actually put in.
 */
export function amountToCall(game: GameData, playerId: PlayerId): number {
  const p = game.players[playerId]
  let target = game.currentBet
  if (!othersCanBet(game, playerId)) {
    const others = contendersOf(game).filter((id) => id !== playerId)
    target = Math.min(target, Math.max(0, ...others.map((id) => game.players[id].committed)))
  }
  return Math.max(0, Math.min(p.stack, target - p.committed))
}

/** R-BET-06 / R-HAND-05: whether `playerId` still owes a decision on this street. */
export function needsToAct(game: GameData, playerId: PlayerId): boolean {
  const p = game.players[playerId]
  if (p.status !== 'in' || p.stack === 0) return false
  // Nobody could answer a raise (R-BET-07): act only if there's something to call.
  if (!othersCanBet(game, playerId)) return amountToCall(game, playerId) > 0
  return p.actedAt === null || p.committed < game.currentBet
}

/** R-BET-04 / R-BET-07: whether `playerId` may bet or raise right now. */
export function canRaise(game: GameData, playerId: PlayerId): boolean {
  const p = game.players[playerId]
  if (!needsToAct(game, playerId) || !othersCanBet(game, playerId)) return false
  if (p.actedAt !== null && p.actedAt >= game.lastFullBet) return false
  return p.stack > amountToCall(game, playerId)
}

/** R-BET-03: the smallest total `playerId` may bet or raise to (all in, if that's less). */
export function minRaiseTo(game: GameData, playerId: PlayerId): number {
  return Math.min(game.currentBet + game.minRaise, maxRaiseTo(game, playerId))
}

/** R-BET-02: everything they have. */
export function maxRaiseTo(game: GameData, playerId: PlayerId): number {
  const p = game.players[playerId]
  return p.committed + p.stack
}

// ---------------------------------------------------------------------------
// The engine. Every handler works on a deep copy of `game` (made once per
// action in `apply`), so it may mutate it freely; `state` is never touched.

class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message)
}

function cloneGame(game: GameData): GameData {
  return JSON.parse(JSON.stringify(game)) as GameData
}

function isOut(state: GameState, game: GameData, playerId: PlayerId): boolean {
  const player = state.players.find((p) => p.id === playerId)
  return !player || player.eliminated || game.players[playerId].bustedInHand !== null
}

function nameOf(state: GameState, playerId: PlayerId): string {
  return state.players.find((p) => p.id === playerId)?.displayName ?? 'Someone'
}

function namesOf(state: GameState, ids: readonly PlayerId[]): string {
  const names = ids.map((id) => nameOf(state, id))
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Moves chips from a stack into the hand. */
function commit(p: PlayerData, amount: number): void {
  p.stack -= amount
  p.committed += amount
  p.contributed += amount
}

/** AMBIG-1: one card at random from those the hand hasn't dealt. */
function drawCard(game: GameData, random: Random): Card {
  const used = new Set<Card>(game.board)
  for (const id of game.seatOrder) for (const card of game.players[id].hole) if (card) used.add(card)
  const remaining = FULL_DECK.filter((card) => !used.has(card))
  return remaining[random.int(0, remaining.length - 1)]
}

/** R-END-02/03. */
function finish(game: GameData, reason: 'lastStanding' | 'handLimit'): void {
  game.step = 'ended'
  game.toActId = null
  game.endReason = reason
  game.currentBet = 0
}

/**
 * Deals the next hand (R-BLIND-01..04, R-HAND-01): moves the button, posts
 * the blinds and deals two cards to everyone with chips — or ends the game
 * (R-END-02/03). Returns whether a hand was dealt.
 */
function startHand(state: GameState, game: GameData, random: Random): boolean {
  const participants = game.seatOrder.filter((id) => !isOut(state, game, id) && game.players[id].stack > 0)
  const hand = game.hand + 1
  if (participants.length < 2) {
    finish(game, 'lastStanding')
    return false
  }
  if (state.options.maxHands > 0 && hand > state.options.maxHands) {
    finish(game, 'handLimit')
    return false
  }
  const dealtIn = (id: PlayerId) => participants.includes(id)
  const nextIn = (id: PlayerId) => seatsAfter(game, id).find(dealtIn)!
  const previousBig = game.blinds.big
  game.hand = hand
  game.blinds = blindsFor(state.options, hand)
  // R-SETUP-03 / R-BLIND-04 (AMBIG-2).
  const button = game.buttonId === null ? participants[0] : nextIn(game.buttonId)
  // R-BLIND-02: heads-up, the button posts the small blind.
  const small = participants.length === 2 ? button : nextIn(button)
  const big = nextIn(small)
  game.buttonId = button
  game.smallBlindId = small
  game.bigBlindId = big
  game.board = []
  for (const id of game.seatOrder) {
    const p = game.players[id]
    game.players[id] = { ...p, hole: [], status: dealtIn(id) ? 'in' : 'out', committed: 0, contributed: 0, actedAt: null }
  }
  const rose = hand > 1 && game.blinds.big !== previousBig ? ' (blinds up)' : ''
  game.journal.push(`Hand ${hand}: ${nameOf(state, button)} has the button; blinds ${formatChips(game.blinds.small)}/${formatChips(game.blinds.big)}${rose}.`)
  // R-BLIND-03: short stacks post what they have.
  for (const [id, blind] of [
    [small, game.blinds.small],
    [big, game.blinds.big],
  ] as const) {
    const p = game.players[id]
    commit(p, Math.min(p.stack, blind))
    if (p.stack === 0) game.journal.push(`${nameOf(state, id)} is all in posting the blind.`)
  }
  // Two cards each, one at a time, starting after the button.
  const order = seatsAfter(game, button).filter(dealtIn)
  for (let round = 0; round < 2; round++) for (const id of order) game.players[id].hole.push(drawCard(game, random))
  game.step = 'preflop'
  game.toActId = null
  // R-BET-03/05: pre-flop the big blind is the bet to match and the size of the last raise.
  game.currentBet = game.blinds.big
  game.minRaise = game.blinds.big
  game.lastFullBet = game.blinds.big
  return true
}

/** R-HAND-02: opens the next street, dealing its board cards. */
function dealStreet(game: GameData, random: Random): void {
  const street = NEXT_STREET[game.step as Exclude<Street, 'river'>]
  const dealt: Card[] = []
  for (let i = 0; i < (street === 'flop' ? 3 : 1); i++) {
    const card = drawCard(game, random)
    game.board.push(card)
    dealt.push(card)
  }
  game.step = street
  for (const id of game.seatOrder) {
    game.players[id].committed = 0
    game.players[id].actedAt = null
  }
  game.currentBet = 0
  game.minRaise = game.blinds.big
  game.lastFullBet = 0
  game.journal.push(street === 'flop' ? `Flop: ${cardsLabel(dealt)}.` : `${STEP_LABELS[street]}: ${cardsLabel(dealt)} (board ${cardsLabel(game.board)}).`)
}

/**
 * Ends the hand: returns an uncalled bet (R-POT-01), awards every pot to its
 * best hand — or the last player standing (R-HAND-04, R-POT-02/03,
 * R-SHOW-01) — and busts whoever ran out of chips (R-END-01).
 */
function settleHand(state: GameState, game: GameData): void {
  const dealt = game.seatOrder.filter((id) => game.players[id].status !== 'out')
  const contenders = contendersOf(game)
  const byContribution = [...dealt].sort((a, b) => game.players[b].contributed - game.players[a].contributed)
  let returned: { playerId: PlayerId; amount: number } | null = null
  // Only a contender can have bet more than anyone matched — unless the top
  // contributor left (R-LEAVE-01), whose chips then stay in as dead money.
  if (byContribution.length > 0 && contenders.includes(byContribution[0])) {
    const [top, second] = byContribution
    const excess = game.players[top].contributed - (second ? game.players[second].contributed : 0)
    if (excess > 0) {
      game.players[top].contributed -= excess
      game.players[top].stack += excess
      returned = { playerId: top, amount: excess }
      game.journal.push(`Uncalled ${formatChips(excess)} returned to ${nameOf(state, top)}.`)
    }
  }

  const showdown = contenders.length > 1
  const hands: Record<PlayerId, BestHand> = {}
  const shown: Record<PlayerId, ShownHand> = {}
  if (showdown) {
    for (const id of contenders) {
      const hole = game.players[id].hole as Card[]
      hands[id] = bestHand([...hole, ...game.board])
      shown[id] = { hole, best: hands[id].cards, handName: handName(hands[id].score) }
      game.journal.push(`${nameOf(state, id)} shows ${cardsLabel(hole)} — ${shown[id].handName}.`)
    }
  }

  const contributions = Object.fromEntries(dealt.map((id) => [id, game.players[id].contributed]))
  const pots = buildPots(contributions, contenders)
  // R-POT-03: odd chips go round from the seat after the button.
  const chipOrder = seatsAfter(game, game.buttonId!)
  const won: Record<PlayerId, number> = {}
  const results: PotResult[] = pots.map((pot, i) => {
    let winners = pot.eligible
    if (showdown) {
      const best = winners.reduce((a, b) => (compareScores(hands[b].score, hands[a].score) > 0 ? b : a))
      winners = winners.filter((id) => compareScores(hands[id].score, hands[best].score) === 0)
    }
    winners = chipOrder.filter((id) => winners.includes(id))
    const share = Math.floor(pot.amount / winners.length)
    const odd = pot.amount - share * winners.length
    winners.forEach((id, k) => {
      const amount = share + (k < odd ? 1 : 0)
      game.players[id].stack += amount
      won[id] = (won[id] ?? 0) + amount
    })
    const name = showdown ? shown[winners[0]].handName : null
    const label = pots.length === 1 ? 'the pot' : i === 0 ? 'the main pot' : `side pot ${i}`
    const verb = winners.length === 1 ? 'wins' : 'split'
    game.journal.push(`${namesOf(state, winners)} ${verb} ${label} (${formatChips(pot.amount)})${name ? ` with ${name}` : ''}.`)
    return { amount: pot.amount, eligible: pot.eligible, winners, handName: name }
  })

  const busted = dealt.filter((id) => game.players[id].stack === 0 && !isOut(state, game, id))
  for (const id of busted) {
    game.players[id].bustedInHand = game.hand
    game.journal.push(`${nameOf(state, id)} is out of chips.`)
  }
  for (const id of game.seatOrder) {
    game.players[id].committed = 0
    game.players[id].contributed = 0
  }
  game.lastHand = { hand: game.hand, board: [...game.board], showdown, shown, pots: results, won, returned, busted }
}

/** The first player, going round from `fromId` (after it, or from it when `inclusive`), who owes a decision. */
function nextToAct(game: GameData, fromId: PlayerId, inclusive: boolean): PlayerId | null {
  const order = seatsAfter(game, fromId)
  if (inclusive) order.unshift(order.pop()!)
  return order.find((id) => needsToAct(game, id)) ?? null
}

/**
 * Plays on from a decision until someone must decide again: the next player
 * to act, or else the next street, the showdown, the next hand — or the end.
 */
function run(state: GameState, game: GameData, random: Random, fromId: PlayerId, inclusive = false): void {
  let from = fromId
  let fromInclusive = inclusive
  for (;;) {
    if (game.step === 'ended') return
    const handOver = contendersOf(game).length <= 1
    const next = handOver ? null : nextToAct(game, from, fromInclusive)
    if (next) {
      game.toActId = next
      return
    }
    if (handOver || game.step === 'river') {
      settleHand(state, game)
      if (!startHand(state, game, random)) return
      // R-HAND-03: pre-flop, the player after the big blind.
      from = game.bigBlindId!
    } else {
      dealStreet(game, random)
      // R-HAND-03: after the flop, the first player after the button.
      from = game.buttonId!
    }
    fromInclusive = false
  }
}

/** Keeps the envelope in step with `game` — `pendingPlayerIds` and the busted players' `eliminated` are derived here and nowhere else. */
export function withEnvelope(state: GameState, game: GameData): GameState {
  const busted = new Set(game.seatOrder.filter((id) => game.players[id].bustedInHand !== null))
  const players = state.players.map((p) => (busted.has(p.id) && !p.eliminated ? { ...p, eliminated: true } : p))
  const base: GameState = { ...state, game, players, turnOrder: state.turnOrder.filter((id) => !busted.has(id)), turn: game.hand }
  if (game.step === 'ended') {
    const standing = game.seatOrder.filter((id) => !players.find((p) => p.id === id)?.eliminated)
    const most = Math.max(...standing.map((id) => game.players[id].stack))
    const winnerPlayerIds = standing.filter((id) => game.players[id].stack === most)
    return { ...base, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [], winnerPlayerIds }
  }
  return { ...base, phase: game.step, activePlayerId: game.toActId, pendingPlayerIds: game.toActId ? [game.toActId] : [] }
}

/** R-BET-02..04. */
function onBet(game: GameData, playerId: PlayerId, amount: unknown): void {
  const p = game.players[playerId]
  if (typeof amount !== 'number' || !Number.isInteger(amount)) fail('Bet a whole number of chips.')
  if (!canRaise(game, playerId)) {
    if (!othersCanBet(game, playerId)) fail('Everyone else is all in — call or fold.')
    if (p.stack <= amountToCall(game, playerId)) fail("You don't have enough chips to raise — call or fold.")
    fail('Only an all-in smaller than a full raise came since you acted, so you may only call or fold.')
  }
  const verb = game.currentBet === 0 ? 'bet' : 'raise'
  const max = maxRaiseTo(game, playerId)
  const min = game.currentBet + game.minRaise
  if (amount > max) fail(`You can ${verb} at most ${formatChips(max)} (all in).`)
  if (amount <= game.currentBet) fail(`${verb === 'bet' ? 'Bet' : 'Raise to'} more than ${formatChips(game.currentBet)}.`)
  if (amount < min && amount !== max) fail(`The smallest ${verb} is to ${formatChips(min)}, or all in for ${formatChips(max)}.`)
  commit(p, amount - p.committed)
  // R-BET-04: only a full raise reopens the betting.
  if (amount - game.currentBet >= game.minRaise) {
    game.minRaise = amount - game.currentBet
    game.lastFullBet = amount
  }
  game.currentBet = amount
}

function apply(state: GameState, action: GameAction, random: Random): GameState {
  const game = cloneGame(state.game)
  game.journal = []
  const actor = state.players.find((p) => p.id === action.playerId)
  if (!actor) fail(`Unknown player: ${action.playerId}`)
  if (actor.eliminated) fail('You are no longer in this game.')
  if (game.toActId !== action.playerId) fail("It isn't your turn.")
  const p = game.players[action.playerId]
  const toCall = amountToCall(game, action.playerId)
  switch (action.type) {
    case 'FOLD':
      // AMBIG-4.
      if (toCall === 0) fail('Nothing to call — check instead.')
      p.status = 'folded'
      break
    case 'CHECK':
      if (toCall > 0) fail(`${formatChips(toCall)} to call — call, raise or fold.`)
      break
    case 'CALL':
      if (toCall === 0) fail('Nothing to call — check instead.')
      commit(p, toCall)
      break
    case 'BET':
      onBet(game, action.playerId, action.amount)
      break
    default: {
      const unknown: never = action
      fail(`Unknown action: ${String((unknown as { type: unknown }).type)}`)
    }
  }
  p.actedAt = game.lastFullBet
  run(state, game, random, action.playerId)
  return withEnvelope(state, game)
}

function headline(action: GameAction, before: GameData): string {
  const p = before.players[action.playerId]
  switch (action.type) {
    case 'FOLD':
      return '{player} folds.'
    case 'CHECK':
      return '{player} checks.'
    case 'CALL': {
      const amount = amountToCall(before, action.playerId)
      return `{player} calls ${formatChips(amount)}${amount === p.stack ? ' and is all in' : ''}.`
    }
    case 'BET': {
      const allIn = action.amount - p.committed === p.stack ? ' and is all in' : ''
      return before.currentBet === 0 ? `{player} bets ${formatChips(action.amount)}${allIn}.` : `{player} raises to ${formatChips(action.amount)}${allIn}.`
    }
  }
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'texas-holdem',
  rulesVersion: 1,
  title: "Texas Hold'em",
  turnLabel: 'Hand',
  minPlayers: 2,
  maxPlayers: 9,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    const first = blindsFor(options, 1)
    const parts = [`${formatChips(options.startingStack)} chips`, `blinds ${formatChips(first.small)}/${formatChips(first.big)}`]
    parts.push(options.blindsDoubleEvery > 0 ? `doubling every ${options.blindsDoubleEvery} hands` : 'fixed')
    if (options.maxHands > 0) parts.push(`max ${options.maxHands} hands`)
    return parts.join(' · ')
  },

  setup(lobby: LobbyState<GameOptions>, random) {
    const seat = (): PlayerData => ({ stack: lobby.options.startingStack, hole: [], status: 'out', committed: 0, contributed: 0, actedAt: null, bustedInHand: null })
    const players: Record<PlayerId, PlayerData> = Object.fromEntries(lobby.turnOrder.map((id) => [id, seat()]))
    const game: GameData = {
      seatOrder: [...lobby.turnOrder],
      players,
      step: 'preflop',
      hand: 0,
      buttonId: null,
      smallBlindId: null,
      bigBlindId: null,
      blinds: blindsFor(lobby.options, 1),
      board: [],
      toActId: null,
      currentBet: 0,
      minRaise: 0,
      lastFullBet: 0,
      lastHand: null,
      journal: [],
      endReason: null,
    }
    const state = { ...lobby, status: 'active', turn: 1, game } as GameState
    if (startHand(state, game, random)) run(state, game, random, game.bigBlindId!)
    // Genesis has no log entry to narrate.
    game.journal = []
    return withEnvelope(state, game)
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
    // R-LEAVE-01: fold, and the rest of their chips leave the game. (When
    // the concession leaves one player, the framework ends the game itself
    // and never calls this — `game` then keeps the hand it stopped in.)
    const game = cloneGame(state.game)
    game.journal = []
    const p = game.players[playerId]
    if (p) {
      if (p.status === 'in') p.status = 'folded'
      p.stack = 0
    }
    // Whoever was to act still is, unless the leaver's going ended the street or the hand.
    const current = game.toActId
    if (current && current !== playerId) run(state, game, random, current, true)
    else run(state, game, random, playerId)
    return withEnvelope(state, game)
  },

  nextForcedAction() {
    // Every run-out and new hand happens inside the action that caused it.
    return null
  },

  redactGame(state, viewerId) {
    // R-HAND-01: only you see your hole cards. Showdown cards are in `lastHand`.
    const g = state.game
    const players = Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, id === viewerId ? p : { ...p, hole: p.hole.map(() => null) }]))
    return { ...g, players }
  },

  isActionSecret() {
    return false
  },

  describeAction(action, before, after): ActionDescription {
    return {
      message: headline(action, before.game),
      extraLines: after.game.journal.map((message) => ({ playerId: null, message })),
    }
  },

  describePhase(phase) {
    return phase && phase in STEP_LABELS ? STEP_LABELS[phase as Step] : 'In progress'
  },
}
