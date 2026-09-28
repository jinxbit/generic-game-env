// Rules for Shark (RULES.md is the source of truth; its rule ids are cited
// throughout) — this package's `rules` entry point, implementing the
// GameDefinition contract from @game-platform/sdk.
//
// How it's organised: ./board.ts holds everything that is a pure function of
// the board (zones, groups, prices, whether a placement is legal); this
// module runs the turn — trade, roll, place, forced sales, trade, end turn —
// as a small step machine on `GameData.step`, from which the envelope's
// `phase`, `activePlayerId` and `pendingPlayerIds` are always derived
// (`withEnvelope`), so they can never go stale.
//
// Nothing in Shark is secret: prices, cash, shares and the dice are all on
// the table, so `redactGame` hands back the whole game. The dice are the only
// randomness, drawn in ROLL from the framework's `Random`.
//
// Pure and deterministic, like everything the framework runs — imported by
// the Edge Functions too, so keep the `.ts` extensions on relative imports.

import type { ActionDescription, ActionResult, GameDefinition, GameState as PlatformGameState, LobbyState, Random } from '@game-platform/sdk'
import {
  cellLabel,
  COLOURS,
  ISOLATED_BONUS,
  legalPlacements,
  MARKERS_PER_COLOUR,
  MAX_BUY_PER_TURN,
  MAX_PRICE,
  previewPlacement,
  PRICE_UNIT,
  pricesOf,
  SHARES_PER_COLOUR,
  zoneOf,
} from './board.ts'
import type { Colour, ColourFace, GameAction, GameData, GameOptions, Payment, PlayerData, PlayerId, Step } from './types.ts'

export type * from './types.ts'
export * from './board.ts'

/** This game's GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

export const DEFAULT_GAME_OPTIONS: GameOptions = { startingCash: 0 }

/** Bounds the options editor offers and normalizeGameOptions clamps to. */
export const STARTING_CASH_RANGE = { min: 0, max: 50_000, step: 1000 }

/** RULES.md AMBIG-1: four colours and two white faces. */
export const COLOUR_DIE: readonly ColourFace[] = ['blue', 'green', 'red', 'yellow', 'white', 'white']

export const STEP_LABELS: Record<Step, string> = {
  preTrade: 'Trading, then rolling',
  place: 'Placing a marker',
  debts: 'Forced sales',
  postTrade: 'Trading, then ending the turn',
  ended: 'Game over',
}

export function normalizeGameOptions(raw: unknown): GameOptions {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const cash = typeof o.startingCash === 'number' && Number.isFinite(o.startingCash) ? o.startingCash : DEFAULT_GAME_OPTIONS.startingCash
  const stepped = Math.round(cash / STARTING_CASH_RANGE.step) * STARTING_CASH_RANGE.step
  return { startingCash: Math.max(STARTING_CASH_RANGE.min, Math.min(STARTING_CASH_RANGE.max, stepped)) }
}

/** "12 000 F.T." — formatted by hand so the text is identical in every runtime. */
export function formatFT(amount: number): string {
  const sign = amount < 0 ? '−' : ''
  return `${sign}${String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F.T.`
}

/** What one share of `colour` costs (or fetches) right now (R-SHARE-01). */
export function sharePrice(game: GameData, colour: Colour): number {
  return game.prices[colour] * PRICE_UNIT
}

/** What one share fetches in a forced sale (R-DEBT-01). */
export function forcedSalePrice(game: GameData, colour: Colour): number {
  return sharePrice(game, colour) / 2
}

/** R-END-02: cash plus every share at the current price. */
export function wealthOf(game: GameData, playerId: PlayerId): number {
  const p = game.players[playerId]
  if (!p) return 0
  return p.cash + COLOURS.reduce((total, colour) => total + p.shares[colour] * sharePrice(game, colour), 0)
}

/** The colours a roll lets the player place (R-TURN-02). */
export function rollColours(game: GameData, face: ColourFace): Colour[] {
  const colours = face === 'white' ? [...COLOURS] : [face]
  return colours.filter((colour) => game.supply[colour] > 0)
}

/** The legal placements for this turn's roll (R-PLACE-01..05). */
export function placementsForRoll(game: GameData): { cell: number; colour: Colour }[] {
  if (!game.roll) return []
  return legalPlacements(game.board, game.roll.zone, rollColours(game, game.roll.colour))
}

