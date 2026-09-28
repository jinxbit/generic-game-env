// Phase 2: Investment (RULES.md §5) — public auctions with their reverse
// auctions, private sales and passes, plus the ⚑ FREE_CUBES,
// ⚑ CLOSED_AUCTION_SCO and ⚑ R3_SALES_MODE hooks.

import { countryDef, countryName, isCountry, looseOf, MAJOR_COUNTRIES } from './board.ts'
import { executeAttack } from './competition.ts'
import { addLoose, occupySquare, removableCubes, removeCubeRefs, saleCostCountries } from './cubes.ts'
import { addCash, activeSeats, cashOf, clockwiseAfter, displayName, expectPrompt, fail, isFinalRound, nextSeat, note, player, requireWhole, runNext, setPrompt, type Ctx } from './context.ts'
import { pay, requireAffordable } from './loans.ts'
import type {
  AuctionPrompt,
  BidAction,
  ChooseSquareAction,
  ClosedSellAction,
  CountryId,
  CubeRef,
  FreeAttackAction,
  InvestPassAction,
  PassBidAction,
  PickWinnerAction,
  PlayerId,
  RemoveCubesAction,
  SealedBidAction,
  StartAuctionAction,
  StartPrivateSaleAction,
  Task,
} from './types.ts'

export function startInvestment(ctx: Ctx): void {
  ctx.g.phase = 'investment'
  ctx.g.cursor = null
  runNext(ctx, { t: 'investmentNext' })
}

const bankEmpty = (ctx: Ctx): boolean => MAJOR_COUNTRIES.every((c) => (ctx.g.bank[c] ?? 0) === 0)

/** Loop (§5): the next player clockwise with an executive left; the phase ends when every pool is empty. */
export function investmentNext(ctx: Ctx): void {
  const g = ctx.g
  // ⚑ R3_SALES_MODE reverseOnly: the final Investment ends as soon as the bank is out of shares.
  const soldOut = ctx.options.r3SalesMode === 'reverseOnly' && isFinalRound(ctx) && bankEmpty(ctx)
  const next = soldOut ? null : nextSeat(ctx, g.cursor, (id) => g.players[id].executives > 0)
  if (!next) {
    runNext(ctx, { t: 'endPhase' }, { t: 'startCompetition' })
    return
  }
  g.cursor = next
  setPrompt(ctx, { kind: 'investTurn', playerId: next })
}

/** ⚑ R3_SALES_MODE in the final round: `banned` stops all selling, `reverseOnly` stops private sales. */
function salesAllowed(ctx: Ctx, kind: 'private' | 'reverse'): boolean {
  if (!isFinalRound(ctx)) return true
  const mode = ctx.options.r3SalesMode
  return mode === 'normal' || (mode === 'reverseOnly' && kind === 'reverse')
}

/** ⚑ FREE_CUBES: r−1 cubes, in round 2 or later (round 3 cut to 1 with the R3_SALES_MODE sub-option). */
export function freeCubeCount(ctx: Ctx): number {
  if (!ctx.options.freeCubes) return 0
  const count = Math.max(0, ctx.g.round - 1)
  return ctx.options.r3FreeCubesOne && ctx.g.round === 3 ? Math.min(1, count) : count
}

/** ⚑ FREE_CUBES: selling costs r−1 cubes from the country and/or Tax Havens. */
export function saleCostCount(ctx: Ctx): number {
  return ctx.options.freeCubes ? Math.max(0, ctx.g.round - 1) : 0
}

/** Can this player meet ⚑ FREE_CUBES' sale cost? Otherwise the sale is illegal. */
function canPaySaleCost(ctx: Ctx, playerId: PlayerId, country: CountryId): boolean {
  return removableCubes(ctx, playerId, saleCostCountries(country)).length >= saleCostCount(ctx)
}

