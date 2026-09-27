# @game-platform/sdk

The game-agnostic rules framework and the contract every game package
implements. Pure TypeScript — no React, no Supabase, no I/O — imported
unmodified by the platform's browser app and its Supabase Edge Functions, so
the rules never exist in two copies.

## Entry points

| Entry | What it is |
| --- | --- |
| `@game-platform/sdk` | `GameState` and friends, `GameDefinition`, the game registry, and the engine: `applyAction`, `createNewGame`, `replayActions`, undo/redo (`applyUndoAction`/`applyRedoAction`, `resolveHistory`), redaction, the in-flight overlay, the game log. |
| `@game-platform/sdk/ui` | Type-only React contract for a game's view: `GameUi`, `GameViewProps`, `GameOptionsEditorProps`, `SeatInfo`. Kept apart so nothing React-related reaches the Edge Functions. |
| `@game-platform/sdk/testing` | Test helpers for game packages: `seatPlayers`, `act`, `withoutTimestamps`. |

## How it fits together

- A game package exports a `GameDefinition` (its rules) and a `GameUi` (its
  view). See `packages/unique-pick/README.md` for the full contract and the
  rules every game must follow.
- The platform app registers each game's definition once at startup
  (`registerGame`, from `src/games/registry.ts`). Every `GameState` records
  its `gameType` and `rulesVersion`, and the engine finds that game's rules in
  the registry — so one deployment can run several games, and a game keeps
  replaying under the rules it started with after a newer version ships.
- The framework owns everything every game shares: the append-only action log
  (event sourcing), undo/redo as logged actions, concede, room admin mode,
  folding forced follow-up moves into one log entry, and per-viewer redaction
  of whatever the game keeps secret.
- Randomness is seeded: each game carries a seed rolled when its room was
  created (`GameState.randomSeed`), and `gameRandom(state, ...keys)`
  (`src/random.ts`) turns it into a deterministic stream, so replay rolls the
  same numbers every time. Rules never call `Math.random()`.

Every relative import inside this package carries an explicit `.ts` extension
because the Supabase Edge Runtime (Deno) doesn't resolve extensionless
imports.

## Publishing

The package ships TypeScript source (`exports` point at `src/`), which Vite,
Vitest and the Edge Functions' import map all consume directly. Game packages
in other repos should depend on it as a peer dependency; publish it to a
registry (GitHub Packages for a private setup) when a game repo needs it
outside this monorepo.
