// The one game-specific piece of the fixture machinery: how to read a final
// score off a GameState, for the sidecar's optional `expected.finalScores`
// and for the preview seeder's summary line. Everything else in this folder
// (and in ../../supabaseStack/, ../../productionSmoke/, ../../previewSeed/)
// only ever touches the framework's own GameState fields.
//
// For the example game ("Unique Pick", src/game/) the score is simply
// `game.scores`. Replacing src/game/ means rewriting this function — or
// returning `{}` if the new game has no notion of a score, in which case
// sidecars just declare `winners`.

import type { GameState } from '../../../engine/types.ts'

/** Final score per player id, as the end-of-game screen shows it. */
export function finalScoresOf(state: GameState): Record<string, number> {
  return Object.fromEntries(state.players.map((player) => [player.id, state.game.scores[player.id] ?? 0]))
}
