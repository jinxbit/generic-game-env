// Data types for Incorporated (RULES.md §1). The rules live in ./rules.ts and
// the modules it pulls in; this file is types only.
//
// The engine is a small task machine (./engine.ts): `GameData.queue` holds
// the steps still to run this phase, and `GameData.prompt` the one decision
// the game is waiting on — an auction bid, a Big Brother choice, a
// repayment. Every action answers the current prompt (or is a loan, which a
// player may take whenever loans are allowed), then the queue runs on until
// it needs the next decision. `pendingPlayerIds` is always derived from the
// prompt.
//
// Keep this module pure data: it's imported by the Edge Functions.

import type { Camp, Industry, ZoneId } from './data/board.ts'
import type { CorporationId } from './data/corporations.ts'
import type { OutlookEffect } from './data/outlookCards.ts'
import type { Sliders } from './sliders.ts'

export type { Camp, Industry, ZoneId } from './data/board.ts'
export type { CorporationId } from './data/corporations.ts'
export type { OutlookEffect, SliderId } from './data/outlookCards.ts'
export type { Sliders } from './sliders.ts'
export type { GameState } from './context.ts'

export type PlayerId = string
export type CountryId = string

/** ⚑ R3_SALES_MODE (§11). */
export type R3SalesMode = 'normal' | 'reverseOnly' | 'banned'

/** The 10th-anniversary variant toggles (RULES.md §11), all off by default. */
export interface GameOptions {
  threeRounds: boolean
  /** Requires threeRounds ([AMBIG-16]); normalizeOptions drops it otherwise. */
  freeCubes: boolean
  r3SalesMode: R3SalesMode
  /** R3_SALES_MODE sub-option: round-3 free cubes cut to 1. */
  r3FreeCubesOne: boolean
  dontStall: boolean
  lessCruelLoans: boolean
  accumRd: boolean
  closedAuctionSco: boolean
  qeHyperinflation: boolean
  factionTweaks: boolean
}

export type PhaseId = 'outlook' | 'investment' | 'competition' | 'lobbying' | 'earnings' | 'ended'

export type Affiliation = Camp | 'BATTLEGROUND' | 'NONE'

export interface SquareState {
  /** A player id, 'LOCK' for a black lock cube, or null when empty. */
  occupant: PlayerId | 'LOCK' | null
  /** ⚑ ACCUM_RD: counts double and can't be removed or flipped. */
  fortified: boolean
}

export interface CountryState {
  affiliation: Affiliation
  squares: SquareState[]
  /** Non-occupying cubes (§7). */
  loose: Record<PlayerId, number>
  /** Executives defending here this Competition (R-COMP-07). */
  defenders: Record<PlayerId, number>
}

export interface SquareRef {
  country: CountryId
  square: number
}

export type AbilityId = 'gsCrisis' | 'bbOutlook' | 'omLobbyFirst' | 'fdLastExecutive'

export interface CorpPlayer {
  corp: CorporationId
  /** Private (§1.1): null in another player's redacted view. */
  cash: number | null
  bonds: number
  /** By major country id. */
  shares: Record<CountryId, number>
  /** Cubes not on the board. */
  supply: number
  /** Executives in the pool right now. */
  executives: number
  /** Executives this player owns — the pool refills to this after every phase (R-TURN-02). */
  executiveCount: number
  /** Killed executives waiting in Tax Havens until the phase ends (R-COMP-05). */
  parkedExecutives: number
  /** ⚑ FACTION_TWEAKS once-per-game abilities already spent. */
  abilitiesUsed: Partial<Record<AbilityId, boolean>>
}

/** A cube a player gives up: one occupying a square, or one loose in a country. */
export type CubeRef = { country: CountryId; square: number } | { country: CountryId; loose: true }

export type KillTarget = { kind: 'loose'; playerId: PlayerId } | { kind: 'defender'; playerId: PlayerId } | { kind: 'square'; square: number }

export type Attack = { kind: 'grab'; country: CountryId; square: number } | { kind: 'kill'; country: CountryId; target: KillTarget }

export interface Move {
  from: CountryId
  to: CountryId
}

