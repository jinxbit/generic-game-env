# @game-platform/bauernschlau

**Bauernschlau (Crooked Shepherds)** for 2–6 players. Put sheep face down
on the fields — only you know what yours are worth — build fences out from
your farmhouse to the edge of the hex board to enclose your farm, and turn
over sheep (or send in the dog) to find out what everyone's farm is really
worth. A black sheep turned over gives two extra actions. The game ends when
an enclosed farm is full; enclosed farms score their face-up sheep, bonus
fields multiply them by 2 or 3, and every unused fence costs a point.
[`RULES.md`](./RULES.md) is the source of truth. Its rule ids (`R-FENCE-03`,
`AMBIG-4` and so on) are cited in the code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/bauernschlau/rules` | `src/rules.ts` | `gameDefinition`, options, types and read-only helpers for the view. Server-safe. |
| `@game-platform/bauernschlau/view` | `src/view.ts` | `ui`: the React table (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/bauernschlau/testing` | `src/testing.ts` | `newGame`, `play`, `placeSheep`, `skipOpening`, `arrange`, `finishBorders`, `picks`, `simplestMove` for tests. |

## How the engine works

- **Geometry is strings.** `src/board.ts` names a hex corner (a *vertex*) by
  the three hexes meeting there — off-board hexes included, which is what
  makes a vertex lie on the board's edge — and an edge by the two hexes it
  separates. A fence line is a list of vertex names, so it stores as plain
  JSON and every legality check is set arithmetic. `fenceMoves` lists every
  legal fence for a border; the view draws exactly those.
- **Farms are derived, never stored.** A farm's fields are a flood fill from
  its farmhouse that doesn't cross a fence (`farmFields`); enclosure is "both
  borders finished"; scores are recomputed from the board.
- **A small step machine.** `GameData.step` is `choose` → (`place`, while
  the player holds drawn sheep) → the next action or player, or `ended`.
  `actionsLeft` counts the turn's actions, black-sheep bonuses included.
  `withEnvelope` derives `phase`, `activePlayerId` and `pendingPlayerIds`
  from the step in one place.
- **Hidden information.** Drawing a sheep and placing it are two actions, so
  the player sees the sheep before choosing a field. `redactGame` hides the
  bag, the hand of whoever is placing, and every face-down sheep from all but
  the player who placed it. No action or narration names a face-down sheep,
  so `isActionSecret` is always false; draws come from the framework's
  `Random` and are recorded on the entry that drew them, which a redacted
  viewer never receives. In a room that locks revealed information, a draw
  can't be undone by a player (the drawer has seen the sheep).
- **Rules versions.** Version 2 (current) leaves the dog where it was set
  down after herding, adds the first-edition option (on by default: a black
  sheep herded by the dog gives no extra actions) and replaces the six ×2
  geese fields with 18 ×2/×3 bonus fields. Version 1 let the dog move on
  afterwards, always gave the bonus and had the geese; it stays registered
  (`gameDefinitionV1`) so games started under it still replay. Both run from
  one code path that branches on `state.rulesVersion` (RULES.md §11).
- **Every action consumes something** — a sheep from the bag, a face-down
  sheep, a fence — so a game always ends: by a full enclosed farm, or when
  nobody can act.

## Decisions beyond the rules sheet

The sheet is one page, with no board, no counter mix and no examples. Every
open point is listed in RULES.md §10 with the behaviour chosen. The ones most
likely to matter at the table:

- The board is a radius-5 hex hexagon: 84 fields (AMBIG-1), 18 of them bonus
  fields — ×2 on ring 2 between the long diagonals, ×3 on ring 3 on them, ×3
  on ring 4 midway between them (R-BOARD-03).
- 90 sheep counters, +5 to −4, 10 of them black (AMBIG-3).
- A fence may run sideways along a ring of hexes, never inward (AMBIG-6).
- After herding, the dog stays where it was set down (R-DOG-04, AMBIG-5).
- First-edition rule, on by default: herding a black sheep with the dog gives
  no extra actions (R-DOG-03).
- Face-down sheep score nothing at the end (AMBIG-9).
