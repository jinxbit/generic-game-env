// Writes the example-game fixtures into src/test/fixtures/productionGames/.
// See that folder's generateExampleFixtures.ts (which builds them) and its
// README.md. Loaded through Vite's module runner so the app's extensionless
// TypeScript imports resolve exactly as they do in the app and in vitest.
//
//   node scripts/generate-example-fixtures.mjs

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const folder = join(root, 'src/test/fixtures/productionGames')

const { module } = await runnerImport(join(folder, 'generateExampleFixtures.ts'), { configFile: false, root, logLevel: 'error' })
const fixtures = await module.generateExampleFixtures()

for (const fixture of fixtures) {
  writeFileSync(join(folder, `${fixture.name}.json`), fixture.exportText)
  writeFileSync(join(folder, `${fixture.name}.room.json`), fixture.sidecarText)
  console.log(`wrote ${fixture.name}.json and ${fixture.name}.room.json`)
}