export type LobbyEvent =
  | { kind: 'powerPlay'; zone: ZoneId; camp: Camp }
  | { kind: 'taxHavens' }
  | { kind: 'centralBanks'; slider: 'interest' | 'stress'; direction: 1 | -1 }
  | { kind: 'budget'; mode: 'austerity'; discardIndex?: number }
  | { kind: 'budget'; mode: 'stimulus' }
  | { kind: 'rd'; country: CountryId; square: number }
  | { kind: 'subsidies' }

/** An auction in progress — open buy, reverse sell, or private sale (§5). */
export interface AuctionPrompt {
  kind: 'auction'
  mode: 'public' | 'reverse' | 'private'
  country: CountryId
  /** Public: the initiator. Reverse: the buyer. Private: the seller. */
  ownerId: PlayerId
  /** Everyone still in, in clockwise order from where bidding started. */
  active: PlayerId[]
  /** Whose bid it is. */
  current: PlayerId
  /** The standing bid, if any. */
  high: { playerId: PlayerId; amount: number } | null
  /** Reverse: bids must be below this (the buy price). Private: the minimum. Public: unused. */
  limit: number
  /** The executive's auction was opened by (public) — for CLOSED_AUCTION_SCO's NATO +$1. */
  initiatorId: PlayerId
}

export type Prompt =
  | { kind: 'investTurn'; playerId: PlayerId }
  | AuctionPrompt
  | { kind: 'sealedAuction'; auctionId: number; country: CountryId; initiatorId: PlayerId; bids: Record<PlayerId, number | null>; submitted: PlayerId[] }
  | { kind: 'sealedTie'; playerId: PlayerId; country: CountryId; tied: PlayerId[]; amount: number }
  | { kind: 'closedSell'; playerId: PlayerId; country: CountryId; price: number }
  | { kind: 'chooseSquare'; playerId: PlayerId; reason: 'placeBought' | 'replaceSeller' | 'takeUnlocked'; country: CountryId; options: number[]; optional: boolean; sellerId?: PlayerId }
  | { kind: 'removeCubes'; playerId: PlayerId; reason: 'sold' | 'saleCost'; country: CountryId; count: number; options: CubeRef[] }
  | { kind: 'freeAttack'; playerId: PlayerId; country: CountryId }
  | { kind: 'income'; playerId: PlayerId; available: number }
  | { kind: 'competitionTurn'; playerId: PlayerId }
  | { kind: 'lobbyTurn'; playerId: PlayerId; mustPowerPlay: boolean; canDefer: boolean }
  | { kind: 'moveMarker'; playerId: PlayerId; zone: ZoneId; options: CountryId[] }
  | { kind: 'subsidies'; playerId: PlayerId; peek: (Industry | null)[] }
  | { kind: 'stimulus'; playerId: PlayerId; drawn: (Industry | null)[] }
  | { kind: 'outlookChoice'; playerId: PlayerId; effect: OutlookEffect; options: (string | number)[] }
  | { kind: 'useAbility'; playerId: PlayerId; ability: 'bbOutlook' | 'omLobbyFirst' }
  | { kind: 'pickOutlook'; playerId: PlayerId; drawn: (string | null)[] }
  | { kind: 'crisisDecision'; playerId: PlayerId; roll: number; difficulty: number }
  | { kind: 'crisisDiscard'; playerId: PlayerId; count: number }
  | { kind: 'repayment'; promptId: number; waiting: PlayerId[]; decisions: Record<PlayerId, number | null>; bigBrotherLast: PlayerId | null }

/** A step still to run (./engine.ts). */
export type Task =
  | { t: 'startRound' }
  | { t: 'outlookDraw' }
  | { t: 'playOutlook'; cardId: string }
  | { t: 'effect'; effect: OutlookEffect; remaining: number }
  | { t: 'offerUnlocked'; country: CountryId; square: number }
  | { t: 'revealPayoffs' }
  | { t: 'endPhase' }
  | { t: 'startInvestment' }
  | { t: 'investmentNext' }
  | { t: 'settlePurchase'; country: CountryId; buyerId: PlayerId; price: number; initiatorId: PlayerId; closed: boolean }
  | { t: 'placeBought'; country: CountryId; playerId: PlayerId }
  | { t: 'reverseAuction'; country: CountryId; buyerId: PlayerId; price: number; initiatorId: PlayerId }
  | { t: 'removeSold'; country: CountryId; playerId: PlayerId }
  | { t: 'saleCost'; country: CountryId; playerId: PlayerId }
  | { t: 'freeCubes'; country: CountryId; playerId: PlayerId }
  | { t: 'closedSellOffer'; country: CountryId; buyerId: PlayerId; price: number; initiatorId: PlayerId }
  | { t: 'replaceSeller'; country: CountryId; buyerId: PlayerId; sellerId: PlayerId }
  | { t: 'startCompetition' }
  | { t: 'income'; playerId: PlayerId }
  | { t: 'competitionNext' }
  | { t: 'competitionCleanup' }
  | { t: 'startLobbying' }
  | { t: 'lobbyNext' }
  | { t: 'startEarnings' }
  | { t: 'crisisApply'; roll: number; difficulty: number; capIntensity: number | null }
  | { t: 'payoff' }
  | { t: 'interest' }
  | { t: 'repayment'; stage: 'all' | 'bigBrother' }
  | { t: 'endGame' }

