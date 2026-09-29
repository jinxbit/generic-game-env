// Vernissage's components and the pure helpers that read them — the board's
// numbers, the decks, influence, fame values and assets. RULES.md is the
// source of truth; most numbers here are choices the translated rulebook
// leaves open, each an AMBIG entry there.
//
// Pure: imported by the Edge Functions, so relative imports keep their `.ts`.

import type { ArtistData, ArtistId, Card, CounterKind, FateFace, GameData, PlayerId } from './types.ts'

export const ARTISTS: readonly ArtistId[] = ['krach', 'boyz', 'kali', 'hering', 'lightenstone']

export const ARTIST_NAMES: Record<ArtistId, string> = {
  krach: 'Elfrieda Krach',
  boyz: 'Joe Boyz',
  kali: 'Donna Salva Kali',
  hering: 'Karl Hering',
  lightenstone: 'Ron Lightenstone',
}

export const COUNTER_KINDS: readonly CounterKind[] = ['purchase', 'criticism', 'scandal']

/** AMBIG-1: the top step of the success staircase. Artists start on step 1. */
export const TOP_STEP = 10

/** AMBIG-2 / R-FAME-01..03: the scale of fame. */
export const FAME_START = 16
export const FAME_MAX = 27
export const IN_FROM = 24
/** R-IN-03: the first space outside the IN region. */
export const AFTER_IN = IN_FROM - 1

/** AMBIG-3: counter values run 1..max for each kind, two of each. */
export const COUNTER_MAX: Record<CounterKind, number> = { purchase: 7, criticism: 6, scandal: 6 }
export const COUNTER_COPIES = 2

/** AMBIG-4. */
export const FATE_DIE: readonly FateFace[] = ['purchase', 'purchase', 'criticism', 'scandal', 'wild', 'minus']

/** AMBIG-7: the seven brown piles' prices, and their size. */
export const PILE_PRICES: readonly number[] = [10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000]
export const PILE_SIZE = 7
export const GREY_PRICE = 10_000
export const HAND_SIZE = 3

export const STARTING_CASH = 200_000
/** R-BUY-04. */
export const LOAN = 100_000
export const NOTE_COST = 150_000
/** R-OUT-02. */
export const OUT_PENALTY = 100_000

/** R-CRITIC-02/03. */
export const FEATHER_PENALTY = 5
/** R-VERN-02. */
export const GREAT_VERNISSAGE = 12
export const SMALL_VERNISSAGE = 6
/** R-TRIAL-06. */
export const VARIANT_THRESHOLD = 14

/** The brown deck (§1): 7 works per artist, 23 might, 13 critic, 11 unlimited step change. Ids 0–81. */
export function brownDeck(): Card[] {
  const cards: Card[] = []
  for (const artist of ARTISTS) for (let i = 0; i < 7; i++) cards.push({ id: cards.length, kind: 'work', artist })
  for (let i = 0; i < 23; i++) cards.push({ id: cards.length, kind: 'might' })
  for (let i = 0; i < 13; i++) cards.push({ id: cards.length, kind: 'critic' })
  for (let i = 0; i < 11; i++) cards.push({ id: cards.length, kind: 'unlimited' })
  return cards
}

/** The grey deck (AMBIG-5): 8 × 1, 8 × 2, 7 × 3. Ids 100–122. */
export function greyDeck(): Card[] {
  const steps = [...Array(8).fill(1), ...Array(8).fill(2), ...Array(7).fill(3)] as number[]
  return steps.map((n, i) => ({ id: 100 + i, kind: 'limited', steps: n }))
}

/** A fresh counter pool (AMBIG-3). */
export function fullPool(): Record<CounterKind, number[]> {
  return { purchase: Array(COUNTER_MAX.purchase).fill(COUNTER_COPIES), criticism: Array(COUNTER_MAX.criticism).fill(COUNTER_COPIES), scandal: Array(COUNTER_MAX.scandal).fill(COUNTER_COPIES) }
}

/** R-FAME-01: what a work is worth with its artist's marker on `space`. */
export function fameValue(space: number): number {
  return (space - 6) * 10_000
}

