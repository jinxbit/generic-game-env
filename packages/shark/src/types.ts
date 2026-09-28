// Data types for Shark. RULES.md (next to this package's README) is the
// source of truth; its rule ids are cited in comments.
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions, so every relative import in the graph must carry an
// explicit `.ts` extension.

export type PlayerId = string

/** The four marker / share colours. */
export type Colour = 'blue' | 'green' | 'red' | 'yellow'

/** A face of the colour die — white lets the player choose (RULES.md AMBIG-1). */
export type ColourFace = Colour | 'white'

/** Creation-time options (`games.settings.gameOptions`), normalized by normalizeGameOptions. */
export interface GameOptions {
  /** Cash each player starts with, in F.T. The rulebook says 0 (R-SETUP-01). */
  startingCash: number
}

/**
 * The turn's step — also `GameState.phase`:
 * - `preTrade`: the turn player may buy/sell, then must roll (R-TURN-01/02);
 * - `place`: the dice are rolled, the turn player must place (R-TURN-03);
 * - `debts`: players who can't pay a fall choose which shares to sell (R-DEBT-02);
 * - `postTrade`: the turn player may buy/sell, then ends the turn (R-TURN-04);
 * - `ended`: the game is over (R-END-01).
 */
export type Step = 'preTrade' | 'place' | 'debts' | 'postTrade' | 'ended'

export interface PlayerData {
  /** F.T. Negative only while a forced sale is owed (R-DEBT-01), or at the end (R-END-02). */
  cash: number
  shares: Record<Colour, number>
}

export interface Roll {
  colour: ColourFace
  /** 1–6. */
  zone: number
}

/** Money that changed hands in one placement, for the log and the view. */
export interface Payment {
  playerId: PlayerId
  /** Positive: paid by the bank. Negative: owed to the bank. */
  amount: number
  reason: 'placement' | 'dividend' | 'fall'
  colour: Colour
}

/** What the last placement did. */
export interface PlacementResult {
  playerId: PlayerId
  cell: number
  colour: Colour
  /** Size of the group the new marker belongs to. */
  groupSize: number
  /** Boxes cleared by elimination (R-PLACE-05). */
  eliminated: { cell: number; colour: Colour }[]
  pricesBefore: Record<Colour, number>
  pricesAfter: Record<Colour, number>
  payments: Payment[]
}

/** A forced sale, for the log. */
export interface ForcedSale {
  playerId: PlayerId
  colour: Colour
  count: number
  proceeds: number
}

export type EndReason = { kind: 'priceCap'; colour: Colour } | { kind: 'markersExhausted'; colour: Colour }

/** The game-specific slice of GameState (`GameState.game`). */
export interface GameData {
  /** 120 boxes, `row * COLS + col`; null when empty. */
  board: (Colour | null)[]
  /** Markers not yet placed, per colour (R-PLACE-06). */
  supply: Record<Colour, number>
  /** Price level 0–15, per colour (§4). */
  prices: Record<Colour, number>
  /** Shares the bank still holds, per colour. */
  bank: Record<Colour, number>
  players: Record<PlayerId, PlayerData>
  /** Seat order at genesis — never shrinks. */
  seatOrder: PlayerId[]
  /** Whose turn it is (the turn player keeps it through a `debts` step). */
  turnPlayerId: PlayerId | null
  step: Step
  /** This turn's dice, once rolled. */
  roll: Roll | null
  /** The most recent roll, kept after the turn moves on so a missed turn stays visible (R-TURN-03). */
  lastRoll: (Roll & { playerId: PlayerId; missed: boolean }) | null
  /** Shares bought so far this turn (R-SHARE-02). */
  boughtThisTurn: number
  /** Players who still owe a forced sale and have a choice to make (R-DEBT-02). */
  debtors: PlayerId[]
  lastPlacement: PlacementResult | null
  /** Forced sales settled automatically by the most recent action (R-DEBT-03). */
  autoSales: ForcedSale[]
  /** Write-offs from the most recent action, per player (AMBIG-6). */
  writeOffs: Record<PlayerId, number>
  endReason: EndReason | null
  /** Wealth per player at the end (R-END-02). */
  finalWealth: Record<PlayerId, number> | null
}

export interface BuyAction {
  type: 'BUY'
  playerId: PlayerId
  colour: Colour
  count: number
}

export interface SellAction {
  type: 'SELL'
  playerId: PlayerId
  colour: Colour
  count: number
}

export interface RollAction {
  type: 'ROLL'
  playerId: PlayerId
}

export interface PlaceAction {
  type: 'PLACE'
  playerId: PlayerId
  /** `row * COLS + col`. */
  cell: number
  /** The marker colour — must be the rolled colour unless the die shows white. */
  colour: Colour
}

/** A debtor's forced sale at half price (R-DEBT-01/02). */
export interface ForcedSellAction {
  type: 'FORCED_SELL'
  playerId: PlayerId
  colour: Colour
  count: number
}

export interface EndTurnAction {
  type: 'END_TURN'
  playerId: PlayerId
}

export type GameAction = BuyAction | SellAction | RollAction | PlaceAction | ForcedSellAction | EndTurnAction
