# CLAUDE.md

Guidance for working in this repo. Read this before making changes.

## What this is

A **generic platform for turn-based board games** played remotely
(live/async) or on one shared device (hotseat): accounts, rooms and lobbies,
an event-sourced rules framework with shared undo/redo, server-side rule
enforcement, hidden information, realtime sync, chat and notifications.
Vite + React 19 + TypeScript + Tailwind v4 on the frontend, Supabase
(Postgres + RLS + Realtime + Auth + Edge Functions) on the backend, Vercel
for hosting.

This repo is an npm-workspaces monorepo and the **main platform repo**.
Games are packages: the rules framework is `packages/sdk`
(`@game-platform/sdk`), and each game is its own package — here the
example game, **Unique Pick** (`packages/unique-pick`), which exists to
exercise every platform feature and is the test fixture, **Incorporated**
(`packages/incorporated`, rules spec in its `RULES.md`), **Kogge**
(`packages/kogge`, rules spec in its `RULES.md`), **Shark**
(`packages/shark`, rules spec in its `RULES.md`), **Texas Hold'em**
(`packages/texas-holdem`, rules spec in its `RULES.md`), **Bauernschlau**
(`packages/bauernschlau`, rules spec in its `RULES.md`), **Magna Grecia**
(`packages/magna-grecia`, rules spec in its `RULES.md`) and **Rise & Fall**
(`packages/rise-and-fall`, the platform's original game, moved here from its
standalone app — its engine runs behind an adapter; see its `README.md`). A game can live in
its own repo and be installed. One deployment hosts whichever games
`src/games/registry.ts` registers. Read `packages/unique-pick/README.md`
before building or changing a game, and `GAME_IMPLEMENTATION_LEARNINGS.md`
before adding one.

## Commands

```bash
npm install          # or npm ci
npm run dev          # Vite dev server on :5173
npm run test         # vitest run (app + packages) — ~60 files / ~600 tests, ~25s
npm run test:watch   # vitest watch
npm run test:smoke   # smoke-test a LIVE Supabase project (needs SMOKE_* env vars)
npm run seed:preview # put one finished game into a LIVE project and LEAVE it there
npm run lint         # oxlint (not eslint) — sub-second
npm run build        # tsc -b (3 projects) + vite build
```

CI (`.github/workflows/ci.yml`) runs `lint`, `test`, `build` and a `deno check` of the Edge Functions on
every PR. Run them all before pushing; they are fast enough that there is no
excuse to skip them.

A green CI run on a PR can merge it: `automerge.yml` merges into `main`
without waiting for the maintainer, but only for a PR that is not a draft, is
based on `main`, has its head on a `claude/` branch **in this repository**,
carries the `automerge` label, touches no `supabase/migrations/**`, and is
still at the commit CI passed on. A migration always gets a human read
(`DELIVERY_PIPELINE_PLAN.md` §7). The PR itself is opened by
`claude-branch-pr.yml` when `claude.yml` pushes a `claude/issue-**` branch —
the action only posts a "Create PR" link, so without this a finished branch
sits unmerged — and that workflow applies the label, which is what makes the
issue-to-pre-production loop run unattended. Issues enter that loop through
`claude-queue.yml`: label an issue `queued` and it is started — `priority`
first, then lowest number, **one at a time** — as soon as the label lands if
nothing is in flight, otherwise when the previous one closes.
`priority` reorders the queue; it never interrupts an issue already running. An issue that needs a
decision holds the queue on purpose, which is what the `in-progress` label on
a stalled issue means — but an `in-progress` issue with no branch and no open
PR after 90 minutes is treated as a start that never happened and is
requeued, so a run that dies before Claude begins cannot hold the queue
forever. A PR that exists but is *stuck* — red CI, or a conflict with `main` —
was the other way the queue stalled indefinitely, since that stale check
ignores anything with an open PR and `automerge.yml` only ever acts on a
**successful** CI run. The hourly sweep now comments `@claude` on such a PR
(a comment being what starts `claude.yml`), once per head commit and at most
three times, then stands down on the PR saying a human is needed rather than
spending runs on it. The issue is closed by `automerge.yml` when its PR
merges — not by the PR body's `Closes #N`, which comes from a `push`-triggered
workflow and so can be written by a stale copy of itself on an older branch. Both that workflow and `smoke.yml`'s
failure reporting need the `AUTOMATION_TOKEN` secret, because GitHub does not
start workflow runs from events its own `GITHUB_TOKEN` caused — without it a
merge would reach `main` without triggering CI or the Supabase deploy, so
`automerge.yml` declines to merge at all.

