// The React half of every registered game (src/games/registry.ts), keyed by
// game id — browser-only, never imported by the Edge Functions.

import type { AnyGameUi } from '@game-platform/sdk/ui'
import { ui as bauernschlau } from '@game-platform/bauernschlau/view'
import { ui as incorporated } from '@game-platform/incorporated/view'
import { ui as kogge } from '@game-platform/kogge/view'
import { ui as riseAndFall } from '@game-platform/rise-and-fall/view'
import { ui as shark } from '@game-platform/shark/view'
import { ui as uniquePick } from '@game-platform/unique-pick/view'
import './registry'

const UIS: Record<string, AnyGameUi> = Object.fromEntries([uniquePick, incorporated, kogge, shark, riseAndFall, bauernschlau].map((ui) => [ui.id, ui]))

/** The UI for `gameType`, or null if this deployment doesn't ship it. */
export function gameUiFor(gameType: string): AnyGameUi | null {
  return UIS[gameType] ?? null
}