/** R-FATE-05: how far a counter moves the fame marker. */
export function counterWorth(kind: CounterKind, value: number): number {
  return kind === 'purchase' ? value : -value
}

/** R-FATE-02/03: the kinds a face lets the player take, given what's left in the pool. */
export function allowedKinds(game: GameData, face: FateFace): CounterKind[] {
  const available = COUNTER_KINDS.filter((k) => game.pool[k].some((n) => n > 0))
  const byFace: CounterKind[] = face === 'wild' ? [...COUNTER_KINDS] : face === 'minus' ? ['criticism', 'scandal'] : [face]
  const allowed = byFace.filter((k) => available.includes(k))
  return allowed.length > 0 ? allowed : available
}

export function availableValues(game: GameData, kind: CounterKind): number[] {
  return game.pool[kind].flatMap((n, i) => (n > 0 ? [i + 1] : []))
}

/** R-INF-01. */
export function hasInfluence(game: GameData, playerId: PlayerId, artist: ArtistId): boolean {
  const a = game.artists[artist]
  const p = game.players[playerId]
  return !!p && !a.out && p.agents.includes(a.step)
}

/** The artists `playerId` has influence over. */
export function influencedArtists(game: GameData, playerId: PlayerId): ArtistId[] {
  return ARTISTS.filter((artist) => hasInfluence(game, playerId, artist))
}

/** R-FATE-04: the step the next counter in front of `artist` stands on. */
export function nextCounterStep(a: ArtistData): number {
  return a.step + a.counters.length + 1
}

/** R-VERN-02: 1 + the artists still in the game on a higher step. */
export function positionOf(game: GameData, artist: ArtistId): number {
  const step = game.artists[artist].step
  return 1 + ARTISTS.filter((other) => other !== artist && !game.artists[other].out && game.artists[other].step > step).length
}

/** Whether the counters in front of an artist hold all three kinds (R-EFFECT-02). */
export function hasAllKinds(a: ArtistData): boolean {
  return COUNTER_KINDS.every((k) => a.counters.some((c) => c.kind === k))
}

/** Every work `playerId` owns that the viewer can see (hidden ones included in the true state). */
export function worksOf(game: GameData, playerId: PlayerId): Card[] {
  const p = game.players[playerId]
  return [...p.shown, ...p.hand.filter((c): c is Card => c !== null && c.kind === 'work')]
}

/** What one work of `artist` is worth right now (R-END-02). */
export function workValue(game: GameData, artist: ArtistId): number {
  const a = game.artists[artist]
  return a.out ? -OUT_PENALTY : fameValue(a.fame)
}

/** R-END-02: cash, plus works, minus notes. */
export function assetsOf(game: GameData, playerId: PlayerId): number {
  const p = game.players[playerId]
  if (!p) return 0
  const works = worksOf(game, playerId).reduce((total, card) => total + (card.kind === 'work' ? workValue(game, card.artist) : 0), 0)
  return p.cash + works - p.notes * NOTE_COST
}

/** Whether any card can be bought (R-BUY-05). */
export function canBuyAny(game: GameData): boolean {
  return game.piles.some((pile) => pile.length > 0) || game.greyDeck.length + game.greyDiscard.length > 0
}

/** "120 000 Rubens" — formatted by hand so the text is identical in every runtime. */
export function formatRubens(amount: number): string {
  const sign = amount < 0 ? '−' : ''
  return `${sign}${String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Rubens`
}

export function cardName(card: Card): string {
  switch (card.kind) {
    case 'work':
      return `a work by ${ARTIST_NAMES[card.artist]}`
    case 'might':
      return 'a might card'
    case 'critic':
      return 'a critic card'
    case 'unlimited':
      return 'an unlimited step change'
    case 'limited':
      return `a step change (${card.steps})`
  }
}

export function counterLabel(kind: CounterKind, value: number): string {
  const worth = counterWorth(kind, value)
  return `${kind} ${worth > 0 ? '+' : '−'}${Math.abs(worth)}`
}
