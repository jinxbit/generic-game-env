// A test-only game that draws random numbers — Unique Pick with a shuffled
// seating order at setup and a random bonus rolled on every pick. Unique Pick
// itself uses no randomness, so this is what the framework's random-draw
// tests (and the platform's, through the in-process Supabase stack) play.
// Not a test file itself.

import { gameDefinition as uniquePick, type GameData, type GameOptions, type GameState as UniquePickState, type PickNumberAction } from '@game-platform/unique-pick/rules'
import type { GameDefinition } from '../gameDefinition'
import type { Random } from '../random'
import type { GameState, LobbyState } from '../types'
import { registerGame } from '../registry'

export type ChanceData = GameData & { bonuses: number[] }

export const CHANCE_GAME_TYPE = 'test-chance-pick'

export const chanceGame = {
  ...uniquePick,
  id: CHANCE_GAME_TYPE,
  title: 'Chance Pick (test)',
  setup(lobby: LobbyState<GameOptions>, random: Random): GameState<ChanceData, GameOptions> {
    const genesis = uniquePick.setup(lobby, random)
    return { ...genesis, turnOrder: random.shuffle(genesis.turnOrder), game: { ...genesis.game, bonuses: [] } }
  },
  applyAction(state: GameState<ChanceData, GameOptions>, action: PickNumberAction, random: Random) {
    const result = uniquePick.applyAction(state as UniquePickState, action, random)
    if (!result.ok) return result
    return { ok: true, state: { ...result.state, game: { ...result.state.game, bonuses: [...state.game.bonuses, random.int(1, 1_000_000)] } } }
  },
} as unknown as GameDefinition<ChanceData, GameOptions, PickNumberAction>

export function registerChanceGame(): void {
  registerGame(chanceGame)
}
