// Rebuilds a game's genesis GameState — the exact state the game started
// from (status: 'active', actionHistory: []) — on demand instead of storing
// it separately. Deterministic from the game's row + seated players: the
// roster and seat order never change after the game starts, and nothing here
// reads randomness, the clock or ambient state. Used when starting a game
// (gameApi.ts's startGameFromLobby, the start-game Edge Function), by undo/
// redo (which replay the history against it — @game-platform/sdk's undoRedo.ts), and by
// the delta read path (./deltaReplayContext.ts).
//
// A game that needs randomness at setup (a shuffled deck, a random first
// player) must resolve it once, before genesis, and persist the result into
// `games.settings` — then read it from there here, so genesis stays a pure
// function of the row.
//
// Which game's rules build it comes from the row too: `game_type`, at the
// `settings.rulesVersion` pinned when the room was created. The game must be
// registered (src/games/registry.ts) in whatever process calls this.

import { createNewGame, type GameState } from '@game-platform/sdk'
import type { GameRow } from './dbTypes.ts'

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

export function buildGenesisState(game: GameRow, players: readonly GenesisPlayerInput[]): GameState {
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
  })
}
