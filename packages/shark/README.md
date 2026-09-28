# @game-platform/shark

**Shark** for 3–6 players. Roll a colour and a zone, place a marker on the
12 × 10 board, and watch share prices move: groups of a colour raise its
price, and a bigger group swallows the smaller rival groups it touches,
crashing their price. Buy low, get paid dividends on every rise, and make
the others pay for every fall. [`RULES.md`](./RULES.md) is the source of
truth. Its rule ids (`R-PLACE-05`, `AMBIG-4` and so on) are cited in the
code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/shark/rules` | `src/rules.ts` | `gameDefinition`, options, types and read-only helpers for the view. Server-safe. |
| `@game-platform/shark/view` | `src/view.ts` | `ui`: the React table (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/shark/testing` | `src/testing.ts` | `newGame`, `play`, `roll`, `dice`, `arrange`, `simplestMove` for tests. |

## How the engine works

- **The board is the truth for prices.** `src/board.ts` holds every pure
  function of the board: zones, groups (orthogonal flood fill), prices
  (R-PRICE-01..04) and `previewPlacement`, which says whether a placement is
  legal and what it would eliminate. Prices are always recomputed from the
  board, never adjusted incrementally, so they can't drift.
- **A small step machine.** `GameData.step` is `preTrade` → `place` →
  (`debts`) → `postTrade`, then the next player's `preTrade`, or `ended`.
  `withEnvelope` derives `phase`, `activePlayerId` and `pendingPlayerIds`
  from the step in one place, so they are never stale.
- **One decision, one action.** Forced sales with only one way to pay are
  settled automatically (R-DEBT-03), and so is ending a turn when there is
  nothing left to buy or sell (`nextForcedAction`). Only real choices
  prompt a player.
- **Dice** come only from the framework's `Random`, in `ROLL` (two draws: the
  colour die, then the zone die). A roll with no legal placement ends the
  turn inside the same action.
- **No hidden information.** Cash, shares and dice are public, so
  `redactGame` returns the whole state and `isActionSecret` is always false.

## Decisions beyond the rulebook

Every open point is listed in RULES.md §9 with the behaviour chosen. The ones
most likely to matter at the table:

- The colour die has two white faces (AMBIG-1).
- Missing a placement ends the turn with no second trade step (AMBIG-2).
- A placement that doesn't raise the price pays the 1 000 isolated-marker
  bonus (AMBIG-4).
- Joining groups past the 7-cap lowers the price and counts as a fall
  (AMBIG-5).
- Debt that shares can't cover at half price is written off (AMBIG-6).
- Starting cash is a house-rule option; the rulebook's 0 is the default.
