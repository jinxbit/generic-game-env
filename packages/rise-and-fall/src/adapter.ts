// Maps between the platform's GameState (the framework's envelope plus this
// game's GameData) and the Rise & Fall engine's own flat state (EngineState,
// ./engine/types.ts).
//
// The engine was written for a standalone app whose one state object held
// everything; it is carried over nearly verbatim rather than rewritten around
// the envelope, and this module is the seam. `toEngine` joins the two halves
// into the state the engine expects; `toPlatform` splits an engine result
// back and derives the envelope fields the framework and the database read:
//
// - `status` — the engine's `boardSetup` status is an `active` game on the
//   platform, with `phase` saying which setup step it is in.
// - `pendingPlayerIds` — the engine lists everyone still to act in the
//   actions phase and repeats a player once per card owed in a decline
//   phase; the envelope holds each player once, and only whoever may act
//   right now (invariant 5 in CLAUDE.md). The engine's list is kept, as is,
//   in GameData.
// - `activePlayerId` — the current tile/unit placer during setup, the head of
//   the queue in the actions phase, null in the simultaneous phases.
//
// Genesis is built here too, from the options (and, for "build alone" with a
// random builder or order, the setup's random draws), and can be rebuilt
// without the draws from what setup recorded in GameData.seating — see
// `engineGenesisOf`.
//
// Server-reachable (imported by ./rules.ts): relative imports keep their
// `.ts` extensions.

import type { GameState as PlatformGameState, LobbyState, Player as SeatPlayer } from '@game-platform/sdk'
import { resolveBoardGenerationContent, resolveMapTemplateBoard, resolveResourceBank } from './content/resolveContent.ts'
import { createEmptyBoard } from './engine/board.ts'
import { currentTilePlacerId, currentUnitPlacerId } from './engine/boardSetup.ts'
import { createNewGame, startGame, startGameWithPresetBoard } from './engine/createGame.ts'
import type { PlayMode } from './engine/types.ts'
import type { EngineState, GameData, GameOptions, PlayerHoldings } from './types.ts'

/** This game's platform GameState. */
export type GameState = PlatformGameState<GameData, GameOptions>

/** Envelope `phase` ids — the engine's round phases, plus the two board-setup steps. */
export type Phase = 'placeTiles' | 'placeUnits' | 'selectCards' | 'actions' | 'decline' | 'purchase'

/**
 * The engine's view of a platform state. `trustEngineElimination` reads who
 * is eliminated from the engine's own record only — what `onPlayerEliminated`
 * needs, since the framework has already flagged the conceding player on the
 * envelope before the engine has run its own concede. Everywhere else a flag
 * on either side counts (the framework ends a game itself when a concede
 * leaves one player, without calling the game).
 */
export function toEngine(state: GameState, trustEngineElimination = false): EngineState {
  const { players: holdings, seating, ...core } = state.game
  void seating
  const holdingsById = new Map(holdings.map((h) => [h.id, h]))
  return {
    ...core,
    status: state.status === 'completed' ? 'completed' : core.status,
    gameId: state.gameId,
    playMode: state.playMode,
    hiddenInformationEnabled: state.hiddenInformationEnabled,
    lockRevealedInformationEnabled: Boolean(state.lockRevealedInformationEnabled),
    activeTaleIds: state.options.activeTaleIds,
    gameLength: state.options.gameLength,
    players: state.players.map((seat) => {
      const own = holdingsById.get(seat.id)
      if (!own) throw new Error(`No Rise & Fall holdings for player ${seat.id}`)
      const eliminated = trustEngineElimination ? own.eliminated : own.eliminated || seat.eliminated
      const conceded = trustEngineElimination ? Boolean(own.conceded) : Boolean(own.conceded || seat.conceded)
      return { ...own, authUserId: seat.authUserId, displayName: seat.displayName, color: seat.color, eliminated, conceded }
    }),
    winnerPlayerIds: state.winnerPlayerIds,
    actionHistory: [],
    adminModeActive: Boolean(state.adminModeActive),
  }
}

/** Whoever may place the next tile or starting unit, while the engine is in board setup. */
function currentPlacerId(engine: EngineState): string | null {
  return currentTilePlacerId(engine) ?? currentUnitPlacerId(engine)
}

/** The envelope's `phase` for an engine state. */
export function phaseOf(engine: EngineState): Phase | null {
  if (engine.status === 'completed' || engine.status === 'lobby') return null
  if (engine.status === 'boardSetup') return engine.boardSetup && engine.boardSetup.tileTierQueue.length > 0 ? 'placeTiles' : 'placeUnits'
  return engine.roundPhase
}

/**
 * Splits an engine state back into `base`'s envelope and GameData, deriving
 * the envelope fields the framework reads (see this module's header).
 * `base` supplies everything the engine doesn't own — the log, options, seat
 * identities; `seating` defaults to what `base` already records.
 */