export interface PowerPlayResult {
  playerId: PlayerId
  zone: ZoneId
  country: CountryId
  camp: Camp
  /** Null for an automatic win (R-LOB-09). */
  roll: number | null
  modified: number | null
  target: number
  success: boolean
}

export interface CrisisResult {
  round: number
  difficulty: number
  roll: number
  intensity: number
  /** ⚑ FACTION_TWEAKS: Giant Squid rerolled or declared no crisis. */
  ability?: 'reroll' | 'noCrisis'
}

export interface EarningsResult {
  round: number
  /** Payoff income by player, before interest. */
  payoff: Record<PlayerId, number>
  leaders: Partial<Record<Industry, PlayerId>>
  interest: Record<PlayerId, number>
  repaid: Record<PlayerId, number>
}

export interface FinalScore {
  squares: Record<Industry, number>
  industryCash: number
  leaderBonus: number
  bondPenalty: number
  /** Cash before end-game scoring. */
  startingCash: number
  total: number
}

/** The game-specific slice of GameState (`GameState.game`). */
export interface GameData {
  round: number
  totalRounds: number
  phase: PhaseId
  sliders: Sliders
  /** Players in the corporations' fixed play order (R-SET-09). */
  seatOrder: PlayerId[]
  players: Record<PlayerId, CorpPlayer>
  countries: Record<CountryId, CountryState>
  /** Where each zone's battleground marker is; null once removed (R-LOB-06/08). */
  battlegrounds: Record<ZoneId, CountryId | null>
  /** Null with ⚑ ACCUM_RD, which has no marker. */
  rdSquare: SquareRef | null
  /** Investment bank stock by major country (R-SET-07). */
  bank: Record<CountryId, number>
  /** Majors whose shares were discarded by a flip (R-LOB-08) — no longer auctioned. */
  retiredMajors: CountryId[]

  /** Face-down Outlook pile, top first. Only the Outlook chooser sees the top card; everything else is null to viewers. */
  outlookDeck: (string | null)[]
  /** The Outlook cards out of the game (never dealt, or discarded unplayed). Null to viewers. */
  outlookOut: (string | null)[]
  /** Played Outlook cards, oldest first — public. */
  outlookPlayed: string[]

  /** Face-down payoff deck, top first — null to viewers. */
  payoffDeck: (Industry | null)[]
  /** Face-up but not inspectable (R-GEN-01) — null to viewers. */
  payoffDiscard: (Industry | null)[]
  /** Revealed payoff cards this turn, in reveal order. */
  revealed: Industry[]

  /** Lobbying events used this turn: event key → players whose executive is on it (R-LOB-02). */
  lobbyUsed: Record<string, PlayerId[]>
  /** Competition: players who have passed (R-COMP-02). */
  passed: PlayerId[]
  /** The last player to take a turn in the current loop — the next turn goes clockwise from here. */
  cursor: PlayerId | null
  /** ⚑ FACTION_TWEAKS: Fortress Derivatives' deferred last executive this Lobbying. */
  deferredPlayerId: PlayerId | null
  /** ⚑ FACTION_TWEAKS: the pending Old Money Power-Play-first turn. */
  lobbyFirstPlayerId: PlayerId | null

  queue: Task[]
  prompt: Prompt | null
  /** Id source for prompts whose answers stay secret until they close (sealed bids, repayments). */
  nextPromptId: number

