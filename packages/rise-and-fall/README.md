# @game-platform/rise-and-fall

**Rise & Fall** for 2–8 players: an original strategy game on a hex map. The
players build the map together from terrain tiles, then play rounds in which
everyone secretly picks one unit-kind card, the units of that kind act (move,
produce, trade, build, convert), achievements are claimed, and cards cycle
through hand, discard, decline and supply. The game ends once the chosen
number of achievements has been claimed; most victory points wins. Optional
**Tales** add structures and events.

The rules spec is the content itself plus its documentation:
[`src/content/README.md`](./src/content/README.md) (every content field,
board generation, achievements and VP, resources, Tales),
[`UnitActions.md`](./UnitActions.md) (every unit action and the resolved
rules questions) and [`VARIANTS_PLAN.md`](./VARIANTS_PLAN.md) (the Tales).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/rise-and-fall/rules` | `src/rules.ts` | `gameDefinition`, options, types, `toEngine`/`engineGenesisOf`/`contentFor` for the view. Server-safe. |
| `@game-platform/rise-and-fall/view` | `src/view.ts` | `ui`: the React game view (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/rise-and-fall/testing` | `src/testing.ts` | `newGame`, `play`, `simplestMove`, `testRandom` for tests. |

## Where it came from, and how it's put together

Rise & Fall was first built as its own app (`jinxbit/rise-and-fall`), from
which this platform was later extracted. This package is that app's game
moved onto the platform:

- **`src/engine/` is the original rules engine, nearly verbatim** — the same
  modules and their 800-odd tests (`src/engine/__tests__/`). It works on its
  own flat state (`EngineState`, `src/engine/types.ts`) that holds seats, turn
  order and the game's data in one object. Its doc comments cite that app's
  design documents (`RULE_ENFORCEMENT_PLAN.md`, `HIDDEN_INFORMATION_PLAN.md`,
  `todo.md`, …) and issue numbers; those live in the original repository.
  Changes here: explicit `.ts` import extensions (the rules run in the Edge
  Functions), CONCEDE during board setup, and two exports the platform needs — `applyGameAction` (one
  dispatch, no log entry, no follow-ups) and `nextForcedFollowUp`.
- **`src/adapter.ts` is the seam.** `toEngine` joins the platform's envelope
  and `GameData` into an `EngineState`; `toPlatform` splits an engine result
  back and derives the envelope: board setup is an `active` game whose `phase`
  is `placeTiles`/`placeUnits`; `pendingPlayerIds` holds each player once and
  only whoever may act now (the engine's own list, which repeats a player per
  card owed in decline and queues the whole actions phase, is kept in
  `GameData`). `GameData` is the engine state minus what the envelope and
  options carry.
- **`src/content/`** is the game's data (units, terrain, achievements,
  resources, Tales, map templates); `src/gameContent.ts` resolves it for a
  game's player count, Tales and length — the engine never imports JSON.
- **The framework took over** the action log, undo/redo, admin mode, the
  bookkeeping of CONCEDE (the engine still runs its own concede in
  `onPlayerEliminated`, and now also handles a concede during board setup —
  `src/engine/boardSetupConcede.ts` — which the original app never allowed) and the forced-follow-up loop
  (a one-card hand's pick, an owed decline with no choice, a tile tier with
  one arrangement left — `nextForcedAction`).
- **Narration** is the engine's own (`describePrimaryAction` and
  `describeCascade`, `src/engine/gameLog.ts`); a step's cascade — a card
  entering a hand, an achievement claimed, "Round N begins" — becomes the
  `extraLines` of its description.

### Options

`GameOptions` (`src/types.ts`): game length (achievements to end), active
Tales, and how the map is made — built together (default), built alone by
the host or a random player (with the builder's starting units placed last
or in a shuffled order), or a pre-made template. The random choices are the
game's only randomness, drawn in `setup` and recorded as `setupRandom`;
`GameData.seating` keeps what they resolved to, so the view can rebuild the
engine's genesis (`engineGenesisOf`) without them.

### Hidden information

Each simultaneous phase keeps one secret until everyone has acted: which
card a player chose (select cards), which cards they moved to decline, and
which card they bought back (purchase). `redactGame` shows everyone else the
state as it was before those moves (the chosen card as `null`, a declined
card back in hand or discard, a bought-back card still in decline);
`isActionSecret` hides the matching log entries for exactly as long, and the
narration of a hidden pick reads "chose a card".

## Not carried over from the standalone app

- **The map pool** (admin-saved boards in a `map_pool` table, the map
  builder and admin maps pages, "random saved map" mode). The platform has no
  such table; pre-made maps are the content's `mapTemplates.json`.
- **Per-account preferences** stored on the profile (unit plate colours, the
  unit-reserve display, confirm-before-revealing-cards) — see the view for
  what it keeps locally.
- **Existing games.** Games played in the standalone app aren't migrated:
  their exports are a different format. `src/__tests__/productionGames.test.ts`
  replays three of them through the platform path and checks the result
  matches the original engine field for field, so the rules are the same.
- **Replaying legacy log entries.** The original engine could skip a
  standalone entry for a forced follow-up logged before it folded those into
  the triggering action (`isStaleForcedFollowUp`). A game started on the
  platform never has one.

## Tests

- `src/engine/__tests__/` — the original engine tests.
- `src/__tests__/productionGames.test.ts` — real games from the original app,
  replayed through the platform and compared with the original engine, plus
  their declared final scores and winners.
- `src/__tests__/rules.test.ts` — options, setup modes, the envelope, concede
  at every stage, hidden information, narration.
- `src/__tests__/fuzz.test.ts` — random games with unit actions, declines,
  buy-backs and retractions; invariants, redaction and replay.
- `src/test/__tests__/riseAndFallStack.test.ts` (platform) — a game through
  the real Edge Functions with hidden information, each client reading the
  view log.
