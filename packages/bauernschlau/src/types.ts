// Data types for Bauernschlau. RULES.md (next to this package's README) is the
// source of truth; its rule ids are cited in comments.
//
// Keep this module pure data: no React, no Supabase, no I/O. It's imported by
// the Edge Functions, so every relative import in the graph must carry an
// explicit `.ts` extension.

export type PlayerId = string

/** One sheep counter (R-COMP-02). A black sheep is worth `value` 0 and grants extra turns when turned over (R-FLIP-02). */
export interface Sheep {
  value: number
  black: boolean
}

/** A sheep on a field. */
export interface FieldSheep {
  /** The counter — null only in a redacted view, for a face-down sheep the viewer didn't place (R-HIDE-01). */
  sheep: Sheep | null
  faceUp: boolean
  /** Who put it face down, and so knows what it is (R-HIDE-01). */
  placedBy: PlayerId
}

/** Creation-time options (`games.settings.gameOptions`), normalized by normalizeGameOptions. */
export interface GameOptions {
  /** The multi-round variant's scoring for unenclosed farms (R-SCORE-05). */
  multiRoundScoring: boolean
  /**
   * First-edition rule (R-DOG-03, rules version 2 on; default on): a black
   * sheep turned over with the sheepdog gives no extra actions.
   */
  firstEdition: boolean
}

/**
 * The turn's step — also `GameState.phase`:
 * - `choose`: the turn player picks one of the actions (R-TURN-01);
 * - `place`: they hold drawn sheep and must put each on a field (R-PLACE-01, R-SPECIAL-01);
 * - `ended`: the game is over (R-END-01).
 */
export type Step = 'choose' | 'place' | 'ended'

/** A player's farm. */
export interface Farm {
  /** Which of the six farmhouse hexes is theirs, 0–5 clockwise from the top right (R-SETUP-02). */
  position: number
  /** Fence pieces not yet built (R-SETUP-03). */
  fencesLeft: number
  /** Their two borders, indices into `GameData.borders`: counter-clockwise, then clockwise (R-FENCE-01). */
  borders: [number, number]
}

/** One border between two neighbouring farms (R-FENCE-01). */
export interface Border {
  /** The farms on either side, counter-clockwise first. */
  between: [PlayerId, PlayerId]
  /** Vertices the first fence may start from (R-FENCE-02). */
  starts: string[]
  /** The fence line so far, as vertex keys (board.ts): empty until the first fence, then one more than the fences built. */
  path: string[]
  /** Who built each fence, in order — `path.length - 1` entries. */
  builtBy: PlayerId[]
  /** The line reaches the edge of the board (R-FENCE-06). */
  finished: boolean
}

/** What the most recent action did — for the log and the view. */
export type LastEvent =
  | { kind: 'draw'; playerId: PlayerId; count: number; special: boolean }
  | { kind: 'place'; playerId: PlayerId; cell: number; remaining: number }
  | { kind: 'flip'; playerId: PlayerId; cell: number; sheep: Sheep }
  | { kind: 'herd'; playerId: PlayerId; from: number; to: number; dog: number | null; sheep: Sheep }
  | { kind: 'fence'; playerId: PlayerId; border: number; from: string; to: string; finished: boolean }

export type EndReason = { kind: 'farmFull'; playerId: PlayerId } | { kind: 'stalemate' }

/** A player's final score (§7). */
export interface Score {
  enclosed: boolean
  /** Face-up sheep in the farm, times their bonus fields' multipliers — or the variant's substitute for an unenclosed farm. */
  farm: number
  /** Minus one per unused fence (R-SCORE-04). */
  fences: number
  total: number
}

/** The game-specific slice of GameState (`GameState.game`). */
export interface GameData {
  /** Seats clockwise — never shrinks (R-SETUP-01). */
  seatOrder: PlayerId[]
  farms: Record<PlayerId, Farm>
  borders: Border[]
  /** One entry per cell (board.ts `CELLS`); null where no sheep stands. */
  sheep: (FieldSheep | null)[]
  /** The sheepdog's cell; null while it stands in the centre (R-SETUP-04). */
  dog: number | null
  /** Counters not yet drawn — each null in a redacted view (R-HIDE-02). Order carries no meaning: draws pick a random index. */
  bag: (Sheep | null)[]
  /** Drawn and not yet placed — null in a view of anyone but the turn player (R-HIDE-01). */
  hand: (Sheep | null)[]
  /** Who went first; a new round starts each time the turn comes back round to them (R-SETUP-05). */
  startPlayerId: PlayerId
  turnPlayerId: PlayerId | null
  step: Step
  /** Actions the turn player still has this turn, the current one included (R-TURN-02, R-FLIP-02). */
  actionsLeft: number
  last: LastEvent | null
  /** Null until the game ends — and after, if it ended by concession (the framework ends it then). */
  endReason: EndReason | null
  finalScores: Record<PlayerId, Score> | null
}

/** R-PLACE-01 / opening round: take one sheep from the bag and look at it. */
export interface DrawSheepAction {
  type: 'DRAW_SHEEP'
  playerId: PlayerId
}

/** R-SPECIAL-01: take one sheep per player. */
export interface SheepSpecialAction {
  type: 'SHEEP_SPECIAL'
  playerId: PlayerId
}

/** Put `hand[index]` face down on the empty field `cell`. */
export interface PlaceSheepAction {
  type: 'PLACE_SHEEP'
  playerId: PlayerId
  cell: number
  index: number
}

/** R-FLIP-01: turn over the face-down sheep on `cell`. */
export interface FlipSheepAction {
  type: 'FLIP_SHEEP'
  playerId: PlayerId
  cell: number
}

/**
 * R-DOG-01..04: the dog goes to the face-down sheep on `from`; the sheep moves
 * to the empty field `to` and is turned over; the dog stays on `from`.
 *
 * Rules version 1 let the dog then go to the centre (`dog: null`) or another
 * empty field instead, and required `dog`; from version 2 it's omitted (or
 * must equal `from`).
 */
export interface HerdAction {
  type: 'HERD'
  playerId: PlayerId
  from: number
  to: number
  dog?: number | null
}

/** R-FENCE-01..07: extend `border` by one fence, from vertex `from` to vertex `to`. */
export interface BuildFenceAction {
  type: 'BUILD_FENCE'
  playerId: PlayerId
  border: number
  from: string
  to: string
}

export type GameAction = DrawSheepAction | SheepSpecialAction | PlaceSheepAction | FlipSheepAction | HerdAction | BuildFenceAction