/** Whether `playerId` could buy at least one share right now (R-SHARE-02/03). */
export function canBuyAny(game: GameData, playerId: PlayerId): boolean {
  const p = game.players[playerId]
  if (!p || game.boughtThisTurn >= MAX_BUY_PER_TURN) return false
  return COLOURS.some((colour) => game.prices[colour] > 0 && game.bank[colour] > 0 && p.cash >= sharePrice(game, colour))
}

/** Whether `playerId` holds a share worth selling. */
export function canSellAny(game: GameData, playerId: PlayerId): boolean {
  const p = game.players[playerId]
  return !!p && COLOURS.some((colour) => p.shares[colour] > 0 && game.prices[colour] > 0)
}

/** R-DEBT-02: at most this many shares of `colour` in one forced sale. */
export function maxForcedSale(game: GameData, playerId: PlayerId, colour: Colour): number {
  const p = game.players[playerId]
  const price = forcedSalePrice(game, colour)
  if (!p || p.cash >= 0 || price <= 0) return 0
  return Math.min(p.shares[colour], Math.ceil(-p.cash / price))
}

class RuleError extends Error {}

function fail(message: string): never {
  throw new RuleError(message)
}

function emptyShares(): Record<Colour, number> {
  return { blue: 0, green: 0, red: 0, yellow: 0 }
}

function perColour(value: number): Record<Colour, number> {
  return { blue: value, green: value, red: value, yellow: value }
}

function isOut(state: GameState, playerId: PlayerId): boolean {
  return state.players.find((p) => p.id === playerId)?.eliminated ?? true
}

/** Keeps the envelope in step with `game.step` — `pendingPlayerIds` is derived here and nowhere else. */
export function withEnvelope(state: GameState, game: GameData): GameState {
  if (game.step === 'ended') {
    return { ...state, game, status: 'completed', phase: null, activePlayerId: null, pendingPlayerIds: [] }
  }
  if (game.step === 'debts') {
    return { ...state, game, phase: game.step, activePlayerId: null, pendingPlayerIds: [...game.debtors] }
  }
  const turnPlayer = game.turnPlayerId
  return { ...state, game, phase: game.step, activePlayerId: turnPlayer, pendingPlayerIds: turnPlayer ? [turnPlayer] : [] }
}

/** The next seated player still in the game after `playerId`. */
function nextPlayer(state: GameState, game: GameData, playerId: PlayerId | null): PlayerId | null {
  const seats = game.seatOrder
  const start = playerId ? seats.indexOf(playerId) : -1
  for (let i = 1; i <= seats.length; i++) {
    const candidate = seats[(start + i + seats.length) % seats.length]
    if (!isOut(state, candidate)) return candidate
  }
  return null
}

/** Starts the next player's turn at R-TURN-01. Mutates `game`; returns the new turn number. */
function startNextTurn(state: GameState, game: GameData): number {
  game.turnPlayerId = nextPlayer(state, game, game.turnPlayerId)
  game.step = 'preTrade'
  game.roll = null
  game.boughtThisTurn = 0
  return state.turn + 1
}

/** R-END-02/03. Mutates `game`; returns the winners. */
function finish(state: GameState, game: GameData): PlayerId[] {
  game.step = 'ended'
  game.debtors = []
  const standing = game.seatOrder.filter((id) => !isOut(state, id))
  game.finalWealth = Object.fromEntries(standing.map((id) => [id, wealthOf(game, id)]))
  const best = Math.max(...standing.map((id) => game.finalWealth![id]))
  return standing.filter((id) => game.finalWealth![id] === best)
}

function sell(game: GameData, playerId: PlayerId, colour: Colour, count: number, unitPrice: number): number {
  const p = game.players[playerId]
  const proceeds = count * unitPrice
  game.players[playerId] = { ...p, cash: p.cash + proceeds, shares: { ...p.shares, [colour]: p.shares[colour] - count } }
  game.bank = { ...game.bank, [colour]: game.bank[colour] + count }
  return proceeds
}

/**
 * R-DEBT-01..03: settles every debt that has only one way to be paid, and
 * leaves the debtors who have a choice in `game.debtors`. Mutates `game`.
 */
