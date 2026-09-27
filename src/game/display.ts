// Display strings for the example game that the platform's own screens (home
// page, listing cards, lobby) show. Replace alongside ./rules.ts. Kept free of
// React so plain `src/lib/` view logic can use it too.

import { game } from '../engine/game.ts'
import { normalizeGameOptions } from './rules.ts'
import type { GameOptions } from './types.ts'

/** The game's name — also used as the site title (index.html and the PWA manifest in vite.config.ts carry their own copy). */
export const GAME_TITLE = 'Unique Pick'

/** One line for the home page. */
export const GAME_TAGLINE = 'Pick a number nobody else picks. A tiny example game for this platform.'

/** What `GameState.turn` counts, for labels like "Round 3". */
export const TURN_LABEL = 'Round'

/** One-line summary of a game's options for listing cards and the lobby, e.g. "First to 12 · max 10 rounds". */
export function describeGameOptions(options: Partial<GameOptions> | null | undefined): string {
  const normalized = normalizeGameOptions(options)
  return `First to ${normalized.targetScore} · max ${normalized.maxRounds} rounds`
}

/** Label for `GameState.phase` on listing screens. */
export function describePhase(phase: string | null): string {
  return game.describePhase(phase)
}
