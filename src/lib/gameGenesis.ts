// Rebuilds a game's genesis GameState — the exact state the game started
// from (status: 'active', actionHistory: []) — on demand instead of storing
// it separately. Deterministic from the game's row + seated players: the
// roster and seat order never change after the game starts, and nothing here
// reads randomness, the clock or ambient state. Used when starting a game
// (gameApi.ts's startGameFromLobby, the start-game Edge Function), by undo/
// redo (which replay the history against it — @game-platform/sdk's undoRedo.ts), and by
// the delta read path (./deltaReplayContext.ts).
//
// Randomness in the game's `setup` (a random first player, a board layout) is
// the one input that isn't on the row: the first build draws fresh numbers
// (`setupRandom` as a source — the server's secret seed for an enforced game,
// see ./randomSource.ts) and records them on the state as `setupRandom`; every
// rebuild after passes that recorded array back, so genesis stays a pure
// function of the row, the roster and numbers every copy of the state carries.
//
// So do the assets the room was set up with (a saved map — `games.assets`,
// ./roomAssets.ts): their payloads were copied onto the row when chosen, or
// by Start for a random choice, before genesis was first built from it.
//
// Which game's rules build it comes from the row too: `game_type`, at the
// `settings.rulesVersion` pinned when the room was created. The game must be
// registered (src/games/registry.ts) in whatever process calls this.

import { createNewGame, type GameState, type Uint32Source } from '@game-platform/sdk'
import type { GameRow } from './dbTypes.ts'
import { roomAssetPayloads } from './roomAssets.ts'

/**
 * Exactly the `players` columns genesis depends on — nothing else in a
 * `PlayerRow` reaches `buildGenesisState`, and saying so in the type is what
 * lets a caller rebuild genesis from somewhere other than the table (a cached
 * `GameState`'s own `players` carry all four — see ./deltaReplayContext.ts).
 *
 * Order is significant: seat order becomes `turnOrder`, so callers must pass
 * these in the same order `listPlayers` returns them (by `seat_index`).
 */
export type GenesisPlayerInput = {
  id: string
  user_id: string | null
  display_name: string
  color: string
}

/**
 * `setupRandom`: a source on the very first build (starting the game), and
 * the game's own recorded `GameState.setupRandom` on every rebuild after —
 * omitting it on a rebuild only works for a game whose setup drew nothing.
 */
export function buildGenesisState(game: GameRow, players: readonly GenesisPlayerInput[], setupRandom?: Uint32Source | readonly number[]): GameState {
  return createNewGame({
    gameId: game.id,
    gameType: game.game_type,
    rulesVersion: game.settings.rulesVersion,
    playMode: game.play_mode,
    players: players.map((p) => ({
      id: p.id,
      authUserId: p.user_id,
      displayName: p.display_name,
      color: p.color,
    })),
    hiddenInformationEnabled: game.settings.hiddenInformationEnabled,
    options: game.settings.gameOptions,
    lockRevealedInformationEnabled: game.settings.lockRevealedInformationEnabled,
    setupRandom,
    assets: roomAssetPayloads(game.assets),
  })
}