function afterInvestAction(ctx: Ctx, playerId: PlayerId): void {
  expectPrompt(ctx, 'investTurn', playerId)
  if (player(ctx, playerId).executives === 0) fail('You have no executive left.')
  player(ctx, playerId).executives -= 1
  ctx.g.prompt = null
  runNext(ctx, { t: 'investmentNext' })
}

/** R-INV-01/02: an executive on a major with bank stock opens an auction ($3 or more) — sealed for an SCO country under ⚑ CLOSED_AUCTION_SCO. */
export function onStartAuction(ctx: Ctx, action: StartAuctionAction): void {
  const g = ctx.g
  const { country, playerId } = action
  if (!isCountry(country) || !countryDef(country).isMajor) fail('Auctions are for major countries.')
  if ((g.bank[country] ?? 0) < 1) fail(`The bank has no ${countryName(country)} shares left.`)
  const sealed = ctx.options.closedAuctionSco && g.countries[country].affiliation === 'SCO'
  if (!sealed) {
    requireWhole(action.bid, 'The opening bid', 3)
    requireAffordable(ctx, playerId, action.bid as number)
  }
  afterInvestAction(ctx, playerId)
  if (sealed) {
    const id = g.nextPromptId++
    setPrompt(ctx, { kind: 'sealedAuction', auctionId: id, country, initiatorId: playerId, bids: Object.fromEntries(activeSeats(ctx).map((p) => [p, null])), submitted: [] })
    note(ctx, `${displayName(ctx, playerId)} opens a sealed auction for ${countryName(country)}.`)
    return
  }
  const bid = action.bid as number
  note(ctx, `${displayName(ctx, playerId)} opens an auction for ${countryName(country)} at $${bid}.`)
  const prompt: AuctionPrompt = { kind: 'auction', mode: 'public', country, ownerId: playerId, initiatorId: playerId, active: clockwiseAfter(ctx, playerId), current: playerId, high: { playerId, amount: bid }, limit: 0 }
  setPrompt(ctx, prompt)
  advanceAuction(ctx, prompt)
}

/** R-INV-07: an executive on Tax Havens offers one of your shares at a minimum price. */
export function onStartPrivateSale(ctx: Ctx, action: StartPrivateSaleAction): void {
  const { country, playerId } = action
  if (!salesAllowed(ctx, 'private')) fail('Private sales are not allowed this round.')
  if (!isCountry(country) || (player(ctx, playerId).shares[country] ?? 0) < 1) fail('You can only sell a share you own.')
  const minPrice = requireWhole(action.minPrice, 'The minimum price')
  if (!canPaySaleCost(ctx, playerId, country)) fail(`Selling now costs ${saleCostCount(ctx)} of your cubes there or in Tax Havens, and you don't have them.`)
  afterInvestAction(ctx, playerId)
  note(ctx, `${displayName(ctx, playerId)} offers a ${countryName(country)} share privately, minimum $${minPrice}.`)
  const bidders = clockwiseAfter(ctx, playerId).filter((id) => id !== playerId)
  if (bidders.length === 0) return
  setPrompt(ctx, { kind: 'auction', mode: 'private', country, ownerId: playerId, initiatorId: playerId, active: bidders, current: bidders[0], high: null, limit: minPrice })
}

/** R-INV-10. */
export function onInvestPass(ctx: Ctx, action: InvestPassAction): void {
  afterInvestAction(ctx, action.playerId)
  note(ctx, `${displayName(ctx, action.playerId)} passes.`)
}

export function onBid(ctx: Ctx, action: BidAction): void {
  const a = expectPrompt(ctx, 'auction', action.playerId)
  const amount = requireWhole(action.amount, 'A bid')
  if (a.mode === 'reverse') {
    const ceiling = a.high?.amount ?? a.limit
    if (amount >= ceiling) fail(`Bid below $${ceiling}.`)
  } else if (a.high) {
    if (amount <= a.high.amount) fail(`Bid more than $${a.high.amount}.`)
  } else if (amount < a.limit) {
    fail(`The first bid must be at least $${a.limit}.`)
  }
  if (a.mode !== 'reverse') requireAffordable(ctx, action.playerId, amount)
  a.high = { playerId: action.playerId, amount }
  note(ctx, `${displayName(ctx, action.playerId)} bids $${amount}.`)
  advanceAuction(ctx, a)
}

