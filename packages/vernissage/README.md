# @game-platform/vernissage

**Vernissage** for 3–5 players. As gallery owners, the players steer the
fame of five artists. Each turn a player puts a fate counter (purchase,
criticism or scandal) in front of an artist they have influence over; others
with influence there may object, bargain and fight it out in a Trial of
Strength. Three different counters give the artist a Vernissage and a jump up
the success staircase. An artist whose fame reaches the golden IN region pays
every shown work, and one that falls OUT costs its owners dearly. Whoever
ends with the most cash and art wins. [`RULES.md`](./RULES.md) is the source
of truth. Its rule ids (`R-TRIAL-02`, `AMBIG-3` and so on) are cited in the
code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/vernissage/rules` | `src/rules.ts` | `gameDefinition`, options, types and read-only helpers for the view. Server-safe. |
| `@game-platform/vernissage/view` | `src/view.ts` | `ui`: the React table (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/vernissage/testing` | `src/testing.ts` | `newGame`, `play`, `fateDie`, `redDice`, `arrange`, `handOf`, `simplestMove` for tests. |

## How the engine works

- **Components and pure readings in one place.** `src/data.ts` holds every
  number of the board (staircase height, fame track, counter values, pile
  prices, card mix) and the pure helpers built on them: influence, allowed
  counter kinds, fame values, assets. The translated rulebook gives none of
  the board's printed numbers, so each is a named constant with its `AMBIG`
  entry.
- **A step machine.** `GameData.step` runs `fate` → `place` → (`objections`
  → `negotiate` → `challenge` → `trial`) → (`display`) → `buy` → (`choose`)
  → `play`, then the next player's `fate`, or `ended`. `withEnvelope`
  derives `phase`, `activePlayerId` and `pendingPlayerIds` from the step (and
  from who still owes an answer in a simultaneous step), so they are never
  stale.
- **Negotiation in fixed rounds.** The rulebook's free bargaining becomes
  answer → agree or refuse → challenge → commit might cards (RULES.md §6,
  AMBIG-11). Players can still talk in chat.
- **Randomness** comes only from the framework's `Random`: the shuffles in
  `setup`, the fate die in `ROLL_FATE`, the red dice when a Trial is decided
  (rerolled ties drawn in the same action), and the grey reshuffle.
- **Hidden information.** Hands, the face-down piles, the set-aside cards and
  the grey deck are masked by `redactGame`. The buyer of a pile sees it while
  choosing, and the `TAKE_CARD` entry is secret from everyone else. No move is
  ever forced on a player when doing so would give away their hand: a
  player with no might card still answers a Trial with zero, and everyone is
  asked when an artist goes IN.

## Decisions beyond the rulebook

RULES.md §12 lists every open point and the behaviour chosen. The ones most
likely to matter at the table:

- The staircase has 10 steps; the fame track runs from −50 000 to 210 000
  with IN at 180 000 and above (AMBIG-1, AMBIG-2).
- Counters come two of each value: purchase +1…+7, criticism and scandal
  −1…−6 (AMBIG-3).
- Showing works when an artist goes IN is optional (AMBIG-12).
- Loans are taken automatically when a purchase costs more than the cash in
  hand (AMBIG-9).
- The rulebook's might-card variant is a creation-time option.
