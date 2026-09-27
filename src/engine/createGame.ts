import { game } from './game.ts'
import type { GameState, LobbyState, PlayMode, Player } from './types.ts'
import type { GameOptions } from '../game/types.ts'

export interface PlayerSeed {
  id: string
  authUserId: string | null
  displayName: string
  color: string
}

/**
 * Builds a game's genesis state: players seated in the given order (which
 * becomes `turnOrder`), then handed to the game's own setup
 * (GameDefinition.setup), which returns it `active` and ready for the first
 * move. No action is logged for this — genesis is a deterministic function
 * of its inputs, rebuilt on demand (src/lib/gameGenesis.ts).
 */
export function createNewGame(params: {
  gameId: string
  playMode: PlayMode
  players: PlayerSeed[]
  hiddenInformationEnabled?: boolean
  options?: GameOptions
}): GameState {
  const players: Player[] = params.players.map((seed) => ({
    id: seed.id,
    authUserId: seed.authUserId,
    displayName: seed.displayName,
    color: seed.color,
    eliminated: false,
    conceded: false,
  }))
  const lobby: LobbyState = {
    gameId: params.gameId,
    playMode: params.playMode,
    status: 'lobby',
    hiddenInformationEnabled: params.hiddenInformationEnabled ?? false,
    turn: 0,
    phase: null,
    activePlayerId: null,
    pendingPlayerIds: [],
    turnOrder: players.map((p) => p.id),
    players,
    winnerPlayerIds: [],
    actionHistory: [],
    adminModeActive: false,
  }
  return game.setup(lobby, params.options ?? game.defaultOptions)
}
