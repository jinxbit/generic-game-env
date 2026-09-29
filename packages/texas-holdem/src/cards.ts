// Everything about cards and chips that is a pure function of them: the
// deck, hand ranking (RULES.md §6) and side pots (§5). No game state here —
// ./rules.ts sequences the hand, and the view reuses these to label cards and
// hands.

import type { Card, PlayerId } from './types.ts'

export const RANKS = '23456789TJQKA'
export const SUITS = 'cdhs'

/** R-SETUP-02: all 52 cards, in a fixed order (what draws index into, AMBIG-1). */
export const FULL_DECK: readonly Card[] = [...SUITS].flatMap((suit) => [...RANKS].map((rank) => `${rank}${suit}`))

/** 2..14 (ace high). */
export function rankOf(card: Card): number {
  return RANKS.indexOf(card[0]) + 2
}

export function suitOf(card: Card): string {
  return card[1]
}

export function isCard(value: unknown): value is Card {
  return typeof value === 'string' && value.length === 2 && RANKS.includes(value[0]) && SUITS.includes(value[1])
}

const SUIT_SYMBOLS: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' }

/** "A♠", "10♦" — for narration and the view. */
export function cardLabel(card: Card): string {
  return `${card[0] === 'T' ? '10' : card[0]}${SUIT_SYMBOLS[card[1]] ?? card[1]}`
}

export function cardsLabel(cards: readonly Card[]): string {
  return cards.map(cardLabel).join(' ')
}

/** Hand categories, worst to best (R-RANK-01). */
export const CATEGORIES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'] as const

/**
 * A hand's strength as a list compared element by element: the category
 * (index into CATEGORIES), then the ranks that break ties within it, most
 * important first (R-RANK-03). Higher is better.
 */
export type HandScore = number[]

export function compareScores(a: HandScore, b: HandScore): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The high card of a straight among five distinct ranks (sorted high first), or 0. R-RANK-02: A-2-3-4-5 is five-high. */
function straightHigh(ranks: number[]): number {
  if (ranks.length !== 5) return 0
  if (ranks[0] - ranks[4] === 4) return ranks[0]
  if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) return 5
  return 0
}

/** The score of exactly five cards. */
export function scoreFive(cards: readonly Card[]): HandScore {
  const ranks = cards.map(rankOf).sort((a, b) => b - a)
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]))
  const distinct = [...new Set(ranks)]
  const straight = straightHigh(distinct)
  // Ranks grouped by how often they appear: most copies first, then highest.
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const byGroup = groups.map(([rank]) => rank)
  const shape = groups.map(([, n]) => n).join('')

  if (straight && flush) return [8, straight]
  if (shape === '41') return [7, ...byGroup]
  if (shape === '32') return [6, ...byGroup]
  if (flush) return [5, ...ranks]
  if (straight) return [4, straight]
  if (shape === '311') return [3, ...byGroup]
  if (shape === '221') return [2, ...byGroup]
  if (shape === '2111') return [1, ...byGroup]
  return [0, ...ranks]
}

export interface BestHand {
  score: HandScore
  /** The five cards that make it, ordered by importance (the pair before its kickers, a straight high to low). */
  cards: Card[]
}

/** Orders five cards for display the way their score reads: groups first, then high to low; a wheel ends with its ace. */
function orderForDisplay(cards: readonly Card[], score: HandScore): Card[] {
  const count = (card: Card) => cards.filter((c) => rankOf(c) === rankOf(card)).length
  const wheel = (score[0] === 4 || score[0] === 8) && score[1] === 5
  const value = (card: Card) => (wheel && rankOf(card) === 14 ? 1 : rankOf(card))
  return [...cards].sort((a, b) => count(b) - count(a) || value(b) - value(a) || SUITS.indexOf(suitOf(b)) - SUITS.indexOf(suitOf(a)))
}

/** R-RANK-01: the best five of up to seven cards. */
export function bestHand(cards: readonly Card[]): BestHand {
  if (cards.length < 5) throw new Error(`bestHand needs at least five cards, got ${cards.length}.`)
  let best: BestHand | null = null
  const n = cards.length
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a], cards[b], cards[c], cards[d], cards[e]]
            const score = scoreFive(five)
            if (!best || compareScores(score, best.score) > 0) best = { score, cards: five }
          }
  return { score: best!.score, cards: orderForDisplay(best!.cards, best!.score) }
}

const RANK_NAMES: Record<number, [string, string]> = {
  2: ['Two', 'Twos'],
  3: ['Three', 'Threes'],
  4: ['Four', 'Fours'],
  5: ['Five', 'Fives'],
  6: ['Six', 'Sixes'],
  7: ['Seven', 'Sevens'],
  8: ['Eight', 'Eights'],
  9: ['Nine', 'Nines'],
  10: ['Ten', 'Tens'],
  11: ['Jack', 'Jacks'],
  12: ['Queen', 'Queens'],
  13: ['King', 'Kings'],
  14: ['Ace', 'Aces'],
}

const one = (rank: number) => RANK_NAMES[rank][0]
const many = (rank: number) => RANK_NAMES[rank][1]

/** "a pair of Kings", "a full house, Queens over Fives" — for narration and the view. */
export function handName(score: HandScore): string {
  const [category, a, b] = score
  switch (category) {
    case 8:
      return a === 14 ? 'a royal flush' : `a straight flush, ${one(a)} high`
    case 7:
      return `four of a kind, ${many(a)}`
    case 6:
      return `a full house, ${many(a)} over ${many(b)}`
    case 5:
      return `a flush, ${one(a)} high`
    case 4:
      return `a straight, ${one(a)} high`
    case 3:
      return `three of a kind, ${many(a)}`
    case 2:
      return `two pair, ${many(a)} and ${many(b)}`
    case 1:
      return `a pair of ${many(a)}`
    default:
      return `${one(a)} high`
  }
}

export interface Pot {
  amount: number
  eligible: PlayerId[]
}

/**
 * R-POT-02: the main pot and side pots, from what everyone put in over the
 * hand (`contributions`, folded players included) and who is still in it
 * (`contenders`). Each distinct contribution among the contenders closes a
 * pot; the last one sweeps up everything above it. Empty pots are dropped.
 */
export function buildPots(contributions: Record<PlayerId, number>, contenders: readonly PlayerId[]): Pot[] {
  const levels = [...new Set(contenders.map((id) => contributions[id] ?? 0))].filter((n) => n > 0).sort((a, b) => a - b)
  const pots: Pot[] = []
  let previous = 0
  levels.forEach((level, i) => {
    const cap = i === levels.length - 1 ? Infinity : level
    let amount = 0
    for (const c of Object.values(contributions)) amount += Math.max(0, Math.min(c, cap) - previous)
    if (amount > 0) pots.push({ amount, eligible: contenders.filter((id) => (contributions[id] ?? 0) >= level) })
    previous = level
  })
  return pots
}

/** Groups digits by hand ("12,500") so the text is identical in every runtime (no toLocaleString). */
export function formatChips(amount: number): string {
  const sign = amount < 0 ? '−' : ''
  return `${sign}${String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}
