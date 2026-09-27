// The payoff deck (RULES.md §4.2 R-OUT-03, §8.2, §9.2).

import type { Ctx } from './context.ts'
import type { Industry } from './types.ts'

/**
 * The top card of the payoff deck. The discard pile is shuffled into a new
 * deck only when a draw is impossible (R-OUT-03). Null when both are empty.
 */
export function drawPayoff(ctx: Ctx): Industry | null {
  const g = ctx.g
  if (g.payoffDeck.length === 0) {
    if (g.payoffDiscard.length === 0) return null
    g.payoffDeck = ctx.random.shuffle(g.payoffDiscard)
    g.payoffDiscard = []
  }
  return g.payoffDeck.shift() as Industry
}

/** Draws up to `count` cards. */
export function drawPayoffs(ctx: Ctx, count: number): Industry[] {
  const drawn: Industry[] = []
  for (let i = 0; i < count; i++) {
    const card = drawPayoff(ctx)
    if (card === null) break
    drawn.push(card)
  }
  return drawn
}

export function discardPayoffs(ctx: Ctx, cards: Industry[]): void {
  ctx.g.payoffDiscard.push(...cards)
}

/** Whether any card could still be drawn. */
export const payoffAvailable = (ctx: Ctx): boolean => ctx.g.payoffDeck.length + ctx.g.payoffDiscard.length > 0

/** Revealed cards grouped by industry, for narration. */
export function describeCards(cards: readonly Industry[]): string {
  return cards.length === 0 ? 'none' : cards.join(', ')
}
