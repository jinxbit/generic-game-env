// Data types for Vernissage. RULES.md (next to this package's README) is the
// source of truth; its rule ids are cited in comments.
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions, so every relative import in the graph must carry an
// explicit `.ts` extension.

export type PlayerId = string

export type ArtistId = 'krach' | 'boyz' | 'kali' | 'hering' | 'lightenstone'

/** The three kinds of fate counter (R-FATE-02). */
export type CounterKind = 'purchase' | 'criticism' | 'scandal'

/** A face of the fate die (AMBIG-4). */
export type FateFace = CounterKind | 'wild' | 'minus'

/** Creation-time options (`games.settings.gameOptions`), normalized by normalizeGameOptions. */
export interface GameOptions {
  /** The rulebook's variant: a Trial total of 14+ costs one committed might card (R-TRIAL-06). */
  mightVariant: boolean
}

export type Card =
  | { id: number; kind: 'work'; artist: ArtistId }
  | { id: number; kind: 'might' }
  | { id: number; kind: 'critic' }
  | { id: number; kind: 'unlimited' }
  | { id: number; kind: 'limited'; steps: number }

/** A card, or null where the viewer may not see it (redactGame). */
export type CardSlot = Card | null

/** A fate counter. `value` is its size, 1–7; criticism and scandal count negative (R-FATE-05). */
export interface Counter {
  kind: CounterKind
  value: number
}

export interface ArtistData {
  /** Staircase step, 1–TOP_STEP (§7.1). */
  step: number
  /** Counters in front of the artist, lowest step first: counter `i` stands on step `step + i + 1`. */
  counters: Counter[]
  /** Scale-of-fame space (§7.2); 0 once OUT. */
  fame: number
  out: boolean
}

export interface PlayerData {
  cash: number
  /** Promissory notes taken (R-BUY-04). */
  notes: number
  /** Three agents: a step, or null while in reserve (R-SETUP-03). */
  agents: (number | null)[]
  /** Cards in hand. Other players' entries are null in a redacted view. */
  hand: CardSlot[]
  /** Works shown face up (R-IN-02). */
  shown: Card[]
}

/**
 * The turn's step — also `GameState.phase`:
 * - `fate`: the turn player rolls the fate die (R-FATE-01);
 * - `place`: they place a counter (R-FATE-04);
 * - `objections`: the others with influence accept or object (R-OBJ-01);
 * - `negotiate`: the placer agrees to a proposal or refuses (R-OBJ-03);
 * - `challenge`: objectors decide whether to call a Trial (R-OBJ-04);
 * - `trial`: might cards are committed (R-TRIAL-01);
 * - `display`: an artist went IN, everyone may show works (R-IN-01);
 * - `buy`: the turn player buys a card (R-BUY-01);
 * - `choose`: they pick a card from the pile they bought (R-BUY-02);
 * - `play`: they may play cards, then end the turn (§9);
 * - `ended`: the game is over (§10).
 */
export type Step = 'fate' | 'place' | 'objections' | 'negotiate' | 'challenge' | 'trial' | 'display' | 'buy' | 'choose' | 'play' | 'ended'

/** A placed counter that others have influence to object to (§6). */
export interface Dispute {
  artist: ArtistId
  /** The counter as placed, not yet in `artists[artist].counters`. */
  counter: Counter
  /** Who may object (R-OBJ-01), in seat order. */
  objectors: PlayerId[]
  /** Each answer so far: null to accept, a value to object with that proposal. */
  responses: Record<PlayerId, number | null>
  /** After a refusal (R-OBJ-04): each objector's decision so far. */
  challenges: Record<PlayerId, boolean> | null
}

/** A Trial of Strength in progress (R-TRIAL-01). */
export interface Trial {
  contras: PlayerId[]
  /** Might cards committed so far, face up, per participant. */
  might: Record<PlayerId, Card[]>
  side: 'contra' | 'pro'
  round: number
  /** Who still has to commit this round. */
  awaiting: PlayerId[]
  /** Cards added so far this round. */
  added: number
}

/** A dice roll-off's record, for the log and the view. */
export interface TrialResult {
  artist: ArtistId
  winner: 'pro' | 'contra'
  pro: PlayerId
  rolls: { playerId: PlayerId; might: number; dice: [number, number][] }[]
  /** Might cards discarded under the variant (R-TRIAL-06). */
  discarded: PlayerId[]
}

