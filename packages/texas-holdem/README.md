# @game-platform/texas-holdem

**Texas Hold'em** for 2–9 players: no-limit poker played as a tournament.
Everyone starts with the same stack, the blinds double on a schedule, and a
player who runs out of chips is out. The last player with chips wins. You can
also set a hand limit, and then the biggest stack wins when it runs out.
[`RULES.md`](./RULES.md) is the source of truth. Its rule ids (`R-BET-04`,
`AMBIG-1` and so on) are cited in the code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/texas-holdem/rules` | `src/rules.ts` | `gameDefinition`, options, types and read-only helpers for the view (`amountToCall`, `canRaise`, `minRaiseTo`, …). Server-safe. |
| `@game-platform/texas-holdem/view` | `src/view.ts` | `ui`: the React table (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/texas-holdem/testing` | `src/testing.ts` | `newGame`, `play`, `move`, `stacked`, `arrange`, `simplestMove` for tests. |

## How the engine works

- **Cards and chips are pure functions.** `src/cards.ts` holds the deck,
  hand ranking (best five of seven, the wheel, kickers, names like "a full
  house, Queens over Fives") and side pots (`buildPots`). The view reuses it.
- **The envelope is derived.** `GameData` carries the hand, the street, who
  is to act and each player's stack, bets and hole cards. `withEnvelope`
  derives `phase`, `activePlayerId`, `pendingPlayerIds`, `turn` (the hand
  number) and the busted players' `eliminated` flags from it, all in one
  place.
- **One action runs to the next decision.** A call that closes a street
  deals the next one. An all-in that leaves nobody able to bet runs the board
  out. A hand that ends is settled and the next hand dealt, all inside the
  same action (AMBIG-3). So `nextForcedAction` is never needed.
- **Betting state per street**: `currentBet`, `minRaise` (the last full
  raise) and `lastFullBet` (the level it set), plus each player's `actedAt`
  (the `lastFullBet` they last acted against). `canRaise` and `needsToAct`
  read these, which is how an incomplete all-in raise doesn't reopen the
  betting (R-BET-04).
- **Cards are drawn when they're dealt** (AMBIG-1): hole cards when a hand
  starts, board cards when their street opens. Each is drawn at random from
  the cards the hand hasn't dealt yet. No deck order is ever stored, so no
  undealt card sits in the state to be hidden. Every move that reveals a card
  also drew random numbers, which is what the platform's "lock revealed
  information" undo setting keys on.

## Hidden information

A player's hole cards are theirs alone. `redactGame` masks everyone else's
as `null`s (a spectator sees none). Showdown cards are public, and live in
`lastHand.shown`, which is never masked. Folded hands are never shown. The
numbers an entry drew never reach a redacted viewer
(`packages/sdk/src/redaction.ts`). Actions and their narration never name an
unshown card, so `isActionSecret` is always false.

On the client-trusted and hotseat paths every client holds the full state,
so the view itself only turns up the viewer's own cards (`myPlayerId`).

## Decisions beyond the usual rules

Every open point is listed in RULES.md §9 with the behaviour chosen. The ones
most likely to matter at the table:

- No burn cards and no stored deck order (AMBIG-1).
- The button starts in the first seat and moves to the next player with
  chips; there's no dead-button rule (AMBIG-2).
- No pause between hands. The last hand's result stays on the table until
  the next hand ends (AMBIG-3).
- Folding when you could check is refused (AMBIG-4).
- Everyone still in at a showdown shows; no mucking (AMBIG-6).
- A player who concedes folds and their chips leave the game (R-LEAVE-01).
  If that leaves one player, the framework ends the game at once, mid-hand.

## Tests

- `src/__tests__/cards.test.ts`: ranking, naming and side pots.
- `src/__tests__/rules.test.ts`: one `describe` per RULES.md section.
- `src/__tests__/fuzz.test.ts`: 24 randomised tournaments (2–9 players).
  Checks chip conservation, no card dealt twice, an accurate envelope and
  exact replay, and that between them they reached side pots, split pots,
  uncalled bets, busts, concessions and both endings.
- `src/__tests__/view.test.tsx`: the controls, card visibility and a whole
  game rendered.
- `src/test/__tests__/texasHoldemStack.test.ts` (platform): the game through
  the real Edge Functions with hidden information on, through undo and redo.
