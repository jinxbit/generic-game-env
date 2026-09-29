import type { AnyGameDefinition } from './gameDefinition.ts'
import { getGameDefinition } from './registry.ts'
import { randomFrom, recordingSource, replayingSource, type Uint32Source } from './random.ts'
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
 * ready for the first move. No action is logged for this — genesis is a
 * deterministic function of its inputs, rebuilt on demand.
 *
 * `setupRandom` is where `setup`'s random numbers come from (./random.ts): a
 * `Uint32Source` the first time — the server's seed for an enforced game, the
 * client's own for a client-trusted one — whose draws are recorded on the
 * result as `setupRandom`; and that recorded array on every rebuild after,
 * which setup must use up exactly. Omitted means nothing may be drawn.
 *
 * `assets` are the payloads the room was set up with, by kind (the room's
 * games.assets, copied there when chosen). Each goes through the game's own
 * AssetKind.normalize; a kind the game doesn't declare, or a payload it
 * rejects, is dropped — a room row is client-writable in the lobby, so this
 * is where a bad one stops. What's left reaches `setup` as `lobby.assets`
 * and stays on the state (GameState.assets).
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
  /** games.settings.lockRevealedInformationEnabled — see GameState.lockRevealedInformationEnabled. */
  lockRevealedInformationEnabled?: boolean
  /** Fresh numbers for a first build, or the state's recorded `setupRandom` for a rebuild — see above. */
  setupRandom?: Uint32Source | readonly number[]
  /** Asset payloads by kind — see above. */
  assets?: Record<string, unknown>
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
    // Only set when on, so a game without it keeps exactly the genesis (and
    // exports) it always had.
    ...(params.lockRevealedInformationEnabled ? { lockRevealedInformationEnabled: true } : {}),
    // Likewise only when the room used any, so a game without them keeps its genesis.
    ...normalizedAssets(game, params.assets),
    actionHistory: [],
    adminModeActive: false,
  }
  const setupRandom = params.setupRandom ?? []
  const replaying = typeof setupRandom === 'function' ? null : replayingSource(setupRandom)
  const recording = recordingSource(replaying ? replaying.source : (setupRandom as Uint32Source))
  const genesis = game.setup(lobby, randomFrom(recording.source))
  if (replaying && !replaying.exhausted()) throw new Error("Rebuilding genesis drew fewer random numbers than setup originally did — this isn't the setup the game started with.")
  return recording.drawn.length > 0 ? { ...genesis, setupRandom: recording.drawn } : genesis
}

/** `{ assets }` holding each payload the game accepts, or `{}` when none survives — see createNewGame. */
function normalizedAssets(game: AnyGameDefinition, assets: Record<string, unknown> | undefined): { assets?: Record<string, unknown> } {
  const accepted: Record<string, unknown> = {}
  for (const [kind, raw] of Object.entries(assets ?? {})) {
    const assetKind = game.assetKinds?.[kind]
    const data = assetKind ? assetKind.normalize(raw) : null
    if (data !== null && data !== undefined) accepted[kind] = data
  }
  return Object.keys(accepted).length > 0 ? { assets: accepted } : {}
}