function settleDebts(state: GameState, game: GameData): void {
  const debtors: PlayerId[] = []
  for (const id of game.seatOrder) {
    if (isOut(state, id) || game.players[id].cash >= 0) continue
    const sellable = COLOURS.filter((colour) => game.players[id].shares[colour] > 0 && game.prices[colour] > 0)
    const cover = sellable.reduce((total, colour) => total + game.players[id].shares[colour] * forcedSalePrice(game, colour), 0)
    const debt = -game.players[id].cash
    if (sellable.length >= 2 && cover > debt) {
      debtors.push(id)
      continue
    }
    for (const colour of sellable) {
      const count = cover > debt ? maxForcedSale(game, id, colour) : game.players[id].shares[colour]
      const proceeds = sell(game, id, colour, count, forcedSalePrice(game, colour))
      game.autoSales = [...game.autoSales, { playerId: id, colour, count, proceeds }]
    }
    if (game.players[id].cash < 0) {
      // AMBIG-6: nothing left to sell — the bank writes the rest off.
      game.writeOffs = { ...game.writeOffs, [id]: (game.writeOffs[id] ?? 0) - game.players[id].cash }
      game.players[id] = { ...game.players[id], cash: 0 }
    }
  }
  game.debtors = debtors
}

/** Once no forced sale is owed, the turn player's second trade step (or, if they've left, the next turn). */
function afterDebts(state: GameState, game: GameData): number {
  if (game.debtors.length > 0) {
    game.step = 'debts'
    return state.turn
  }
  if (game.turnPlayerId && isOut(state, game.turnPlayerId)) return startNextTurn(state, game)
  game.step = 'postTrade'
  return state.turn
}

function requireTurnPlayer(game: GameData, playerId: PlayerId, steps: readonly Step[]): void {
  if (game.turnPlayerId !== playerId) fail("It isn't your turn.")
  if (!steps.includes(game.step)) fail(`You can't do that now (${STEP_LABELS[game.step].toLowerCase()}).`)
}

function requireCount(count: unknown): number {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) fail('Choose a whole number of shares, at least 1.')
  return count
}

function requireColour(colour: unknown): Colour {
  if (!COLOURS.includes(colour as Colour)) fail(`Unknown colour: ${String(colour)}`)
  return colour as Colour
}

/** R-SHARE-01..04. */
function onBuy(game: GameData, playerId: PlayerId, rawColour: unknown, rawCount: unknown): void {
  requireTurnPlayer(game, playerId, ['preTrade', 'postTrade'])
  const colour = requireColour(rawColour)
  const count = requireCount(rawCount)
  if (game.boughtThisTurn + count > MAX_BUY_PER_TURN) fail(`At most ${MAX_BUY_PER_TURN} shares a turn — you can buy ${MAX_BUY_PER_TURN - game.boughtThisTurn} more.`)
  if (game.prices[colour] <= 0) fail(`${colour} has no price yet, so its shares can't be bought.`)
  if (game.bank[colour] < count) fail(`The bank has only ${game.bank[colour]} ${colour} shares left.`)
  const cost = count * sharePrice(game, colour)
  const p = game.players[playerId]
  if (p.cash < cost) fail(`That costs ${formatFT(cost)}; you have ${formatFT(p.cash)}.`)
  game.players[playerId] = { ...p, cash: p.cash - cost, shares: { ...p.shares, [colour]: p.shares[colour] + count } }
  game.bank = { ...game.bank, [colour]: game.bank[colour] - count }
  game.boughtThisTurn += count
}

/** R-SHARE-01/02: any number, at the current price. */
function onSell(game: GameData, playerId: PlayerId, rawColour: unknown, rawCount: unknown): void {
  requireTurnPlayer(game, playerId, ['preTrade', 'postTrade'])
  const colour = requireColour(rawColour)
  const count = requireCount(rawCount)
  if (game.players[playerId].shares[colour] < count) fail(`You hold only ${game.players[playerId].shares[colour]} ${colour} shares.`)
  if (game.prices[colour] <= 0) fail(`${colour} shares are worth nothing right now.`)
  sell(game, playerId, colour, count, sharePrice(game, colour))
}

