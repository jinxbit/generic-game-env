// The deployment's registered games, for Edge Functions that only need to
// *describe* a game (notifications) rather than run its rules. Importing
// this registers every game in src/games/registry.ts, same as the browser.

import '../../../src/games/registry.ts'
import { findGameDefinition } from '@game-platform/sdk'
import { SITE } from '../../../src/site.ts'

/** How to name a room's game in a notification: its title and what its turn counter counts. Falls back to the site's name for a game this deployment doesn't have registered. */
export function gameLabels(gameType: string | null | undefined): { title: string; turnLabel: string } {
  const definition = gameType ? findGameDefinition(gameType) : null
  return { title: definition?.title ?? SITE.title, turnLabel: definition?.turnLabel ?? 'Turn' }
}