export function toPlatform(engine: EngineState, base: GameState | LobbyState<GameOptions>, seating?: GameData['seating']): GameState {
  const {
    gameId,
    playMode,
    hiddenInformationEnabled,
    lockRevealedInformationEnabled,
    activeTaleIds,
    gameLength,
    players,
    winnerPlayerIds,
    actionHistory,
    adminModeActive,
    ...core
  } = engine
  void [gameId, playMode, hiddenInformationEnabled, lockRevealedInformationEnabled, activeTaleIds, gameLength, actionHistory, adminModeActive]

  const phase = phaseOf(engine)
  let activePlayerId: string | null = null
  let pendingPlayerIds: string[] = []
  if (engine.status === 'boardSetup') {
    activePlayerId = currentPlacerId(engine)
    pendingPlayerIds = activePlayerId ? [activePlayerId] : []
  } else if (engine.status === 'active') {
    if (engine.roundPhase === 'actions') {
      activePlayerId = engine.pendingPlayerIds[0] ?? null
      pendingPlayerIds = activePlayerId ? [activePlayerId] : []
    } else {
      pendingPlayerIds = [...new Set(engine.pendingPlayerIds)]
    }
  }

  const byId = new Map(players.map((p) => [p.id, p]))
  const recordedSeating = seating ?? ('game' in base ? (base as GameState).game.seating : null)
  if (!recordedSeating) throw new Error('Rise & Fall: no seating recorded for this game')

  return {
    ...base,
    status: engine.status === 'completed' ? 'completed' : 'active',
    turn: engine.turn,
    phase,
    activePlayerId,
    pendingPlayerIds,
    turnOrder: [...engine.turnOrder],
    winnerPlayerIds: [...winnerPlayerIds],
    players: base.players.map((seat): SeatPlayer => {
      const own = byId.get(seat.id)
      return own ? { ...seat, eliminated: own.eliminated, conceded: Boolean(own.conceded) } : seat
    }),
    game: {
      ...core,
      players: players.map(({ authUserId, displayName, color, ...holdings }): PlayerHoldings => {
        void [authUserId, displayName, color]
        return holdings
      }),
      seating: recordedSeating,
    },
  }
}

/** Everything the engine's genesis depends on. */
export interface EngineGenesisInput {
  gameId: string
  playMode: PlayMode
  /** In seat order. */
  players: { id: string; authUserId: string | null; displayName: string; color: string }[]
  options: GameOptions
  hiddenInformationEnabled: boolean
  lockRevealedInformationEnabled: boolean
  seating: GameData['seating']
}

/**
 * The engine's genesis — the state the standalone app's gameGenesis.ts built:
 * board setup under way, the starting Sea tiles seeded (or a template map
 * laid out), nobody's cards dealt yet. Deterministic: whatever setup drew at
 * random is already resolved into `seating`.
 */
export function buildEngineGenesis(input: EngineGenesisInput): EngineState {
  const playerCount = input.players.length
  const lobby = createNewGame({
    gameId: input.gameId,
    playMode: input.playMode,
    board: createEmptyBoard('hex'),
    players: input.players,
    resourceBank: resolveResourceBank(playerCount),
    activeTaleIds: input.options.activeTaleIds,
    gameLength: input.options.gameLength,
    hiddenInformationEnabled: input.hiddenInformationEnabled,
    lockRevealedInformationEnabled: input.lockRevealedInformationEnabled,
  })
  const turnOrder = input.seating.turnOrder
  const sameOrder = turnOrder.length === lobby.turnOrder.length && turnOrder.every((id, i) => lobby.turnOrder[i] === id)
  const ordered = sameOrder ? lobby : { ...lobby, turnOrder: [...turnOrder], pendingPlayerIds: [...turnOrder] }

  if (input.options.mapMode === 'template' && input.options.mapTemplateId) {
    const board = resolveMapTemplateBoard(input.options.mapTemplateId)
    if (board) return startGameWithPresetBoard(ordered, board)
  }
  return startGame(ordered, resolveBoardGenerationContent(playerCount), input.seating.builderId)
}

/** Rebuilds the engine's genesis for a game already under way — what the view replays history from. */
export function engineGenesisOf(state: GameState): EngineState {
  return buildEngineGenesis({
    gameId: state.gameId,
    playMode: state.playMode,
    players: state.players.map((p) => ({ id: p.id, authUserId: p.authUserId, displayName: p.displayName, color: p.color })),
    options: state.options,
    hiddenInformationEnabled: state.hiddenInformationEnabled,
    lockRevealedInformationEnabled: Boolean(state.lockRevealedInformationEnabled),
    seating: state.game.seating,
  })
}