/** R-TURN-02/03: roll both dice; with nowhere legal to place, the turn is missed. Returns the new turn number. */
function onRoll(state: GameState, game: GameData, playerId: PlayerId, random: Random): number {
  requireTurnPlayer(game, playerId, ['preTrade'])
  const colour = COLOUR_DIE[random.int(0, COLOUR_DIE.length - 1)]
  const zone = random.int(1, 6)
  game.roll = { colour, zone }
  const missed = placementsForRoll(game).length === 0
  game.lastRoll = { playerId, colour, zone, missed }
  if (missed) return startNextTurn(state, game)
  game.step = 'place'
  return state.turn
}

/** R-PLACE-01..06, R-PAY-01..03, R-END-01. Returns the winners if the game ended. */
function onPlace(state: GameState, game: GameData, playerId: PlayerId, rawCell: unknown, rawColour: unknown): PlayerId[] | null {
  requireTurnPlayer(game, playerId, ['place'])
  const colour = requireColour(rawColour)
  const roll = game.roll!
  if (roll.colour !== 'white' && roll.colour !== colour) fail(`The die says ${roll.colour}.`)
  if (game.supply[colour] <= 0) fail(`There are no ${colour} markers left.`)
  if (typeof rawCell !== 'number' || zoneOf(rawCell) !== roll.zone) fail(`Place the marker in zone ${roll.zone}.`)
  const cell = rawCell
  const preview = previewPlacement(game.board, cell, colour)
  if (!preview.legal) fail(preview.reason ?? 'That placement is not allowed.')

  const pricesBefore = { ...game.prices }
  const board = [...game.board]
  board[cell] = colour
  const eliminated = preview.eliminated.map((c) => ({ cell: c, colour: board[c]! }))
  for (const c of preview.eliminated) board[c] = null
  const pricesAfter = pricesOf(board)

  const payments: Payment[] = []
  const rise = pricesAfter[colour] - pricesBefore[colour]
  // R-PAY-01 (AMBIG-4): the new price if this colour rose, else the isolated-marker bonus.
  payments.push({ playerId, amount: rise > 0 ? pricesAfter[colour] * PRICE_UNIT : ISOLATED_BONUS, reason: 'placement', colour })
  for (const id of game.seatOrder) {
    if (isOut(state, id)) continue
    const shares = game.players[id].shares
    // R-PAY-02: dividends, the placer included.
    if (rise > 0 && shares[colour] > 0) payments.push({ playerId: id, amount: rise * PRICE_UNIT * shares[colour], reason: 'dividend', colour })
    // R-PAY-03: falls, the placer excepted (AMBIG-5 covers the placed colour).
    if (id === playerId) continue
    for (const k of COLOURS) {
      const fall = pricesBefore[k] - pricesAfter[k]
      if (fall > 0 && shares[k] > 0) payments.push({ playerId: id, amount: -fall * PRICE_UNIT * shares[k], reason: 'fall', colour: k })
    }
  }
  for (const payment of payments) {
    const p = game.players[payment.playerId]
    game.players[payment.playerId] = { ...p, cash: p.cash + payment.amount }
  }

  game.board = board
  game.prices = pricesAfter
  game.supply = { ...game.supply, [colour]: game.supply[colour] - 1 }
  game.lastPlacement = { playerId, cell, colour, groupSize: preview.groupSize, eliminated, pricesBefore, pricesAfter, payments }

  // R-END-01: the scale topped out, or a colour ran out of markers.
  const capped = COLOURS.find((k) => pricesAfter[k] >= MAX_PRICE)
  if (capped) game.endReason = { kind: 'priceCap', colour: capped }
  else if (game.supply[colour] === 0) game.endReason = { kind: 'markersExhausted', colour }
  if (game.endReason) return finish(state, game)

  settleDebts(state, game)
  return null
}

/** R-DEBT-02: a debtor's chosen sale at half price. */
function onForcedSell(state: GameState, game: GameData, playerId: PlayerId, rawColour: unknown, rawCount: unknown): void {
  if (game.step !== 'debts' || !game.debtors.includes(playerId)) fail("You don't owe a forced sale.")
  const colour = requireColour(rawColour)
  const count = requireCount(rawCount)
  const max = maxForcedSale(game, playerId, colour)
  if (max === 0) fail(`You have no ${colour} shares worth selling.`)
  if (count > game.players[playerId].shares[colour]) fail(`You hold only ${game.players[playerId].shares[colour]} ${colour} shares.`)
  if (count > max) fail(`${max} ${colour} share${max === 1 ? '' : 's'} already cover${max === 1 ? 's' : ''} the debt.`)
  sell(game, playerId, colour, count, forcedSalePrice(game, colour))
  settleDebts(state, game)
}

