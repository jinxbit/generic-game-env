import { defineConfig } from 'vitest/config'

// Runs ONLY the preview seeder (src/test/previewSeed/*.seed.ts), which writes
// a real, finished game into whichever project the SMOKE_* variables name and
// deliberately leaves it there.
//
// Its own config for the same reason vitest.smoke.config.ts has one: there
// must be no path by which `npm run test` — what CI runs on every PR — reaches
// a live project. That config matches `*.test.*`, the smoke config matches
// `*.smoke.ts`, and this one matches `*.seed.ts`; the three sets are disjoint.
export default defineConfig({
  test: {
    include: ['src/test/previewSeed/**/*.seed.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 900_000,
    hookTimeout: 120_000,
    // The Edge Functions' own `jsr:` specifier, mapped onto the npm package —
    // see src/test/supabaseStack/edgeFunctions.ts. Nothing this config runs
    // imports supabase/functions/ today, but a helper shared with the
    // in-process stack easily could, and without this it would fail to load
    // here rather than in CI.
    alias: { 'jsr:@supabase/supabase-js@2': '@supabase/supabase-js' },
  },
})