export function onPassBid(ctx: Ctx, action: PassBidAction): void {
  const a = expectPrompt(ctx, 'auction', action.playerId)
  if (a.high?.playerId === action.playerId) fail('You hold the standing bid.')
  a.active = a.active.filter((id) => id !== action.playerId)
  note(ctx, `${displayName(ctx, action.playerId)} passes.`)
  advanceAuction(ctx, a)
}

/**
 * Next bidder clockwise among those still in (never the standing bidder);
 * the auction closes once nobody else is left to bid (R-INV-02/05/08).
 */
function advanceAuction(ctx: Ctx, a: AuctionPrompt): void {
  const next = clockwiseAfter(ctx, a.current).find((id) => a.active.includes(id) && id !== a.high?.playerId)
  if (next) {
    a.current = next
    return
  }
  ctx.g.prompt = null
  const { country } = a
  if (a.mode === 'public') {
    const winner = a.high as { playerId: PlayerId; amount: number }
    runNext(ctx, { t: 'settlePurchase', country, buyerId: winner.playerId, price: winner.amount, initiatorId: a.initiatorId, closed: false })
    return
  }
  if (!a.high) {
    note(ctx, a.mode === 'reverse' ? 'Nobody sells.' : 'No bids — the share stays put.')
    return
  }
  const { playerId, amount } = a.high
  if (a.mode === 'reverse') {
    sellToBank(ctx, playerId, country, amount, a.initiatorId)
    return
  }
  // R-INV-09: the buyer pays the seller, takes the share and replaces one of the seller's cubes.
  const seller = a.ownerId
  pay(ctx, playerId, amount)
  addCash(ctx, seller, amount)
  player(ctx, seller).shares[country] -= 1
  player(ctx, playerId).shares[country] = (player(ctx, playerId).shares[country] ?? 0) + 1
  note(ctx, `${displayName(ctx, playerId)} buys ${displayName(ctx, seller)}'s ${countryName(country)} share for $${amount}.`)
  // ⚑ FREE_CUBES: the seller loses cubes first.
  runNext(ctx, { t: 'saleCost', country, playerId: seller }, { t: 'replaceSeller', country, buyerId: playerId, sellerId: seller }, { t: 'freeCubes', country, playerId })
}

/** A share sold back to the bank (R-INV-05, or ⚑ CLOSED_AUCTION_SCO's initiator sale). */
function sellToBank(ctx: Ctx, sellerId: PlayerId, country: CountryId, price: number, initiatorId: PlayerId): void {
  addCash(ctx, sellerId, price)
  player(ctx, sellerId).shares[country] -= 1
  ctx.g.bank[country] = (ctx.g.bank[country] ?? 0) + 1
  note(ctx, `${displayName(ctx, sellerId)} sells a ${countryName(country)} share to the bank for $${price}.`)
  natoBonus(ctx, sellerId, country, initiatorId)
  runNext(ctx, { t: 'saleCost', country, playerId: sellerId }, { t: 'removeSold', country, playerId: sellerId })
}

/** ⚑ CLOSED_AUCTION_SCO: in a NATO country's open auction, the initiator gets +$1 from the bank if they end up buying or selling. */
function natoBonus(ctx: Ctx, playerId: PlayerId, country: CountryId, initiatorId: PlayerId): void {
  if (!ctx.options.closedAuctionSco || playerId !== initiatorId || ctx.g.countries[country].affiliation !== 'NATO') return
  addCash(ctx, playerId, 1)
  note(ctx, `${displayName(ctx, playerId)} gets $1 from the bank for initiating.`)
}