function apply(state: GameState, action: GameAction, random: Random): GameState {
  // A working copy the handlers may reassign fields of — `players` is copied
  // too because they replace entries in it. Never mutate `state` (replay and
  // undo keep it).
  const game: GameData = { ...state.game, players: { ...state.game.players }, autoSales: [], writeOffs: {} }
  const actor = state.players.find((p) => p.id === action.playerId)
  if (!actor) fail(`Unknown player: ${action.playerId}`)
  if (actor.eliminated) fail('You are no longer in this game.')
  let turn = state.turn
  let winners: PlayerId[] | null = null
  switch (action.type) {
    case 'BUY':
      onBuy(game, action.playerId, action.colour, action.count)
      break
    case 'SELL':
      onSell(game, action.playerId, action.colour, action.count)
      break
    case 'ROLL':
      turn = onRoll(state, game, action.playerId, random)
      break
    case 'PLACE':
      winners = onPlace(state, game, action.playerId, action.cell, action.colour)
      if (!winners) turn = afterDebts(state, game)
      break
    case 'FORCED_SELL':
      onForcedSell(state, game, action.playerId, action.colour, action.count)
      turn = afterDebts(state, game)
      break
    case 'END_TURN':
      requireTurnPlayer(game, action.playerId, ['postTrade'])
      turn = startNextTurn(state, game)
      break
    default: {
      const unknown: never = action
      fail(`Unknown action: ${String((unknown as { type: unknown }).type)}`)
    }
  }
  const next = withEnvelope({ ...state, turn }, game)
  return winners ? { ...next, winnerPlayerIds: winners } : next
}

function colourName(colour: Colour): string {
  return colour[0].toUpperCase() + colour.slice(1)
}

function shareCount(count: number, colour: Colour): string {
  return `${count} ${colour} share${count === 1 ? '' : 's'}`
}

/** Log lines for what the rules settled on their own: forced sales, write-offs, the end. */
function aftermath(after: GameState): string[] {
  const g = after.game
  const name = (id: PlayerId) => after.players.find((p) => p.id === id)?.displayName ?? 'Someone'
  const lines = g.autoSales.map((s) => `${name(s.playerId)} had to sell ${shareCount(s.count, s.colour)} at half price (${formatFT(s.proceeds)}).`)
  for (const [id, amount] of Object.entries(g.writeOffs)) lines.push(`The bank wrote off ${formatFT(amount)} of ${name(id)}'s debt.`)
  if (g.debtors.length > 0) lines.push(`Waiting on forced sales from ${g.debtors.map(name).join(', ')}.`)
  if (g.step === 'ended' && g.endReason) {
    const why = g.endReason.kind === 'priceCap' ? `${colourName(g.endReason.colour)} reached ${MAX_PRICE}` : `the last ${g.endReason.colour} marker was placed`
    lines.push(`Game over — ${why}. Winner${after.winnerPlayerIds.length === 1 ? '' : 's'}: ${after.winnerPlayerIds.map(name).join(', ')}.`)
  }
  return lines
}

