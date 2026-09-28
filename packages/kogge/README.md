# @game-platform/kogge

**Kogge** for 2–4 players. Hanseatic merchants sail between nine Baltic
cities, bid route markers for turn order, trade goods, and build houses. The
first to 5 development points wins; otherwise the most victory points win
once the Guildmaster has come back to its start twice.
[`RULES.md`](./RULES.md) is the source of truth. Rule ids from it
(`R-AUC-03`, `[AMBIG-2]` and so on) are cited throughout the code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/kogge/rules` | `src/rules.ts` | `gameDefinition`, options, types and read-only helpers for the view. Server-safe. |
| `@game-platform/kogge/view` | `src/view.ts` | `ui`: the React board (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/kogge/testing` | `src/testing.ts` | `newGame`, `play`, `arrange`, `atTurn`, `startAll`, `simplestMove` for tests. |

## How the engine works

- **A small state machine.** `src/engine.ts` keeps `GameData.stage`
  (`start` → `auction` → `guildmaster` → `actions`, round after round, then
  `over`). In the Actions phase `turn` tracks the current player's moves and
  used actions; a raid (`raid`) or a trade offer (`offer`) briefly hands the
  move to another player. `pendingPlayerIds` is always derived from these.
- **One action per step the player decides.** Each move, each action, each
  bid is one log entry. Anything without a real choice happens inside the
  entry that caused it: players who can't bid are skipped, a one-colour raid
  split is made automatically, house goods are collected on arrival.
- **Content is data.** Cities, colours and component counts live in
  `src/data.ts`; bid strength in `src/bids.ts`.
- **Open questions are one-line switches** in `src/ambiguities.ts`. Changing
  one changes how games replay, so ship it with a new `rulesVersion`.
- **Randomness** comes only from the framework's `Random`: the Guildmaster's
  start, the starting routes, starting-order ties, the market lots and the
  *+1 Route marker* bonus draws. Every draw is weighted by what the reserve
  holds.

## Hidden information

`redactGame` hides, from everyone but their owner:

- route markers in hand (others see the count), and the make-up of the
  reserve (only its size — otherwise the known totals would give hands away);
- face-down route markers (only the player who placed one knows it);
- starting picks until everyone has picked.

`isActionSecret` keeps a `START_PICK` secret while its attempt is open
(keyed by `attempt`) and a `CHANGE_ROUTE` secret while the marker it placed is
still face down (keyed by `placementId`). Whatever the platform's
hidden-information setting, the view shows only the viewer's own hand and
face-down markers, so hotseat stays fair.

## Not implemented

The *Trading with houses*, *Conflicts* and *Memory* variants (RULES.md §9),
and enforced "future promises" between players — those are for the chat.