  /** ⚑ FACTION_TWEAKS: whether any crisis has happened this game (Giant Squid's no-crisis bonus). */
  crisisOccurred: boolean
  lastPowerPlay: PowerPlayResult | null
  lastCrisis: CrisisResult | null
  lastEarnings: EarningsResult | null
  finalScores: Record<PlayerId, FinalScore> | null
  /** Public narration of everything the last action set off — read by describeAction. */
  journal: string[]
}

export type TakeLoanAction = { type: 'TAKE_LOAN'; playerId: string }
export type StartAuctionAction = { type: 'START_AUCTION'; playerId: string; country: CountryId; bid?: number }
export type StartPrivateSaleAction = { type: 'START_PRIVATE_SALE'; playerId: string; country: CountryId; minPrice: number }
export type InvestPassAction = { type: 'INVEST_PASS'; playerId: string }
export type BidAction = { type: 'BID'; playerId: string; amount: number }
export type PassBidAction = { type: 'PASS_BID'; playerId: string }
export type SealedBidAction = { type: 'SEALED_BID'; playerId: string; auctionId: number; amount: number }
export type PickWinnerAction = { type: 'PICK_WINNER'; playerId: string; winnerId: string }
export type ClosedSellAction = { type: 'CLOSED_SELL'; playerId: string; sell: boolean }
export type ChooseSquareAction = { type: 'CHOOSE_SQUARE'; playerId: string; square: number | null }
export type RemoveCubesAction = { type: 'REMOVE_CUBES'; playerId: string; cubes: CubeRef[] }
export type FreeAttackAction = { type: 'FREE_ATTACK'; playerId: string; attacks: Attack[] }
export type AllocateIncomeAction = { type: 'ALLOCATE_INCOME'; playerId: string; allocation: Record<CountryId, number> }
export type FightAction = { type: 'FIGHT'; playerId: string; attacks: Attack[] }
export type DefendAction = { type: 'DEFEND'; playerId: string; country: CountryId }
export type ExpandAction = { type: 'EXPAND'; playerId: string; moves: Move[] }
export type CompetitionPassAction = { type: 'COMPETITION_PASS'; playerId: string; defenders: CountryId[] }
export type LobbyAction = { type: 'LOBBY'; playerId: string; event: LobbyEvent }
export type DeferExecutiveAction = { type: 'DEFER_EXECUTIVE'; playerId: string }
export type MoveMarkerAction = { type: 'MOVE_MARKER'; playerId: string; country: CountryId }
export type SubsidiesSwapAction = { type: 'SUBSIDIES_SWAP'; playerId: string; peekIndex: number; revealedIndex: number }
export type StimulusKeepAction = { type: 'STIMULUS_KEEP'; playerId: string; index: number }
export type OutlookChoiceAction = { type: 'OUTLOOK_CHOICE'; playerId: string; choice: string | number }
export type UseAbilityAction = { type: 'USE_ABILITY'; playerId: string; use: boolean }
export type PickOutlookAction = { type: 'PICK_OUTLOOK'; playerId: string; index: number }
export type CrisisDecisionAction = { type: 'CRISIS_DECISION'; playerId: string; decision: 'accept' | 'reroll' | 'noCrisis' }
export type CrisisDiscardAction = { type: 'CRISIS_DISCARD'; playerId: string; indices: number[] }
export type RepayAction = { type: 'REPAY'; playerId: string; promptId: number; count: number }

/** Every action this game defines. The framework adds its own (undo, redo, concede, admin mode). */
export type GameAction =
  | TakeLoanAction
  | StartAuctionAction
  | StartPrivateSaleAction
  | InvestPassAction
  | BidAction
  | PassBidAction
  | SealedBidAction
  | PickWinnerAction
  | ClosedSellAction
  | ChooseSquareAction
  | RemoveCubesAction
  | FreeAttackAction
  | AllocateIncomeAction
  | FightAction
  | DefendAction
  | ExpandAction
  | CompetitionPassAction
  | LobbyAction
  | DeferExecutiveAction
  | MoveMarkerAction
  | SubsidiesSwapAction
  | StimulusKeepAction
  | OutlookChoiceAction
  | UseAbilityAction
  | PickOutlookAction
  | CrisisDecisionAction
  | CrisisDiscardAction
  | RepayAction
