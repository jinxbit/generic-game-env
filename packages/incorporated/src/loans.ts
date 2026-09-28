// Corporate bonds (RULES.md §6) and every payment that can force one.

import { AMBIGUITY_DEFAULTS } from './ambiguities.ts'
import { addCash, cashOf, fail, note, player, displayName, type Ctx } from './context.ts'
import { TOTAL_BONDS } from './data/board.ts'
import { interestValue } from './sliders.ts'
import type { GameData, GameOptions, PlayerId } from './types.ts'

export function bondsOutstanding(game: GameData): number {
  return Object.values(game.players).reduce((sum, p) => sum + p.bonds, 0)
}

/** R-LOAN-02: `interestValue − existingBonds × $1` (⚑ LESS_CRUEL_LOANS: no penalty), never below [AMBIG-9]'s floor. */
export function loanProceeds(game: GameData, options: GameOptions, bonds: number): number {
  const value = interestValue(game.sliders) - (options.lessCruelLoans ? 0 : bonds)
  return Math.max(AMBIGUITY_DEFAULTS.minLoanProceeds, value)
}

/** Whether another bond exists to issue ([AMBIG-9]: 25 in total). */
export const canIssueBond = (game: GameData): boolean => bondsOutstanding(game) < TOTAL_BONDS

/**
 * The most a player could pay right now: cash plus the proceeds of every
 * loan still available to them. Bids above this could never be paid (the
 * bond supply would run out), so they're refused.
 */
export function borrowingCapacity(game: GameData, options: GameOptions, playerId: PlayerId): number {
  const p = game.players[playerId]
  let total = p.cash ?? 0
  let bonds = p.bonds
  for (let issued = bondsOutstanding(game); issued < TOTAL_BONDS; issued++) total += loanProceeds(game, options, bonds++)
  return total
}

/** Takes one loan (R-LOAN-02). */
export function takeLoan(ctx: Ctx, playerId: PlayerId): number {
  if (!canIssueBond(ctx.g)) fail('No bonds are left to issue.')
  const p = player(ctx, playerId)
  const proceeds = loanProceeds(ctx.g, ctx.options, p.bonds)
  p.bonds += 1
  addCash(ctx, playerId, proceeds)
  return proceeds
}

/**
 * Pays `amount` to the bank, taking forced loans for any shortfall
 * (R-LOAN-01). Should the bond supply run dry mid-payment — only possible when
 * other players borrowed after a bid was accepted — the player pays what
 * they have and the rest is forgiven: cash never goes negative before the
 * end of the game (R-LOAN-05).
 */
export function pay(ctx: Ctx, playerId: PlayerId, amount: number): void {
  let loans = 0
  while (cashOf(ctx, playerId) < amount && canIssueBond(ctx.g)) {
    takeLoan(ctx, playerId)
    loans++
  }
  if (loans > 0) note(ctx, `${displayName(ctx, playerId)} took ${loans === 1 ? 'a forced loan' : `${loans} forced loans`}.`)
  const p = player(ctx, playerId)
  p.cash = Math.max(0, cashOf(ctx, playerId) - amount)
}

/** Refuses a payment the player could never make, loans included. */
export function requireAffordable(ctx: Ctx, playerId: PlayerId, amount: number): void {
  if (amount > borrowingCapacity(ctx.g, ctx.options, playerId)) fail(`You can't raise $${amount}, even with every bond left.`)
}