/** R-INV-03/04: the winner pays (forced loans if needed), takes a share and places a cube; then the reverse auction. */
export function settlePurchase(ctx: Ctx, task: Extract<Task, { t: 'settlePurchase' }>): void {
  const { country, buyerId, price, initiatorId, closed } = task
  pay(ctx, buyerId, price)
  ctx.g.bank[country] -= 1
  const p = player(ctx, buyerId)
  p.shares[country] = (p.shares[country] ?? 0) + 1
  note(ctx, `${displayName(ctx, buyerId)} buys a ${countryName(country)} share for $${price}.`)
  if (!closed) natoBonus(ctx, buyerId, country, initiatorId)
  const sale: Task = closed ? { t: 'closedSellOffer', country, buyerId, price, initiatorId } : { t: 'reverseAuction', country, buyerId, price, initiatorId }
  runNext(ctx, { t: 'placeBought', country, playerId: buyerId }, sale, { t: 'freeCubes', country, playerId: buyerId })
}

/** R-INV-04: an empty unlocked square; else replace an opponent's cube; else nothing. ⚑ ACCUM_RD: fortified squares are off-limits. */
export function placeBought(ctx: Ctx, task: Extract<Task, { t: 'placeBought' }>): void {
  const { country, playerId } = task
  if (player(ctx, playerId).supply === 0) return
  const squares = ctx.g.countries[country].squares
  let options = squares.flatMap((s, i) => (s.occupant === null ? [i] : []))
  if (options.length === 0) options = squares.flatMap((s, i) => (s.occupant !== null && s.occupant !== 'LOCK' && s.occupant !== playerId && !s.fortified ? [i] : []))
  if (options.length === 0) return
  if (options.length === 1) {
    placeBoughtCube(ctx, playerId, country, options[0])
    return
  }
  setPrompt(ctx, { kind: 'chooseSquare', playerId, reason: 'placeBought', country, options, optional: false })
}

function placeBoughtCube(ctx: Ctx, playerId: PlayerId, country: CountryId, square: number): void {
  const displaced = ctx.g.countries[country].squares[square].occupant
  occupySquare(ctx, playerId, country, square)
  const what = `the ${countryDef(country).squares[square]} square in ${countryName(country)}`
  note(ctx, typeof displaced === 'string' && displaced !== 'LOCK' ? `${displayName(ctx, playerId)} replaces ${displayName(ctx, displaced)} on ${what}.` : `${displayName(ctx, playerId)} places a cube on ${what}.`)
}

/** Answers a chooseSquare prompt for a bought share (R-INV-04) or a private-sale replacement (R-INV-09). */
export function onChooseSquare(ctx: Ctx, action: ChooseSquareAction): void {
  const prompt = expectPrompt(ctx, 'chooseSquare', action.playerId)
  if (action.square === null || !prompt.options.includes(action.square)) fail('Pick one of the offered squares.')
  ctx.g.prompt = null
  placeBoughtCube(ctx, action.playerId, prompt.country, action.square)
}

/** R-INV-05: the reverse auction, clockwise from the buyer, among other shareholders who may sell. */
export function reverseAuction(ctx: Ctx, task: Extract<Task, { t: 'reverseAuction' }>): void {
  const { country, buyerId, price, initiatorId } = task
  if (!salesAllowed(ctx, 'reverse')) return
  const sellers = clockwiseAfter(ctx, buyerId).filter((id) => id !== buyerId && (player(ctx, id).shares[country] ?? 0) > 0 && canPaySaleCost(ctx, id, country))
  if (sellers.length === 0) return
  setPrompt(ctx, { kind: 'auction', mode: 'reverse', country, ownerId: buyerId, initiatorId, active: sellers, current: sellers[0], high: null, limit: price })
}

