# Implementing a game — learnings

Notes from adding **Incorporated** and **Shark** to this platform, meant to
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
4. **Wire it into the platform** (five small edits — see §4), then run
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

## 3. Pitfalls actually hit

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
- **Money formatting.** Don't use `toLocaleString` in rules narration: the
  Edge Runtime and browsers can format differently, and the narration is
  stored. Format by hand (`formatFT`).
- **Error messages with pluralisation**: check each branch reads right —
  "hold only 2" vs "2 shares already cover the debt" are different
  failures; test both.

## 4. Platform wiring checklist

| File | Change |
| --- | --- |
| `packages/<game>/package.json` | `exports` for `./rules`, `./view`, `./testing`; SDK and React as peer deps. |
| root `package.json` | `"@game-platform/<game>": "*"` in `dependencies`, then `npm install` (updates the lockfile and the workspace symlink). |
| `src/games/registry.ts` | import the `gameDefinition` and add it to `REGISTERED_GAMES`. |
| `src/games/ui.ts` | import the `ui` and add it to the list. |
| `supabase/functions/deno.json` | map `@game-platform/<game>/rules` to `../../packages/<game>/src/rules.ts`. `edgeFunctionImports.test.ts` fails without it. |
| `CLAUDE.md` | mention the game where the packages are listed. |

No migration is needed: the database stores `GameState` as opaque JSON.

## 5. Edge Runtime constraints (easy to forget)

- Every relative import reachable from `rules.ts` needs an explicit `.ts`
  extension. A missing one fails only at **deploy** time; `deno check` catches
  it locally. Deno is not preinstalled in every environment —
  `npm i deno` into a scratch directory gives a working binary.
- Nothing React-related may be reachable from `rules.ts`. Keep view helpers
  in `src/view/` and import rules helpers *into* the view, never the other
  way round.
- Re-exporting from the rules entry (`export * from './board.ts'`) is fine
  and lets the view and tests import everything from `../rules`.

## 6. View tips

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

## 7. Testing helpers to provide in `src/testing.ts`

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
