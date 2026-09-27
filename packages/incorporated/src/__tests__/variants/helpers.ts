// Shared positions for the variant tests.

import { autoplay, newGame, withGame } from '../../testing'
import type { GameOptions, GameState } from '../../types'

export function at(phase: GameState['game']['phase'], options: Partial<GameOptions>, edit: (g: GameState['game'], ids: string[]) => void = () => {}, players = 4): GameState {
  const s = autoplay(newGame({ options, players }), (x) => x.game.phase === phase)
  return withGame(s, (g) => {
    g.sliders.interest = 0
    for (const id of g.seatOrder) g.players[id].cash = 30
    edit(g, g.seatOrder)
  })
}
