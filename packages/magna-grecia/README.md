# @game-platform/magna-grecia

**Magna Grecia** for 2–4 players. Over 12 rounds (or 8), found cities on
the villages of southern Italy, link them with roads, build markets in
villages and rivals' cities, and win the oracles' attention. Each round's
action card sets the turn order and how many roads, city tiles or resupplied
tiles a player may use — two actions at their value, or one enhanced. City
tiles and markets cost points; selling a market brings points back. At the
end, points left + active markets (worth the places directly connected to
where they stand) + 4 per oracle decide the winner.
[`RULES.md`](./RULES.md) is the source of truth. Its rule ids (`R-CITY-04`,
`AMBIG-6` and so on) are cited in the code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/magna-grecia/rules` | `src/rules.ts` | `gameDefinition`, options, types, the map and cards, and read-only helpers for the view. Server-safe. |
| `@game-platform/magna-grecia/view` | `src/view.ts` | `ui`: the React table (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/magna-grecia/testing` | `src/testing.ts` | `newGame`, `play`, `arrange`, `simplestMove` for tests. |

## How the engine works

- **Static data** (`src/data.ts`): the 13 × 13 map, drawn as ASCII, with 10
  green-bordered edge villages and 13 inland ones; the 12 action cards; the
  step tracks that give each action's enhanced value. The rulebook shows
  neither map nor card values, so both are original (RULES.md AMBIG-1/2).
- **The tiles are the truth.** `src/board.ts` keeps nothing incremental:
  `analyse` rebuilds cities (groups of a player's tiles, named by the village
  they were founded on) and roads (chains of joined tiles) from the tiles,
  and from them the direct connections between places. Market activity and
  value, a city's importance, and what a city tile or road would do on a
  cell (`planCity`, `roadProblem`, `planMarket`) are all pure functions of
  that. Only oracle attention is stored, because a tie keeps the oracle where
  it was (R-ORACLE-03) — history matters.
- **One step, one turn player.** `GameData.progress` records what the turn
  player has placed so far; `withinAllowance` checks it against the card
  (R-ACT-04). Placing tiles and resupplying keep the turn going; building or
  selling a market, or ending the turn, passes the card on. `withEnvelope`
  derives `phase`, `activePlayerId` and `pendingPlayerIds` in one place.
- **Bridging** (a city tile next to a village plus a second tile on it,
  R-CITY-04) is a single `PLACE_CITY` move that places both tiles, so there
  is never a half-done placement to undo.
- **Randomness**: setup draws the oracles' villages and the first card; each
  later round draws its card when it starts. No stack is pre-shuffled, so
  nothing is hidden (`redactGame` returns the whole state, `isActionSecret`
  is always false).
- **Forced moves**: a turn player with nothing they could do (no legal tile,
  no resupply, no market to build or sell) passes automatically
  (`nextForcedAction`).

## Decisions beyond the rulebook

Every open point is listed in RULES.md §11 with the behaviour chosen. The ones
most likely to matter at the table:

- A road tile's end must point at what it builds from (AMBIG-5), and may not
  point off the board (AMBIG-4).
- Founding off a village is only the two-tile bridge (AMBIG-6), and a tile
  may not join two of your own cities (AMBIG-7).
- A market worth 0 can't be sold (AMBIG-9).
- When several cities overtake an oracle's city at once, the most important
  wins, then the mover's, then the first founded (AMBIG-10).
