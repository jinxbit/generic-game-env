// Data types for Magna Grecia. RULES.md (next to this package's README) is
// the source of truth; its rule ids are cited in comments.
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions, so every relative import in the graph must carry an
// explicit `.ts` extension.

export type PlayerId = string

/** A side of a (pointy-top) hex: 0 east, 1 south-east, 2 south-west, 3 west, 4 north-west, 5 north-east. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5

/** Creation-time options (`games.settings.gameOptions`), normalized by normalizeGameOptions. */
export interface GameOptions {
  /** R-ROUND-01: 12 rounds, or 8 in the short game. */
  rounds: 8 | 12
}

/** A static village space (R-BOARD-02). */
export interface VillageSpace {
  cell: number
  /** Edge villages with a green border — where cities may be founded without a road (R-CITY-01). */
  green: boolean
}

/** One action card (R-CARD-01..03). Colours are slots 0–3 (R-SETUP-04). */
export interface ActionCard {
  id: number
  /** The border colour — also the card's first player. */
  border: number
  /** All four colour slots, in turn order. */
  order: number[]
  roads: number
  cities: number
  resupply: number
}

/** A placed road tile (R-ROAD-01): the two sides it joins, ascending. */
export interface RoadTile {
  owner: PlayerId
  ends: [Dir, Dir]
}

/** A city (R-CITY-09): identified by the village space it was founded on. */
export interface City {
  id: number
  owner: PlayerId
}

/**
 * A placed market. `cell` is a village space: the village it was built in, or
 * the village a city was founded on / absorbed — so a market in a city is any
 * market whose cell is one of that city's tiles.
 */
export interface Market {
  owner: PlayerId
  cell: number
  sold: boolean
}

export interface Oracle {
  cell: number
  /** Id of the city this oracle attends to, or null before any city connects (R-ORACLE-02). */
  attention: number | null
}

export interface Tiles {
  roads: number
  cities: number
}

export interface PlayerData {
  /** Card colour slot 0–3 (R-SETUP-04). */
  slot: number
  /** Position on the scoring track (R-SETUP-03). */
  points: number
  supply: Tiles
  staging: Tiles
  /** Markets still in supply. */
  markets: number
}

/** What the turn player has done so far this turn (R-ACT-04). */
export interface TurnProgress {
  roads: number
  cities: number
  /** Whether a city was founded this turn (R-CITY-06). */
  founded: boolean
  /** Tiles resupplied, or null before resupplying (R-ACT-02). */
  resupplied: number | null
}

/** `ended` once the last round is over; `turn` otherwise. Also `GameState.phase`. */
export type Step = 'turn' | 'ended'

/** Things the last move set off, for the log and the view. */
export type MoveEvent =
  | { kind: 'oracle'; oracle: number; from: number | null; to: number; owner: PlayerId }
  | { kind: 'foundingMarket'; owner: PlayerId; city: number }
  | { kind: 'marketRemoved'; owner: PlayerId; cell: number; sold: boolean }
  | { kind: 'round'; round: number; card: number }

export interface FinalScore {
  points: number
  markets: number
  oracles: number
  total: number
}

/** The game-specific slice of GameState (`GameState.game`). */
export interface GameData {
  /** Placed city tiles per cell (owner), null when none. */
  cityTiles: (PlayerId | null)[]
  /** Placed road tiles per cell, null when none. */
  roads: (RoadTile | null)[]
  cities: City[]
  markets: Market[]
  oracles: Oracle[]
  players: Record<PlayerId, PlayerData>
  /** Seat order at genesis — never shrinks. */
  seatOrder: PlayerId[]
  /** Rounds in this game (the option, copied at genesis). */
  rounds: number
  /** 1-based. */
  round: number
  /** The current card's id. */
  card: number
  /** Card ids not drawn yet. */
  deck: number[]
  /** Card ids drawn so far, in order, the current one last. */
  usedCards: number[]
  /** This round's players in turn order (R-ROUND-02). */
  roundOrder: PlayerId[]
  turnPlayerId: PlayerId | null
  progress: TurnProgress
  step: Step
  /** What the most recent action set off. */
  events: MoveEvent[]
  finalScores: Record<PlayerId, FinalScore> | null
}

export interface PlaceRoadAction {
  type: 'PLACE_ROAD'
  playerId: PlayerId
  cell: number
  /** The two sides joined, in any order. */
  ends: [Dir, Dir]
}

/** A city tile on `cell` — two tiles when it bridges onto a village (R-CITY-04). */
export interface PlaceCityAction {
  type: 'PLACE_CITY'
  playerId: PlayerId
  cell: number
}

export interface ResupplyAction {
  type: 'RESUPPLY'
  playerId: PlayerId
  roads: number
  cities: number
}

/** R-MKT-02: `cell` is any cell of the city, or the village. */
export interface BuildMarketAction {
  type: 'BUILD_MARKET'
  playerId: PlayerId
  cell: number
}

/** R-MKT-05: `cell` is the market's own cell (Market.cell). */
export interface SellMarketAction {
  type: 'SELL_MARKET'
  playerId: PlayerId
  cell: number
}

export interface EndTurnAction {
  type: 'END_TURN'
  playerId: PlayerId
}

export type GameAction = PlaceRoadAction | PlaceCityAction | ResupplyAction | BuildMarketAction | SellMarketAction | EndTurnAction
