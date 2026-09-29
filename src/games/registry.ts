// The games this deployment runs — the one list to edit when adding, removing
// or version-pinning a game. Imported for its side effect by every entry
// point that runs rules: the browser (src/main.tsx), the Edge Functions
// (supabase/functions/_shared/games.ts) and the test setup
// (src/test/setup.ts). A site with one game registered is a single-game
// site; with several, the create-game screen offers a picker.
//
// Server-reachable: every import here must resolve in the Edge Runtime too,
// which means each package specifier needs an entry in
// supabase/functions/deno.json (edgeFunctionImports.test.ts checks this).
//
// To keep games that started under an older rules version playable after a
// replay-incompatible rules change, register the old version alongside the
// new one (e.g. install it under an npm alias) until no game uses it.

import { registerGame } from '@game-platform/sdk'
import { gameDefinition as bauernschlau } from '@game-platform/bauernschlau/rules'
import { gameDefinition as incorporated } from '@game-platform/incorporated/rules'
import { gameDefinition as kogge } from '@game-platform/kogge/rules'
import { gameDefinition as riseAndFall } from '@game-platform/rise-and-fall/rules'
import { gameDefinition as shark, gameDefinitionV1 as sharkV1 } from '@game-platform/shark/rules'
import { gameDefinition as uniquePick } from '@game-platform/unique-pick/rules'

export const REGISTERED_GAMES = [uniquePick, incorporated, kogge, shark, sharkV1, riseAndFall, bauernschlau]

for (const definition of REGISTERED_GAMES) registerGame(definition)
