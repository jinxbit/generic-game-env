import { getGameDefinition } from './registry.ts'
import type { GameState, LobbyState, PlayMode, Player } from './types.ts'

export interface PlayerSeed {
  id: string
  authUserId: string | null
  displayName: string
  color: string
}

/**
 * Builds a game's genesis state: players seated in the given order (which
 * becomes `turnOrder`), options normalized by the game, then handed to the
 * game's own setup (GameDefinition.setup), which returns it `active` and
 * ready for the first move. `setup` may draw from the game's seed
 * (`gameRandom(lobby, ...)`, ./random.ts) — never from `Math.random()`. No
 * action is logged for this — genesis is a deterministic function of its
 * inputs, rebuilt on demand.
 *
 * `rulesVersion` omitted means the newest registered version — right for a
 * brand-new game. Rebuilding an existing game's genesis must pass the
 * version it started with.
 */
export function createNewGame(params: {
  gameId: string
  gameType: string
  rulesVersion?: number
  playMode: PlayMode
  players: PlayerSeed[]
  hiddenInformationEnabled?: boolean
  options?: unknown
  /** games.settings.randomSeed — omitted for a game created before seeds existed (see GameState.randomSeed). */
  randomSeed?: string
}): GameState {
  const game = getGameDefinition(params.gameType, params.rulesVersion)
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
    gameType: game.id,
    rulesVersion: game.rulesVersion,
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
    options: game.normalizeOptions(params.options ?? game.defaultOptions),
    // Only set when there is one, so a seedless game's genesis (and its
    // exports) stay exactly as they were.
    ...(params.randomSeed !== undefined ? { randomSeed: params.randomSeed } : {}),
    actionHistory: [],
    adminModeActive: false,
  }
  return game.setup(lobby)
}