/** ⚑ CLOSED_AUCTION_SCO: no reverse bidding — only the initiator may sell, at the buying price. */
export function closedSellOffer(ctx: Ctx, task: Extract<Task, { t: 'closedSellOffer' }>): void {
  const { country, buyerId, price, initiatorId } = task
  if (initiatorId === buyerId || !salesAllowed(ctx, 'reverse') || !activeSeats(ctx).includes(initiatorId)) return
  if ((player(ctx, initiatorId).shares[country] ?? 0) < 1 || !canPaySaleCost(ctx, initiatorId, country)) return
  setPrompt(ctx, { kind: 'closedSell', playerId: initiatorId, country, price })
}

export function onClosedSell(ctx: Ctx, action: ClosedSellAction): void {
  const prompt = expectPrompt(ctx, 'closedSell', action.playerId)
  ctx.g.prompt = null
  if (action.sell === true) sellToBank(ctx, action.playerId, prompt.country, prompt.price, prompt.playerId)
  else note(ctx, `${displayName(ctx, action.playerId)} doesn't sell.`)
}

/** ⚑ CLOSED_AUCTION_SCO: each player commits a bid no larger than their cash ([AMBIG-17]); $0 is a pass. */
export function onSealedBid(ctx: Ctx, action: SealedBidAction): void {
  const prompt = ctx.g.prompt
  if (!prompt || prompt.kind !== 'sealedAuction' || prompt.auctionId !== action.auctionId) fail('No sealed auction is open.')
  if (!(action.playerId in prompt.bids) || prompt.submitted.includes(action.playerId)) fail('You have already bid.')
  const amount = requireWhole(action.amount, 'A bid')
  if (amount > cashOf(ctx, action.playerId)) fail('A sealed bid cannot exceed your cash — take loans first.')
  prompt.bids[action.playerId] = amount
  prompt.submitted.push(action.playerId)
  const waiting = activeSeats(ctx).filter((id) => id in prompt.bids && !prompt.submitted.includes(id))
  if (waiting.length === 0) revealSealed(ctx)
}

export function revealSealed(ctx: Ctx): void {
  const prompt = ctx.g.prompt
  if (!prompt || prompt.kind !== 'sealedAuction') return
  ctx.g.prompt = null
  const bids = Object.entries(prompt.bids).map(([id, amount]) => [id, amount ?? 0] as const)
  note(ctx, `Sealed bids: ${bids.map(([id, amount]) => `${displayName(ctx, id)} $${amount}`).join(', ')}.`)
  const best = Math.max(0, ...bids.map(([, amount]) => amount))
  if (best === 0) {
    note(ctx, 'Nobody buys.')
    return
  }
  const tied = bids.filter(([, amount]) => amount === best).map(([id]) => id)
  if (tied.length > 1 && activeSeats(ctx).includes(prompt.initiatorId)) {
    setPrompt(ctx, { kind: 'sealedTie', playerId: prompt.initiatorId, country: prompt.country, tied, amount: best })
    return
  }
  runNext(ctx, { t: 'settlePurchase', country: prompt.country, buyerId: tied[0], price: best, initiatorId: prompt.initiatorId, closed: true })
}

/** ⚑ CLOSED_AUCTION_SCO: on a tie the initiator picks the winner. */
export function onPickWinner(ctx: Ctx, action: PickWinnerAction): void {
  const prompt = expectPrompt(ctx, 'sealedTie', action.playerId)
  if (!prompt.tied.includes(action.winnerId)) fail('Pick one of the tied bidders.')
  ctx.g.prompt = null
  runNext(ctx, { t: 'settlePurchase', country: prompt.country, buyerId: action.winnerId, price: prompt.amount, initiatorId: action.playerId, closed: true })
}

/** R-INV-05: the seller removes one of their own cubes in that country, if they have one. */
export function removeSold(ctx: Ctx, task: Extract<Task, { t: 'removeSold' }>): void {
  promptRemoval(ctx, task.playerId, task.country, 1, [task.country], 'sold')
}

