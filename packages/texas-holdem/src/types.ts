// Data types for Texas Hold'em. RULES.md (next to this package's README) is
// the source of truth; its rule ids are cited in comments.
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions, so every relative import in the graph must carry an
// explicit `.ts` extension.

export type PlayerId = string

/**
 * A card as two characters: rank (`23456789TJQKA`) then suit (`cdhs`), e.g.
 * `'As'` is the ace of spades and `'Td'` the ten of diamonds.
 */
export type Card = string

/** Creation-time options (`games.settings.gameOptions`), normalized by normalizeGameOptions (RULES.md §8). */
export interface GameOptions {
  /** R-SETUP-01. */
  startingStack: number
  /** R-BLIND-01: the first level's big blind. Even, so the small blind is exactly half. */
  bigBlind: number
  /** R-BLIND-01: hands per blind level; 0 keeps the blinds fixed. */
  blindsDoubleEvery: number
  /** R-END-03: hands before the game ends on chip count; 0 plays to the last player standing. */
  maxHands: number
}

/** A betting round (R-HAND-02) — also `GameState.phase`. */
export type Street = 'preflop' | 'flop' | 'turn' | 'river'

/** Where the game is: a street of the current hand, or `ended`. */
export type Step = Street | 'ended'

export interface PlayerData {
  /** Chips behind — not counting what's already bet this hand. */
  stack: number
  /**
   * Hole cards for the current hand: two cards, `[]` for a player not dealt
   * in. A redacted view shows another player's as `null`s (redactGame).
   */
  hole: (Card | null)[]
  /** `in`: contesting the hand. `folded`. `out`: not dealt into this hand (busted or left). */
  status: 'in' | 'folded' | 'out'
  /** Chips put in on the current street. */
  committed: number
  /** Chips put in over the whole hand (the pots are built from these). */
  contributed: number
  /**
   * The bet level of the last full bet or raise (`GameData.lastFullBet`) when
   * this player last acted on this street, or null if they haven't acted —
   * what R-BET-04 (may they raise?) and R-BET-06 (must they act?) read.
   */
  actedAt: number | null
  /** The hand this player ran out of chips in (R-END-01), or null. Busted players are `eliminated` on the envelope. */
  bustedInHand: number | null
}

/** One pot as the hand settled it. */
export interface PotResult {
  amount: number
  /** Who could win it (R-POT-02). */
  eligible: PlayerId[]
  winners: PlayerId[]
  /** The winning hand's name at a showdown; null when uncontested. */
  handName: string | null
}

export interface ShownHand {
  hole: Card[]
  /** The best five cards (R-RANK-01), best-first. */
  best: Card[]
  handName: string
}

/** What happened at the end of the last finished hand — public, kept until the next one ends (AMBIG-3). */
export interface HandResult {
  hand: number
  board: Card[]
  /** Whether it went to a showdown (else everyone else folded, R-HAND-04). */
  showdown: boolean
  /** R-SHOW-01: the hole cards shown at a showdown, by player. Empty when uncontested. */
  shown: Record<PlayerId, ShownHand>
  pots: PotResult[]
  /** Chips each player collected from the pots. */
  won: Record<PlayerId, number>
  /** R-POT-01: an uncalled bet handed back, if any. */
  returned: { playerId: PlayerId; amount: number } | null
  /** Players who ran out of chips in this hand (R-END-01). */
  busted: PlayerId[]
}

export interface GameData {
  /** Every seated player, in seat order (never shrinks). */
  seatOrder: PlayerId[]
  players: Record<PlayerId, PlayerData>
  step: Step
  /** The current hand's number, from 1 — also `GameState.turn`. */
  hand: number
  buttonId: PlayerId | null
  smallBlindId: PlayerId | null
  bigBlindId: PlayerId | null
  /** This hand's blinds (R-BLIND-01). */
  blinds: { small: number; big: number }
  board: Card[]
  /** Who must act now, or null (the game is over). */
  toActId: PlayerId | null
  /** The highest total anyone has to match on this street. */
  currentBet: number
  /** R-BET-03: the size of the last full bet or raise on this street. */
  minRaise: number
  /** R-BET-04: the bet level the last full bet or raise set on this street. */
  lastFullBet: number
  lastHand: HandResult | null
  /**
   * Log lines this action produced beyond its own headline — streets dealt,
   * showdowns, pots won, a new hand. Reset at the start of every action; all
   * public (no hole card appears here except one shown at a showdown).
   */
  journal: string[]
  /** Why the game ended (R-END-02/03), once it has. */
  endReason: 'lastStanding' | 'handLimit' | null
}

export interface FoldAction {
  type: 'FOLD'
  playerId: PlayerId
}

export interface CheckAction {
  type: 'CHECK'
  playerId: PlayerId
}

export interface CallAction {
  type: 'CALL'
  playerId: PlayerId
}

/** R-BET-01: bet, or raise, to `amount` in total on this street (not "by"). */
export interface BetAction {
  type: 'BET'
  playerId: PlayerId
  amount: number
}

export type GameAction = FoldAction | CheckAction | CallAction | BetAction