/** An artist went IN; everyone decides what to show (R-IN-01). */
export interface Display {
  artist: ArtistId
  /** The value of each IN space reached (R-IN-04). */
  values: number[]
  awaiting: PlayerId[]
  /** What follows the payment: the buy step, the game's end, or (the turn player left) the next turn. */
  then: 'buy' | 'end' | 'next'
}

export type EndReason = 'topCounter' | 'topArtist' | 'twoOut' | 'noCounters'

/** The game-specific slice of GameState (`GameState.game`). */
export interface GameData {
  artists: Record<ArtistId, ArtistData>
  /** Available counters: `pool[kind][value - 1]` of each. */
  pool: Record<CounterKind, number[]>
  /** The artist carrying the critic's feather. */
  feather: ArtistId | null
  players: Record<PlayerId, PlayerData>
  /** The seven brown piles, top first (R-SETUP-05). */
  piles: CardSlot[][]
  /** Brown cards set aside unseen (AMBIG-8). */
  aside: CardSlot[]
  greyDeck: CardSlot[]
  /** Played grey cards, public, reshuffled when the deck runs out (R-BUY-03). */
  greyDiscard: Card[]
  seatOrder: PlayerId[]
  turnPlayerId: PlayerId | null
  step: Step
  /** This turn's fate die face, once rolled. */
  fate: FateFace | null
  dispute: Dispute | null
  trial: Trial | null
  display: Display | null
  /** The pile being chosen from (step `choose`). */
  choosing: number | null
  /** Whether this turn's step change card is played (R-PLAY-01). */
  stepCardPlayed: boolean
  lastTrial: TrialResult | null
  /** Public narration of what the last action set off, `⟦id⟧` naming a player. */
  journal: string[]
  endReason: EndReason | null
  /** Assets per player at the end (R-END-02). */
  finalAssets: Record<PlayerId, number> | null
}

export interface RollFateAction {
  type: 'ROLL_FATE'
  playerId: PlayerId
}

export interface PlaceCounterAction {
  type: 'PLACE_COUNTER'
  playerId: PlayerId
  artist: ArtistId
  kind: CounterKind
  value: number
}

/** R-OBJ-01: `value` null accepts; a value objects and proposes it. */
export interface RespondAction {
  type: 'RESPOND'
  playerId: PlayerId
  value: number | null
}

/** R-OBJ-03: `value` agrees to that proposal; null refuses them all. */
export interface NegotiateAction {
  type: 'NEGOTIATE'
  playerId: PlayerId
  value: number | null
}

export interface ChallengeAction {
  type: 'CHALLENGE'
  playerId: PlayerId
  challenge: boolean
}

export interface CommitMightAction {
  type: 'COMMIT_MIGHT'
  playerId: PlayerId
  count: number
}

export interface DisplayAction {
  type: 'DISPLAY'
  playerId: PlayerId
  count: number
}

export interface BuyPileAction {
  type: 'BUY_PILE'
  playerId: PlayerId
  /** 0–6. */
  pile: number
}

export interface BuyGreyAction {
  type: 'BUY_GREY'
  playerId: PlayerId
}

export interface TakeCardAction {
  type: 'TAKE_CARD'
  playerId: PlayerId
  /** A card of the pile being chosen from, or null to take none. */
  cardId: number | null
}

export interface PlayUnlimitedAction {
  type: 'PLAY_UNLIMITED'
  playerId: PlayerId
  cardId: number
  /** Where each of the three agents ends up (null: stays in reserve). */
  agents: (number | null)[]
}

export interface PlayLimitedAction {
  type: 'PLAY_LIMITED'
  playerId: PlayerId
  cardId: number
  /** Which agent, 0–2. */
  agent: number
  to: number
}

export interface PlayCriticAction {
  type: 'PLAY_CRITIC'
  playerId: PlayerId
  cardId: number
  artist: ArtistId
}

export interface EndTurnAction {
  type: 'END_TURN'
  playerId: PlayerId
}

export type GameAction =
  | RollFateAction
  | PlaceCounterAction
  | RespondAction
  | NegotiateAction
  | ChallengeAction
  | CommitMightAction
  | DisplayAction
  | BuyPileAction
  | BuyGreyAction
  | TakeCardAction
  | PlayUnlimitedAction
  | PlayLimitedAction
  | PlayCriticAction
  | EndTurnAction