/** ⚑ FREE_CUBES: a sale in round r costs r−1 cubes from the country and/or Tax Havens. */
export function saleCost(ctx: Ctx, task: Extract<Task, { t: 'saleCost' }>): void {
  const count = saleCostCount(ctx)
  if (count > 0) promptRemoval(ctx, task.playerId, task.country, count, saleCostCountries(task.country), 'saleCost')
}

function sameCube(a: CubeRef, b: CubeRef): boolean {
  return a.country === b.country && ('loose' in a ? 'loose' in b : 'square' in b && a.square === b.square)
}

function promptRemoval(ctx: Ctx, playerId: PlayerId, country: CountryId, count: number, countries: CountryId[], reason: 'sold' | 'saleCost'): void {
  const options = removableCubes(ctx, playerId, countries)
  if (options.length === 0) return
  // No real choice: everything goes, or every option is the same cube.
  if (options.length <= count || options.every((o) => sameCube(o, options[0]))) {
    removeCubeRefs(ctx, playerId, options.slice(0, count), options)
    note(ctx, `${displayName(ctx, playerId)} removes ${Math.min(count, options.length)} cube(s).`)
    return
  }
  setPrompt(ctx, { kind: 'removeCubes', playerId, reason, country, count, options })
}

export function onRemoveCubes(ctx: Ctx, action: RemoveCubesAction): void {
  const prompt = expectPrompt(ctx, 'removeCubes', action.playerId)
  const cubes = Array.isArray(action.cubes) ? action.cubes : []
  if (cubes.length !== prompt.count) fail(`Remove exactly ${prompt.count} cube(s).`)
  ctx.g.prompt = null
  removeCubeRefs(ctx, action.playerId, cubes, prompt.options)
  note(ctx, `${displayName(ctx, action.playerId)} removes ${prompt.count} cube(s).`)
}

/** R-INV-09: the buyer replaces one of the seller's cubes in the country with their own (never a fortified one). */
export function replaceSeller(ctx: Ctx, task: Extract<Task, { t: 'replaceSeller' }>): void {
  const { country, buyerId, sellerId } = task
  if (player(ctx, buyerId).supply === 0) return
  const options = ctx.g.countries[country].squares.flatMap((s, i) => (s.occupant === sellerId && !s.fortified ? [i] : []))
  if (options.length === 0) return
  if (options.length === 1) {
    placeBoughtCube(ctx, buyerId, country, options[0])
    return
  }
  setPrompt(ctx, { kind: 'chooseSquare', playerId: buyerId, reason: 'replaceSeller', country, options, optional: false, sellerId })
}

/** ⚑ FREE_CUBES: the buyer gets r−1 loose cubes in the country, then may make one attack there under Competition rules. */
export function freeCubes(ctx: Ctx, task: Extract<Task, { t: 'freeCubes' }>): void {
  const { country, playerId } = task
  const count = Math.min(freeCubeCount(ctx), player(ctx, playerId).supply)
  if (count > 0) {
    addLoose(ctx, playerId, country, count)
    note(ctx, `${displayName(ctx, playerId)} gets ${count} free cube(s) in ${countryName(country)}.`)
  }
  if (ctx.options.freeCubes && looseOf(ctx.g.countries[country], playerId) > 0) setPrompt(ctx, { kind: 'freeAttack', playerId, country })
}

export function onFreeAttack(ctx: Ctx, action: FreeAttackAction): void {
  const prompt = expectPrompt(ctx, 'freeAttack', action.playerId)
  const attacks = Array.isArray(action.attacks) ? action.attacks : []
  if (attacks.length > 2) fail('One attack: at most 2 cube actions.')
  for (const attack of attacks) note(ctx, executeAttack(ctx, action.playerId, attack, prompt.country))
  ctx.g.prompt = null
}
