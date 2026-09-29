// The platform-facing types of Rise & Fall: what this package stores under
// the framework's `GameState.game` (GameData), its creation-time options
// (GameOptions) and the actions a player submits (GameAction).
//
// The rules themselves live in ./engine/, which is the Rise & Fall engine
// carried over from the game's original standalone app, nearly verbatim. That
// engine works on its own flat state (EngineState, ./engine/types.ts), which
// holds everything — seats, turn order, pending players and the game's own
// data — in one object. ./adapter.ts splits an EngineState into the
// framework's envelope plus GameData and joins them back, so the engine never
// needed rewriting around the envelope.

import type { Action as EngineAction } from './engine/actions.ts'
import type { GameState as EngineState, Player as EnginePlayer } from './engine/types.ts'

export type { EngineState, EnginePlayer }

/**
 * Every action a player submits. The framework's own actions (CONCEDE,
 * UNDO_ACTION, REDO_ACTION, SET_ADMIN_MODE) share their names and shapes with
 * the engine's, but on the platform the framework handles them — the engine
 * only ever sees these.
 */
export type GameAction = Exclude<EngineAction, { type: 'CONCEDE' | 'UNDO_ACTION' | 'REDO_ACTION' | 'SET_ADMIN_MODE' }>

/**
 * How the board is made at the start of a game:
 * - `together` — every player takes turns placing tiles (the default).
 * - `solo` — one player places every tile while the others watch
 *   (`soloBuilder` says who); starting units are still placed by everyone.
 * - `template` — a pre-made map (content/mapTemplates.json), skipping tile
 *   placement entirely.
 */
export type MapMode = 'together' | 'solo' | 'template'

export interface GameOptions {
  /** Total achievements claimed (across all players) that ends the game — content/achievements.json's gameLength bounds it. */
  gameLength: number
  /** Content ids of active Tales (content/tales.json); empty for the base game. */
  activeTaleIds: string[]
  mapMode: MapMode
  /** The pre-made map for `mapMode: 'template'`; ignored otherwise. */
  mapTemplateId: string | null
  /** Who builds for `mapMode: 'solo'`: the host (first seat) or a random player, drawn at setup. */
  soloBuilder: 'host' | 'random'
  /** For `mapMode: 'solo'`: the builder places their starting units last, or the unit-placement order is shuffled at setup. */
  soloBuilderUnitOrder: 'last' | 'random'
}

/** A player's cards and resources — the engine's Player minus the seat identity the framework already holds. */
export type PlayerHoldings = Omit<EnginePlayer, 'authUserId' | 'displayName' | 'color'>

/**
 * What the framework stores under `GameState.game`: the engine's own state
 * minus the fields the envelope carries (identity, options, the log). It
 * deliberately keeps the engine's own copy of `status`, `turn`,
 * `turnOrder`, `pendingPlayerIds` and `activePlayerId` — the envelope's are
 * derived from these (./adapter.ts, `toPlatform`) and can differ in shape:
 * the engine's pending list repeats a player once per card they still owe
 * in a decline phase and lists everyone still to act in the actions phase,
 * where the envelope's holds each player once and only who may act now.
 */
export interface GameData
  extends Omit<
    EngineState,
    | 'gameId'
    | 'playMode'
    | 'hiddenInformationEnabled'
    | 'lockRevealedInformationEnabled'
    | 'activeTaleIds'
    | 'gameLength'
    | 'players'
    | 'winnerPlayerIds'
    | 'actionHistory'
    | 'adminModeActive'
  > {
  /** One per seat, in seat order (the envelope's `players` order). */
  players: PlayerHoldings[]
  /**
   * What setup resolved from the options with its random draws — enough to
   * rebuild the engine's genesis without them (./adapter.ts,
   * `engineGenesisOf`), which is how the view replays history for the turn
   * recap and the end-of-game charts.
   */
  seating: { turnOrder: string[]; builderId: string | null }
}
