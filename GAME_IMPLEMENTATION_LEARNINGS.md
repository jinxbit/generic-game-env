# Implementing a game — learnings

Notes from adding **Incorporated**, **Shark**, **Vernissage** and **Rise & Fall** to this platform, meant to
make the next game faster. Read `packages/unique-pick/README.md` first for
the contract itself; this file is about how to get from a rulebook to a
merged, green game package with the least rework.

## 1. The workflow that works

1. **Write the rules spec before any code** — `packages/<game>/RULES.md`.
   Give every rule a stable id (`R-PLACE-05`) and turn every gap in the
   rulebook into a numbered `AMBIG-n` with the behaviour you picked. Code
   comments and test names cite these ids, which makes review and later
   rules changes cheap. Rulebooks are often translated or terse (Shark's is);
   rebuild the rule from its worked examples when the prose is unclear, and
   pin each worked example as a test.
2. **Copy a package, don't start blank.** `packages/shark` is the smallest
   complete example with dice, a board and a step machine;
   `packages/incorporated` shows prompts, hidden information and variants;
   `packages/unique-pick` shows simultaneous secret moves.
3. **Split pure board logic from turn logic.** A `board.ts` of pure functions
   (geometry, groups, scoring, "is this move legal and what would it do")
   is trivially testable and is reused by the view for highlighting and
   previews. The rules module then only sequences the turn.
4. **Wire it into the platform** (five small edits — see §5), then run
   `npm run lint`, `npm run build`, `npm run test` and the `deno check`.
5. **Tests in three layers:** rules unit tests (one `describe` per RULES.md
   section), a randomised fuzz game with invariants and a replay check, and a
   game-through-the-Edge-Functions test (`src/test/__tests__/<game>Stack.test.ts`).
   Plus a view smoke test.

## 2. Engine patterns worth reusing

- **Keep an explicit step/prompt in `GameData`, derive the envelope from
  it.** One function (`withEnvelope` in Shark, `pendingFor` in
  Incorporated) sets `phase`, `activePlayerId` and `pendingPlayerIds`. Every
  handler just changes the step. This makes invariant 5
  (`pendingPlayerIds` is always accurate) hold by construction.
- **Recompute derived values from the source of truth** (prices from the
  board) instead of updating them incrementally. It removes a whole class of
  drift bugs and makes the fuzz invariant `prices == pricesOf(board)` free.
- **Throw a private `RuleError` inside handlers and convert it to
  `{ ok: false, error }` once, in `applyAction`.** Validation reads
  top-down (`requireTurnPlayer`, `requireCount`, …) and error messages stay
  user-facing, because the platform shows them verbatim. Rethrow anything
  else, so real bugs surface in tests.
- **Resolve non-decisions automatically.** If a "choice" has one option (a
  debt payable only one way, nothing left to trade), settle it in the same
  action or return it from `nextForcedAction`. Players only get prompted for
  real choices, and invariant 4 (one submitted action, one log entry) holds.
- **Keep "what just happened" on the state** (`lastPlacement`, `lastRoll`,
  `autoSales`) so `describeAction` and the view can narrate it without
  re-deriving. Reset per-action fields at the start of each action, or a
  folded forced follow-up will narrate them twice.
- **Draw randomness in a fixed order and a fixed count per branch** (Shark:
  colour die then zone die, always both). Replay feeds back exactly the
  recorded numbers; drawing a different number of values on replay is an
  error.

## 3. Changing rules after a game has shipped

A rules change that alters genesis or legality makes existing games replay
differently, so it needs a new `rulesVersion` (see
`packages/unique-pick/README.md`, "Changing the rules"). When the change is
small, you don't need a second copy of the package — Shark's version 2
(starting shares, trading at price 0) shows the cheap pattern:

- Branch on the version inside the one code path: `setup` reads
  `lobby.rulesVersion`, and every other hook reads `state.rulesVersion`
  (Shark's `tradesAtZeroPrice(rulesVersion)`). Helpers that the view or
  `nextForcedAction` also use take the version as a parameter.
- Export the old definition as a spread with the old number
  (`export const gameDefinitionV1 = { ...gameDefinition, rulesVersion: 1 }`)
  and register **both** in `src/games/registry.ts`. The registry keys by
  id + version and gives new games the newest one.
- Make `newGame` in `testing.ts` accept `rulesVersion`, register every
  version, pin each old behaviour with one short test, and keep a few fuzz
  seeds on the old version so it stays exercised.
- Existing scenario tests often assume the old genesis (Shark's assumed
  empty hands). Rather than rewrite their arithmetic, start them from an
  `arrange`d state that recreates the old assumption, and add fresh tests
  for the new genesis.
- The Edge Function stack test should start a game on the current version.

## 3a. Porting a game that already has its own engine

Rise & Fall arrived with a mature engine, 800 tests and real finished games,
all written against its own flat state. Rewriting that around the envelope
would have touched every module. What worked instead:

- **Keep the engine verbatim and put an adapter at the seam**
  (`packages/rise-and-fall/src/adapter.ts`). `toEngine` joins envelope and
  `GameData` into the engine's state; `toPlatform` splits it back and
  *derives* the envelope — including the fields whose shape differs, such as
  a pending list that repeats a player or queues a whole sequential phase.
  Keep the engine's own copy of such fields in `GameData`; the envelope is a
  projection of it.
- **Strip what the framework now owns** (log appending, undo/redo, admin mode,
  the forced-follow-up loop) by exporting the engine's single-dispatch and
  "next forced move" functions and wiring them to `applyAction` and
  `nextForcedAction`. The framework's CONCEDE runs first and flags the player
  on the envelope; let `onPlayerEliminated` run the engine's own concede from
  the engine's copy of the state, and cover any stage the old app never let a
  player concede in.
- **Prove equivalence with real games.** Replay the old app's exported games
  through the platform (`replayActions` from a genesis built by the adapter)
  and compare with the old engine's replay field for field
  (`productionGames.test.ts`). It's the cheapest strong evidence the port
  changed nothing.
- **Anything the old app replayed client-side** (turn recaps, end-of-game
  charts) can still replay the engine in the view, from a genesis the rules
  can rebuild without random draws — record what setup resolved in
  `GameData` (`seating`).

## 4. Pitfalls actually hit

- **Shallow copies mutate history.** `{ ...state.game }` copies only the top
  level; writing `game.players[id] = …` then edits the *previous* state's
  record too. Undo and replay keep old states, so this corrupted replay —
  caught only by the fuzz test's `replayActions(...) toEqual(final)` check.
  Copy every nested record you assign into (`players: { ...state.game.players }`)
  or use `structuredClone` for deep edits. Always keep that replay assertion.
- **Test fixtures that don't test what they claim.** Several hand-built
  boards placed a marker diagonally to (not touching) the group it was meant
  to eliminate. Assert the precondition inside the test (e.g. the price
  before the move, the eliminated count) so a wrong fixture fails loudly.
- **A fuzz bot that never reaches the interesting paths.** Uniformly random
  legal moves rarely produced eliminations or forced sales in Shark. Bias the
  bot toward the rare branches (prefer eliminating placements, sell less so
  players hold shares when prices fall), and add a final test asserting that,
  across all fuzz games, each rare path (forced sale, write-off, elimination)
  was reached at least once.
- **`undefined` in state.** The view log's patches travel as JSON, where a
  key holding `undefined` is simply absent. An engine that writes
  `placementId: undefined` broke clients' patching until `diffState` learned
  to treat such keys as absent (`packages/sdk/src/statePatch.ts`). Prefer
  omitting a key or using `null`; the stack test is what catches this.
- **Money formatting.** Don't use `toLocaleString` in rules narration: the
  Edge Runtime and browsers can format differently, and the narration is
  stored. Format by hand (`formatFT`).
- **Forced moves can leak a hand.** Auto-answering for a player who has
  no might card (Vernissage) would tell everyone their hand holds none, and
  `pendingPlayerIds` is public too. Ask everyone who *could* have a choice
  (every player when an artist goes IN), and skip a step only on information
  that is already public (an empty hand's size).
- **Error messages with pluralisation**: check each branch reads right —
  "hold only 2" vs "2 shares already cover the debt" are different
  failures; test both.

## 5. Platform wiring checklist

| File | Change |
| --- | --- |
| `packages/<game>/package.json` | `exports` for `./rules`, `./view`, `./testing`; SDK and React as peer deps. |
| root `package.json` | `"@game-platform/<game>": "*"` in `dependencies`, then `npm install` (updates the lockfile and the workspace symlink). |
| `src/games/registry.ts` | import the `gameDefinition` and add it to `REGISTERED_GAMES`. |
| `src/games/ui.ts` | import the `ui` and add it to the list. |
| `supabase/functions/deno.json` | map `@game-platform/<game>/rules` to `../../packages/<game>/src/rules.ts`. `edgeFunctionImports.test.ts` fails without it. |
| `CLAUDE.md` | mention the game where the packages are listed. |

No migration is needed: the database stores `GameState` as opaque JSON.

## 6. Edge Runtime constraints (easy to forget)

- Every relative import reachable from `rules.ts` needs an explicit `.ts`
  extension. A missing one fails only at **deploy** time; `deno check` catches
  it locally. Deno is not preinstalled in every environment —
  `npm i deno` into a scratch directory gives a working binary.
- Nothing React-related may be reachable from `rules.ts`. Keep view helpers
  in `src/view/` and import rules helpers *into* the view, never the other
  way round.
- Re-exporting from the rules entry (`export * from './board.ts'`) is fine
  and lets the view and tests import everything from `../rules`.

## 7. View tips

- The view receives `myPlayerId` (null when read-only) and should show
  controls only when `pendingPlayerIds` includes it; everything else is a
  "waiting for …" line.
- Let the rules validate; the view only guides. Disable buttons for the
  obvious cases (cost above cash, over the purchase cap) but don't duplicate
  every rule.
- Reuse the board module for UI affordances: Shark rings exactly the cells
  `placementsForRoll` returns and shows `previewPlacement` in each tooltip.
- A view test that plays a whole game with `simplestMove`, rendering every
  N states, catches crashes on rare states cheaply.

## 8. Testing helpers to provide in `src/testing.ts`

- `newGame(params)` — registers the game and builds genesis with `seatPlayers`.
- `play(state, action, random)` — `act` with a seed or a source.
- A dice helper that forces specific faces (`dice('red', 4)`): compute the
  32-bit value that lands `random.int(0, n-1)` on face `i` as
  `floor((i + 0.5) / n * 2^32)`.
- `arrange(state, edit)` — edit a copy of `game`, then recompute derived
  values and the envelope. Great for setting up rule scenarios without
  playing to them.
- `simplestMove(state)` — the first legal move for whoever is pending; used by
  the fuzz test, the view test and the Edge Function stack test.