function describe(action: GameAction, before: GameState, after: GameState): string {
  const g = after.game
  switch (action.type) {
    case 'BUY':
      return `{player} bought ${shareCount(action.count, action.colour)} for ${formatFT(action.count * sharePrice(before.game, action.colour))}.`
    case 'SELL':
      return `{player} sold ${shareCount(action.count, action.colour)} for ${formatFT(action.count * sharePrice(before.game, action.colour))}.`
    case 'FORCED_SELL':
      return `{player} sold ${shareCount(action.count, action.colour)} at half price for ${formatFT(action.count * forcedSalePrice(before.game, action.colour))}.`
    case 'END_TURN':
      return '{player} ended their turn.'
    case 'ROLL': {
      const roll = g.lastRoll!
      const face = roll.colour === 'white' ? 'white (any colour)' : roll.colour
      return `{player} rolled ${face} and zone ${roll.zone}.${roll.missed ? ' Nowhere legal to place — turn missed.' : ''}`
    }
    case 'PLACE': {
      const placed = g.lastPlacement!
      const parts = [`{player} placed ${placed.colour} on ${cellLabel(placed.cell)}${placed.groupSize > 1 ? ` (group of ${placed.groupSize})` : ''}.`]
      if (placed.eliminated.length > 0) {
        const gone = COLOURS.map((k) => [k, placed.eliminated.filter((e) => e.colour === k).length] as const).filter(([, n]) => n > 0)
        parts.push(`Eliminated ${gone.map(([k, n]) => `${n} ${k}`).join(' and ')}.`)
      }
      const moves = COLOURS.filter((k) => placed.pricesBefore[k] !== placed.pricesAfter[k]).map((k) => `${k} ${placed.pricesBefore[k]} → ${placed.pricesAfter[k]}`)
      if (moves.length > 0) parts.push(`Prices: ${moves.join(', ')}.`)
      const earned = placed.payments.filter((p) => p.playerId === placed.playerId && p.amount > 0).reduce((total, p) => total + p.amount, 0)
      parts.push(`{player} collected ${formatFT(earned)}.`)
      return parts.join(' ')
    }
  }
}

export const gameDefinition: GameDefinition<GameData, GameOptions, GameAction> = {
  id: 'shark',
  rulesVersion: 1,
  title: 'Shark',
  turnLabel: 'Turn',
  minPlayers: 3,
  maxPlayers: 6,

  defaultOptions: DEFAULT_GAME_OPTIONS,
  normalizeOptions: normalizeGameOptions,
  describeOptions(options) {
    return options.startingCash > 0 ? `Start with ${formatFT(options.startingCash)}` : 'Standard rules'
  },

  setup(lobby: LobbyState<GameOptions>) {
    const players: Record<PlayerId, PlayerData> = Object.fromEntries(lobby.turnOrder.map((id) => [id, { cash: lobby.options.startingCash, shares: emptyShares() }]))
    const game: GameData = {
      board: Array.from({ length: 120 }, () => null),
      supply: perColour(MARKERS_PER_COLOUR),
      prices: perColour(0),
      bank: perColour(SHARES_PER_COLOUR),
      players,
      seatOrder: [...lobby.turnOrder],
      turnPlayerId: lobby.turnOrder[0] ?? null,
      step: 'preTrade',
      roll: null,
      lastRoll: null,
      boughtThisTurn: 0,
      debtors: [],
      lastPlacement: null,
      autoSales: [],
      writeOffs: {},
      endReason: null,
      finalWealth: null,
    }
    return withEnvelope({ ...lobby, status: 'active', turn: 1 } as GameState, game)
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

  onPlayerEliminated(state, playerId) {
    // R-LEAVE-01: their shares go back to the bank; a forced sale they owed is dropped.
    const game: GameData = { ...state.game, autoSales: [], writeOffs: {} }
    const p = game.players[playerId]
    if (p) {
      game.bank = Object.fromEntries(COLOURS.map((k) => [k, game.bank[k] + p.shares[k]])) as Record<Colour, number>
      game.players = { ...game.players, [playerId]: { cash: Math.max(0, p.cash), shares: emptyShares() } }
    }
    game.debtors = game.debtors.filter((id) => id !== playerId)
    if (state.status !== 'active') return { ...state, game }
    let turn = state.turn
    if (game.step === 'debts') turn = afterDebts(state, game)
    else if (game.turnPlayerId === playerId) turn = startNextTurn(state, game)
    return withEnvelope({ ...state, turn }, game)
  },

  nextForcedAction(state) {
    // Nothing left to trade after the placement: end the turn rather than ask.
    const g = state.game
    if (state.status !== 'active' || g.step !== 'postTrade' || !g.turnPlayerId) return null
    if (canBuyAny(g, g.turnPlayerId) || canSellAny(g, g.turnPlayerId)) return null
    return { type: 'END_TURN', playerId: g.turnPlayerId }
  },

  redactGame(state) {
    return state.game
  },

  isActionSecret() {
    return false
  },

  describeAction(action, before, after): ActionDescription {
    return { message: [describe(action, before, after), ...aftermath(after)].join(' ') }
  },

  describePhase(phase) {
    return phase && phase in STEP_LABELS ? STEP_LABELS[phase as Step] : 'In progress'
  },
}
