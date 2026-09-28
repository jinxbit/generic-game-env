// Data types for Kogge (RULES.md is the spec; rule ids are cited throughout).
//
// Pure data: no React, no I/O. Imported by the Edge Functions, so every
// relative import in the graph carries an explicit `.ts` extension.

export type Color = 'grey' | 'orange' | 'purple' | 'white'
export type Goods = Record<Color, number>
export type PlayerId = string
export type BonusType = 'trading' | 'route' | 'moves' | 'passage'

/** Creation-time options (games.settings.gameOptions). */
export interface GameOptions {
  /** ⚑ Taxes variant (R-GM-01a). */
  taxes: boolean
}

export interface RouteSlot {
  /** The marker's number — null in a redacted view while it is face down and not the viewer's. */
  value: number | null
  /** R-ACT-05: placed face down until someone moves by it (R-MOV-04). */
  faceDown: boolean
  /** Who placed it face down (they know its number); null for a face-up setup marker. */
  placedBy: PlayerId | null
  /** Identifies a face-down placement, so its log entry stays secret while it is hidden. */
  placementId: number | null
}

export interface House {
  owner: PlayerId
  /** Goods waiting next to this house (R-AUC-08), collected by R-MOV-06. */
  goods: Goods
}

export interface CityState {
  goods: Goods
  routes: [RouteSlot, RouteSlot]
  houses: House[]
  /** Players whose Raid marker lies here (R-ACT-06). */
  raids: PlayerId[]
}

export interface PlayerData {
  /** City the boat is in; null before the starting placement. */
  city: number | null
  goods: Goods
  /** Route markers in hand, count per value (index = number). */
  markers: number[]
  /** Unused Raid markers in hand. */
  raidMarkers: number
  /** Whether the second Raid marker has been bought (R-ACT-02a). */
  secondRaidTaken: boolean
  bonuses: BonusType[]
  /**
   * Set only in a redacted view of another player: how many route markers
   * they hold. Hands are secret (RULES.md §1.3), so `markers` is all zeros.
   */
  hiddenHand?: number
}

export interface Bid {
  playerId: PlayerId
  /** Markers bid, sorted; null when the player couldn't bid (R-AUC-05). */
  markers: number[] | null
}

/** The current player's turn in the Actions phase. */
export interface TurnState {
  playerId: PlayerId
  /** Moves used so far, including one that stayed put (R-MOV-04). */
  moves: number
  /** Whether the boat changed city this turn (R-ACT-04). */
  moved: boolean
  /** Movement over (R-MOV-07); actions only from here on. */
  movementDone: boolean
  /** Actions already taken (each once per turn, R-ACT). */
  used: ActionKind[]
}

export type ActionKind = 'build' | 'guildmaster' | 'buyRoutes' | 'cityTrade' | 'changeRoute' | 'raid'

export type RaidState =
  | { step: 'divide'; raider: PlayerId; victim: PlayerId; city: number }
  | { step: 'take'; raider: PlayerId; victim: PlayerId; city: number; groups: [Goods, Goods] }
  | { step: 'route'; raider: PlayerId; chooser: PlayerId; city: number }

export interface Bundle {
  goods: Goods
  /** Marker values (a multiset). */
  markers: number[]
}

export interface TradeOffer {
  from: PlayerId
  to: PlayerId
  /** What `from` gives. */
  give: Bundle
  /** What `from` gets. */
  get: Bundle
}

export type Stage = 'start' | 'auction' | 'guildmaster' | 'actions' | 'over'

export interface AuctionResult {
  round: number
  bids: Bid[]
  /** The new turn order. */
  order: PlayerId[]
}

export interface Score {
  houses: number
  raids: number
  bonuses: number
  goods: number
  total: number
}

/** The game-specific slice of GameState. */
export interface GameData {
  stage: Stage
  round: number
  /** Seat order (the "player to your left" is the next one here). */
  seatOrder: PlayerId[]
  /** Turn order (R-SET-08, R-AUC-06): index 0 is the starting player. */
  order: PlayerId[]
  players: Record<PlayerId, PlayerData>
  cities: CityState[]
  /** Route markers in the reserve, count per value. */
  reserve: number[]
  /**
   * Set only in a redacted view: how many markers the reserve holds. Its
   * make-up is secret (`reserve` is all zeros there), or subtracting it from
   * the known totals would reveal hands and face-down routes.
   */
  hiddenReserve?: number
  /** Goods in the supply. */
  supply: Goods
  bonusesAvailable: Record<BonusType, number>
  /** The route-marker market: lots of two (R-AUC-01). */
  market: number[][]
  guildmaster: number
  /** Where the Guildmaster (and the Game Ends marker) started (R-SET-03). */
  guildmasterStart: number
  /** Times it has reached its start since (R-END-03). */
  guildmasterLaps: number

  /** R-SET-07: each player's secret pick; null until picked (or to others, in a redacted view). */
  startPicks: Record<PlayerId, number | null>
  /** Bumped each time a group re-picks, so a pick's log entry is secret only within its attempt. */
  startAttempt: number

  /** This round's bids so far, in bidding order. */
  bids: Bid[]
  lastAuction: AuctionResult | null

  turn: TurnState | null
  raid: RaidState | null
  offer: TradeOffer | null
  /** Next id for a face-down placement (R-ACT-05). */
  nextPlacementId: number

  /** Final scores (R-END-04), once the game ended on points. */
  scores: Record<PlayerId, Score> | null
}

// ---- Actions (every one carries playerId) ----

export type Payment = { kind: 'good'; color: Color } | { kind: 'marker'; value: number }

export type GuildTrade =
  | { kind: 'raidMarker'; value: number }
  | { kind: 'bonus'; color: Color; bonus: BonusType }
  | { kind: 'buyMarker'; value: number }
  | { kind: 'sellMarker'; value: number }

export type RaidTarget = { kind: 'player'; victim: PlayerId } | { kind: 'city' }

export type GameAction =
  | { type: 'START_PICK'; playerId: PlayerId; attempt: number; value: number }
  | { type: 'BID'; playerId: PlayerId; markers: number[] }
  | { type: 'MOVE_GUILDMASTER'; playerId: PlayerId; steps: 1 | 2 }
  | { type: 'MOVE'; playerId: PlayerId; route: 0 | 1 | 'passage'; payments: Payment[] }
  | { type: 'END_MOVEMENT'; playerId: PlayerId }
  | { type: 'BUILD_HOUSE'; playerId: PlayerId }
  | { type: 'GUILD_TRADE'; playerId: PlayerId; trade: GuildTrade }
  | { type: 'BUY_ROUTES'; playerId: PlayerId; lot: number; payment: Color }
  | { type: 'CITY_TRADE'; playerId: PlayerId; give: Color; take: Color[] }
  | { type: 'CHANGE_ROUTE'; playerId: PlayerId; slot: 0 | 1; value: number; placementId: number }
  | { type: 'RAID'; playerId: PlayerId; target: RaidTarget }
  | { type: 'RAID_DIVIDE'; playerId: PlayerId; group: Goods }
  | { type: 'RAID_TAKE'; playerId: PlayerId; group: 0 | 1 }
  | { type: 'RAID_ROUTE'; playerId: PlayerId; route: 0 | 1 }
  | { type: 'PROPOSE_TRADE'; playerId: PlayerId; to: PlayerId; give: Bundle; get: Bundle }
  | { type: 'RESPOND_TRADE'; playerId: PlayerId; accept: boolean }
  | { type: 'END_TURN'; playerId: PlayerId }
