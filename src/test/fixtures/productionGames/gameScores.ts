// The one game-specific piece of the fixture machinery: how to read a final
// score off a GameState, for the sidecar's optional `expected.finalScores`
// and for the preview seeder's summary line. Everything else in this folder
// (and in ../../supabaseStack/, ../../productionSmoke/, ../../previewSeed/)
// only ever touches the framework's own GameState fields.
//
// Keyed by `GameState.gameType`, so fixtures of several registered games can
// sit side by side. For the example game ("Unique Pick",
// @game-platform/unique-pick) the score is simply `game.scores`. A game with
// no entry here — or no notion of a score — yields `{}`, in which case its
// sidecars just declare `winners`.

import type { GameState } from '@game-platform/sdk'
import type { GameState as UniquePickState } from '@game-platform/unique-pick/rules'

const SCORE_READERS: Record<string, (state: GameState) => Record<string, number>> = {
  'unique-pick': (state) => (state as UniquePickState).game.scores,
}

/** Final score per player id, as the end-of-game screen shows it. */
export function finalScoresOf(state: GameState): Record<string, number> {
  const scores = SCORE_READERS[state.gameType]?.(state)
  if (!scores) return {}
  return Object.fromEntries(state.players.map((player) => [player.id, scores[player.id] ?? 0]))
}
