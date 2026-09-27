// Where a game's fresh random numbers come from (see
// @game-platform/sdk's random.ts for how they're recorded and replayed).
//
// A rule-enforced game's numbers are derived from a seed that only the Edge
// Functions can read (`game_secrets`, supabase/migrations/0002_game_secrets.sql):
// `generateRandomSeed` rolls it (../../supabase/functions/_shared/gameEnforcement.ts's
// loadRandomSeed), and the functions turn it into each move's draws with the
// SDK's `seededSource`. A client-trusted game has no server to keep a secret
// for it — its client writes the state itself — so the client rolls its own
// numbers with `cryptoRandomSource`, and they're recorded in the log like any
// others.
//
// Imported by the Edge Functions, so keep relative imports `.ts`-suffixed.

import type { Uint32Source } from '@game-platform/sdk'

/** 128 random bits as 32 lowercase hex characters — a game's secret seed. */
export function generateRandomSeed(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Fresh, unseeded 32-bit numbers from the platform's CSPRNG — the client-trusted path's source. */
export const cryptoRandomSource: Uint32Source = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
