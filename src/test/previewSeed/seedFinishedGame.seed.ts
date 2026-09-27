// The live entry point for ./seedFinishedGame.ts. Kept out of `npm run test`
// exactly the way the smoke test is (see ../productionSmoke/README.md): the
// default vitest config's `include` matches `*.test.*` only, this file is
// `*.seed.ts`, and ../../../vitest.seed.config.ts is the only config that
// matches it. Nothing that runs on a PR can reach a live project from here.
//
// SEED_FIXTURE names which recorded game to seed; omit it for the default —
// the first checked-in fixture (by name) the smoke test would also replay: a
// finished game played on the rule-enforced path, which is the only kind
// provisionLiveRoom can replay against a live project.

import { describe, it } from 'vitest'
import { liveProjectConfigFromEnv } from '../productionSmoke/liveProject.ts'
import { loadProductionGameFixtures } from '../fixtures/productionGames/loadFixtures.ts'
import { smokeEligibility } from '../productionSmoke/runSmoke.ts'
import { seedFinishedGame } from './seedFinishedGame.ts'

// tsconfig.app.json's `types` is `["vite/client"]`, so node's globals are not
// in this program — the same reason ../productionSmoke/productionSmoke.smoke.ts
// declares this rather than widening the app's types for one file.
declare const process: { env: Record<string, string | undefined> }

describe('preview seed', () => {
  it('leaves one finished game on the project for manual testing', async () => {
    const fixtures = await loadProductionGameFixtures()
    const wanted = process.env.SEED_FIXTURE?.trim() || fixtures.find((candidate) => smokeEligibility(candidate) === null)?.name
    if (!wanted) {
      throw new Error(`No checked-in fixture is a finished, rule-enforced game, so there is no default to seed. Available: ${fixtures.map((f) => f.name).join(', ') || '(none)'}`)
    }
    const fixture = fixtures.find((candidate) => candidate.name === wanted)
    if (!fixture) {
      throw new Error(`No fixture named "${wanted}". Available: ${fixtures.map((f) => f.name).join(', ')}`)
    }

    const seeded = await seedFinishedGame(liveProjectConfigFromEnv(process.env), fixture, (message) => console.log(`      ${message}`))

    const scores = Object.entries(seeded.finalScores)
      .sort(([, a], [, b]) => b - a)
      .map(([name, score]) => `${name} ${score}`)
      .join(', ')
    console.log(`\nSeeded "${seeded.name}"`)
    console.log(`  room code: ${seeded.roomCode}`)
    console.log(`  game id:   ${seeded.gameId}`)
    console.log(`  final:     ${scores}`)
    console.log(`  It is a PUBLIC room, so it is on the Public Rooms screen — and it is not cleaned up.\n`)
  })
})