Copy `.env.example` to `.env.local` for local dev. Without
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` the app throws a
"Configuration error" at startup by design (`src/lib/supabase.ts`). Tests and
build need no env vars.

## Architecture — the layering rules that matter

```
packages/sdk/  @game-platform/sdk: game-agnostic rules framework + registry + game contract — no React, no Supabase, no I/O
packages/<game>/ one package per game: `rules` entry (a GameDefinition, server-safe) + `view` entry (React)
src/games/     the deployment's game list: registry.ts (rules, imported everywhere rules run) + ui.ts (views)
src/site.ts    site branding (title, tagline) — also read by vite.config.ts
src/lib/       Supabase client, typed queries (gameApi.ts), genesis, storage encoding, delta protocol
src/hooks/     React hooks (auth, admin, display name, preferences)
src/pages/     routed screens (see src/App.tsx); GamePage.tsx is the in-game shell
src/components/ platform UI (chat, log, cards, settings, auth)
supabase/      migrations (one baseline + later) and Edge Functions (enforcement, redaction, notifications)
src/test/      vitest setup, an in-process production-like Supabase stack, replay fixtures
```

Five invariants hold across the whole codebase. Breaking any of them will
break replay, the Edge Functions, or both:

1. **`applyAction()` (`packages/sdk/src/applyAction.ts`) is the only place
   game rules run.** UI and network layers treat `GameState` as opaque and
   change it exclusively by dispatching an `Action`. Framework actions
   (CONCEDE, UNDO_ACTION, REDO_ACTION, SET_ADMIN_MODE) are handled by the SDK;
   every other action goes to the rules of the game the state belongs to,
   found in the registry (`packages/sdk/src/registry.ts`) by the state's
   `gameType`/`rulesVersion`.
2. **The framework never knows a game, and games never know the app.** The
   SDK reads nothing inside `GameState.game`; everything game-specific goes
   through `GameDefinition` (rules, labels, options) and `GameUi` (view,
   options form). Game packages depend only on the SDK — never on `src/`.
   Platform screens get game names/labels from the definition
   (`findGameDefinition(game.game_type, …)`) and render games through
   `src/games/ui.ts`. Anything that runs rules must import
   `src/games/registry.ts` first (the browser entry, `supabase/functions/_shared/games.ts`
   and `src/test/setup.ts` do).
3. **Event sourcing.** `GameState.actionHistory` is append-only and never
   pruned or reordered. Current state = genesis (`buildGenesisState`,
   `src/lib/gameGenesis.ts`, a deterministic function of the `games` row +
   seated `players`) replayed through `replayActions` (`@game-platform/sdk`).
   Undo/redo are themselves logged actions folded in by `resolveHistory`
   (`packages/sdk/src/historyFold.ts`) — not a client-local stack. Anything that
   makes replay non-deterministic (randomness, clock reads, ambient state) is
   a bug; a game's hooks draw only from the `Random` the framework passes
   them, and every number drawn is recorded (`LoggedAction.random`, or
   `GameState.setupRandom` for setup) and fed back on replay
   (`packages/sdk/src/random.ts`). Fresh numbers for a rule-enforced game come
   from a per-game seed in `game_secrets`, which only the Edge Functions can
   read (`loadRandomSeed`, `supabase/functions/_shared/gameEnforcement.ts`);
   a client-trusted game's client rolls its own (`src/lib/randomSource.ts`).
   Never put the seed anywhere a client can read. A game always replays under the `rulesVersion` it
   started with (pinned in `games.settings.rulesVersion` and on the state), so
   a replay-incompatible rules change ships as a new version registered
   alongside the old one.
4. **One submitted action → exactly one `actionHistory` entry.** A forced
   single-option follow-up (`GameDefinition.nextForcedAction`) is dispatched
   inside the same `applyAction` call and folded into the same log entry.
   Don't reintroduce per-step entries or an "automatic" flag.
5. **`pendingPlayerIds` is always "who may act right now".** The game keeps
   it accurate (`[activePlayerId]` in a sequential turn, several ids in a
   simultaneous phase, `[]` otherwise); notifications, listing badges,
   hotseat hand-off and admin mode all read it, and the DB projects it into
   `game_state_meta`.

`GameState` is `packages/sdk/src/types.ts`; DB row shapes are `src/lib/dbTypes.ts`
— deliberately separate types, don't merge them.

## The two write paths

Per-game flag `games.settings.ruleEnforcementEnabled` selects which one a
game uses. It reads as `false` when absent (`createGame()` defaults it to
`false` when omitted). `CreateGamePage.tsx` always passes `true`, so every
game created through the UI is enforced; the client-trusted path remains for
other callers (tests, admin import, duplicate-as-hotseat of a client-trusted
game).

`games.settings.hiddenInformationEnabled` (only meaningful alongside rule
enforcement) follows the same split: `createGame()` defaults it to `false`,
and `CreateGamePage.tsx` passes `hiddenInformationAvailable`
(`src/lib/hiddenInformationEligibility.ts`) — on for every non-hotseat game.

`GamePage.tsx`'s `submitAction` branches on it:

- **Client-trusted:** the client runs `applyAction()` itself and writes
  `game_state` directly, with an optimistic-concurrency retry loop against
  the `version` column (`writeWithRetry`). State is stored as plain JSON.
- **Rule-enforced:** the client posts the raw `Action` to the
  `apply-action` / `undo-action` / `redo-action` Edge Functions. The server
  resolves the caller's seat from their JWT, rejects any action whose
  `playerId` isn't theirs, re-derives the state, and does its own
  compare-and-swap write. RLS forbids direct client writes for these games.
  State is stored gzip+base64 under `__gz`, with `status`/`phase`/`turn`/
  `pendingPlayerIds`/`activePlayerId`/`turnOrder` duplicated in plaintext so
  the `game_state_sync_meta` trigger can still project `game_state_meta`
  (`src/lib/gameStateCompression.ts`).

Read paths handle both encodings per-row via `decompressGameStateFromStorage`.
Any change touching submission, undo, or storage must work on **both** paths.

The split starts at genesis: `LobbyPage.tsx`'s Start Game
(`gameApi.ts`'s `startGameFromLobby()`) builds genesis locally for a
client-trusted game, but posts `{ gameId }` to the `start-game` Edge Function
for an enforced one, which re-fetches the roster itself and does the insert
plus the `games.status` flip under a service-role client. The baseline
migration blocks a direct client from doing either write for an enforced
game (the latter in the `enforce_game_status_transition` trigger, since it
needs both the old and new status).

**Hidden information.** A hidden-information game reads through the
`get-game-state` Edge Function, and the write functions redact their
responses the same way (`redactedResponseState`). What's secret is the
game's call (`GameDefinition.redactGame`/`isActionSecret`); the framework
(`packages/sdk/src/redaction.ts`) masks the state and replaces secret log
entries with `HIDDEN_ACTION` placeholders. A redacted viewer's client never
runs the rules: it reads through the **view log**
(`packages/sdk/src/viewLog.ts`, protocol 3). Every write to such a game records
on the new entry, from states the server already holds and in the same row
write:
- each viewer's patch of their own view;
- earlier entries whose secrecy flipped;
- the entry's narration.

A read is then a slice of stored entries in that viewer's form, which the
client folds onto its view (`src/lib/viewLogClient.ts`) and checks against a
server hash, with the whole log and undo/redo intact. History review fetches
the viewer's genesis view plus patches on demand. `respondWithViewLog` /
`respondToWrite` in `supabase/functions/_shared/gameEnforcement.ts` build
these responses. Everyone else (admins, games whose log predates the view
log, old bundles) keeps the replay protocol (`respondWithState`,
`src/lib/replayDelta.ts`, the in-flight overlay). Never add a DB round trip to
a write for this: the reverted #648 attempt doubled latency that way.

## Supabase / Edge Function gotchas

- **Edge Functions import the SDK, the registered games' `rules` entries, and
  `src/lib/` directly and unmodified.** There is no rule-logic duplication
  between client and server, and there must not be. Bare package specifiers
  resolve through the `imports` map in `supabase/functions/deno.json`, which
  the Edge Runtime finds by walking up from each function. `supabase functions
  deploy` does not: it bundles in Docker with only the files it chose to
  mount, and follows `@game-platform/*` into `packages/` only for a function
  whose `[functions.<name>] import_map` in `config.toml` points at that file —
  so **every function needs that entry**, or the deploy fails with `Module not
  found ".../packages/<game>/src/rules.ts"`. It also sets `"nodeModulesDir": "none"` so Deno
  fetches `npm:`/`jsr:` dependencies itself instead of looking in the repo's
  `node_modules`. `src/test/__tests__/edgeFunctionImports.test.ts` fails if a
  reachable specifier isn't mapped, a mapped file is missing, or a function
  has no `import_map` entry. **Adding a game means adding its `rules` entry to
  that map; adding a function means adding its `config.toml` entry.**
- **The Edge Runtime does not honor `sloppy-imports`.** Every relative import
  in the graph reachable from `supabase/functions/` must carry an explicit
  `.ts` extension, and JSON imports need `with { type: 'json' }`. That graph
  includes all of `packages/sdk/src/` (except `ui.ts`/`testing.ts`), every
  game's `rules` entry and what it imports, `src/games/registry.ts`,
  `src/site.ts`, and the `src/lib/` modules the functions import. A missing
  extension only fails at deploy time, not in CI. Never let React or the
  `view` entry of a game into that graph.
- **`main` is pre-production, not production.** `.github/workflows/deploy-supabase.yml`
  deploys to the **Preview** Supabase project on push to `main`, and to
  production on push to the `production` branch — which is only ever
  fast-forwarded to a commit `main` already carries, by the `Promote to
  production` workflow (`promote.yml`), which checks the commit is on `main`,
  that CI is green on it and that pre-production is not red, then waits for an
  approval on the `production-release` environment before pushing. Vercel mirrors the same
  split. It fires when `supabase/migrations/**`, `supabase/functions/**`, or
  **`src/lib/**`** changes, running `supabase db push` and `supabase functions
  deploy`. A `src/lib` change is a backend change. A migration that would cut
  off the live app must not land alone. See `DELIVERY_PIPELINE_PLAN.md` §3 for
  why the topology is this way round, and §4 for the environments.
- Migrations are numbered `NNNN_name.sql` and applied in lexicographic order.
  The history was squashed into `0001_baseline.sql` when this platform was
  extracted from its first game; later ones follow it (`0002_game_secrets.sql`,
  `0003_game_assets.sql`).
  Add new migrations after them, and never edit one
  once a project has applied it. `audit-and-fix-migrations.yml` verifies each
  migration's actual effect against a real schema dump — read its header
  comment before touching it.
- Tables: `games`, `players`, `game_state`, `game_state_meta`, `profiles`,
  `push_subscriptions`, `app_config`, `chat_messages`, `chat_read_status`,
  `game_secrets` (0002 — server-only: RLS on, no policies; the random
  seed of each rule-enforced game) and `game_assets` (0003 — reusable things
  a game can start from, like a saved map; payload opaque to the platform,
  public ones admin-curated).
  A room's chosen assets are **copied** into `games.assets` (a column, not a
  `settings` key, so listings never carry them), and a random choice is
  picked at Start and written back before genesis — genesis stays a function
  of the row (`src/lib/roomAssets.ts`).
  Per-game config lives in the `games.settings` jsonb column rather than new
  columns — add pregame toggles there (`GameSettings` in `dbTypes.ts`), and
  game-specific options under `settings.gameOptions` (opaque to the platform;
  the game's `normalizeOptions` makes sense of them). `games.game_type` —
  which registered game the room plays, immutable — and `games.assets` are the
  only game-related columns.
  Adding a game needs no migration.
- A local stack (`supabase start` / `db push` / `functions serve`,
  `supabase/config.toml`) needs Docker. The `@claude` GitHub Action runner
  preinstalls the Supabase CLI and Deno for exactly this. To typecheck the
  functions the way Deno sees them without Docker:
  `deno check --config supabase/functions/deno.json supabase/functions/*/index.ts`.

## Testing

- Vitest, jsdom environment, globals enabled, `@testing-library/react` +
  `jest-dom` (`src/test/setup.ts`, config lives in `vite.config.ts`).
- SDK tests (`packages/sdk/src/__tests__/`) pin the framework's invariants,
  using the example game as their fixture; each game's rules tests live in
  its own package (`packages/unique-pick/src/__tests__/`). Both are pure and
  fast — the right place to pin any rules change. Vitest runs them from the
  repo root along with everything else.
- `src/test/supabaseStack/` is an **in-process stack that behaves like
  production**: real `@supabase/supabase-js` clients over a patched `fetch`,
  the real Edge Function handlers, the migrations' RLS (transcribed in
  `database.ts` — keep it in sync with the migrations), the
  `game_state_sync_meta` trigger, `version` CAS, and gzip-at-rest. Only
  Postgres and the Deno runtime are doubles, so it runs on a plain Node CI
  runner with no Docker.
- **Regression-testing a real game is a drop-in:** save a game export into
  `src/test/fixtures/productionGames/<name>.json` (from GamePage's "Copy game
  export") plus an optional `.room.json` sidecar declaring the winners.
  `productionGames.test.ts` globs the folder — no registration step. See
  that folder's README.
- Prefer adding a fixture or an engine/game test over a component test when a
  bug is reproducible at the rules level.
- `src/test/productionSmoke/` replays those same fixtures against the **live**
  project through the deployed Edge Functions (`npm run test:smoke`,
  `.github/workflows/smoke.yml`, after each Supabase deploy and nightly;
  which project it tests comes from the deploy's own `deploy-target`
  artifact, and a failure files an issue carrying a redacted tail of the run —
  mentioning `@claude` for Preview, not for production). It is deliberately
  unreachable from `npm run test`: vitest's default `include` matches
  `*.test.*`, and those files are `*.smoke.ts` under their own config. The
  runner itself is covered on every PR by
  `src/test/__tests__/productionSmokeRunner.test.ts`. Read that folder's
  README before changing it — its isolation rules (private room,
  `play_mode: 'live'` so no notification can fire, delete the room *before*
  the throwaway users) are load-bearing.
- `src/test/previewSeed/` is the same provisioning aimed the other way: it
  replays a fixture into a live project and **deliberately leaves the
  finished game there**, public, for manual testing (`npm run seed:preview`,
  `.github/workflows/seed-preview.yml`, pre-production only). Its `*.seed.ts`
  entry point is unreachable from `npm run test` and `npm run test:smoke`.
  Covered on every PR by `src/test/__tests__/previewSeedRunner.test.ts`.

## Code style

- No semicolons, single quotes, 2-space indent, trailing commas in multiline
  literals. Long lines are fine; there is no Prettier config — match the file
  you're in.
- Lint is **oxlint** with `react/rules-of-hooks` as an error. TypeScript is
  strict-ish via `tsconfig.app.json`: `noUnusedLocals`, `noUnusedParameters`,
  `erasableSyntaxOnly`, `verbatimModuleSyntax` (so `import type` is required
  for type-only imports), `noFallthroughCasesInSwitch`.
- Three TS projects build together: `tsconfig.app.json` (`src`, excluding the
  service worker), `tsconfig.node.json` (`vite.config.ts`),
  `tsconfig.sw.json` (`src/sw.ts`, WebWorker lib).
- **This codebase documents heavily in doc comments** — most modules open
  with a comment explaining not just what they do but why. When you change
  behavior these comments describe, update them in the same commit; they are
  the real design record.

## Documentation map

| File | What it is |
| --- | --- |
| `README.md` | Setup and operations: Supabase, Discord/Google OAuth, Discord + Web Push notifications, guest auth, hotseat, server-side rule enforcement, game-state export. |
| `packages/unique-pick/README.md` | **How a game package works**: the `GameDefinition`/`GameUi` contract, the rules every game must follow, rules versions, and starting a game in its own repo. |
| `GAME_IMPLEMENTATION_LEARNINGS.md` | Lessons from implementing games here: workflow from rulebook to package, engine patterns, pitfalls hit, platform wiring checklist, testing helpers. |
| `packages/sdk/README.md` | The framework package: entry points and how the registry fits together. |
| `CHAT_PLAN.md` | Site-wide + in-game chat design record. |
| `DELIVERY_PIPELINE_PLAN.md` | How a change reaches production: the pre-production environment, branch topology, what auto-merges and what never does. |
| `PRODUCTION_DEPLOYMENT.md` | The production deployment runbook: preconditions, how to promote, what to watch afterwards, how to recover, and hotfixes. |

## Working conventions

- Branch, commit, and push as instructed; don't open a PR unless asked.
- Keep changes minimal and in the style of the surrounding code.
- Settings that matter to a running game are copied onto `GameState` at
  genesis (`gameType`, `rulesVersion`, `options`, `hiddenInformationEnabled`,
  `lockRevealedInformationEnabled`)
  so a running game and its export stay self-contained; read them from
  `GameState`, not the `games` row.
