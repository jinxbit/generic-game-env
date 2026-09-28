# @game-platform/incorporated

**Incorporated** for 2–4 players. Corporations bid for shares, fight over
industry squares, lobby the world powers, and cash in on the global economy.
[`RULES.md`](./RULES.md) is the source of truth. Rule ids from it (`R-INV-03`,
`[AMBIG-8]` and so on) are cited throughout the code and the tests.

The package follows the layout of the example game
(`packages/unique-pick/README.md` describes the contract).

| Entry | File | What it is |
| --- | --- | --- |
| `@game-platform/incorporated/rules` | `src/rules.ts` | `gameDefinition`, options, types and read-only helpers for the view. Server-safe. |
| `@game-platform/incorporated/view` | `src/view.ts` | `ui`: the React board (`GameView.tsx`, `view/`) and the options editor. |
| `@game-platform/incorporated/testing` | `src/testing.ts` | `newGame`, `play`, `dice`, `arrange`, `autoplay`, `simplestMove` for tests. |

## How the engine works

- **Task queue plus prompts.** `src/engine.ts` runs `GameData.queue`, a list
  of steps such as `startRound`, `settlePurchase` or `crisisApply`. It stops
  as soon as the game needs a decision, which it records in
  `GameData.prompt` (for example an auction bid, a Big Brother choice or a
  repayment).
  - Every action answers the current prompt. Taking a loan (`TAKE_LOAN`) is
    the only exception: any player may do that at any time during
    Investment and Competition.
  - `pendingPlayerIds` is always derived from the prompt.
- **Nothing to answer means no prompt.** A choice with one option, or with
  interchangeable options, is resolved automatically. So one submitted
  action produces one log entry, even when it runs through the rest of a
  phase or turn.
- **One module per phase:** `outlook.ts`, `investment.ts`, `competition.ts`,
  `lobbying.ts` and `earnings.ts` (which also does end-game scoring).
- **Content is data.** The board, corporations and Outlook cards live in
  `src/data/`. The logic never names a country or card.
- **Open questions are one-line switches.** The `[AMBIG-n]` defaults are
  constants in `src/ambiguities.ts`. Changing one changes how games replay,
  so ship it with a new `rulesVersion`.
- **Randomness** comes only from the framework's `Random`: the corporation
  deal, the Outlook and payoff shuffles, reshuffles, the d6 Power Play, the
  d12 crisis die, Big Brother's redraw and random crisis discards.

## Hidden information

The `redactGame` hook hides the following:

- Other players' cash.
- The payoff deck and discard pile. The discard pile may not be inspected
  (R-GEN-01).
- Every Outlook card except the top one, which only the Outlook chooser sees.
- The cards drawn for Subsidies, Stimulus and Big Brother's redraw, from
  everyone except the player who drew them.

Sealed bids (⚑ CLOSED_AUCTION_SCO) and simultaneous repayment decisions stay
secret entries until they are revealed. They are keyed by `auctionId` or
`promptId`.

Whatever the platform's hidden-information setting, the view hides other
players' cash until the game ends. That also covers hotseat.

## Placeholders — `[DATA]` still to supply

The following have to be supplied from the physical game before the game can
be treated as faithful:

- **Corporation setups** (`src/data/corporations.ts`) are placeholders.
  - Each corporation gets 1 share and 1 cube in a different major, plus $25.
  - Play order is FD, Giant Squid, Big Brother, Old Money. Only the first
    and last positions are confirmed.
  - The special-ability texts are missing.
- **Outlook cards** (`src/data/outlookCards.ts`): only *India Emerging as
  Global Power* is real.
  - The effects of *Asia Infrastructure Bank* and *De-Dollarization*, and all
    of the other seven cards, are placeholders.
  - Placeholders are marked `placeholder: true` and flagged in the UI.
- **Arrows** (`src/data/board.ts`): only the arrows listed in RULES.md §2.2
  are included, so movement is very limited until the full list is added.
  - Scandinavia ↔ Russia is listed in both directions because the direction
    is unclear.
  - Korea and Indonesia are Low-confidence rows.

## Decisions beyond RULES.md

These edge cases weren't covered by the spec, so I picked the least-invented
behaviour. Each is marked in the code.

- **Which corporations play with 2 or 3 players:** a random subset of all
  four, dealt at random. Absent roles fall back as `[AMBIG-6]` describes.
- **Repayment order:** only the real Big Brother decides last. Without Big
  Brother, everyone decides at once.
- **Bids and bond supply:**
  - A bid larger than the player could ever raise (cash plus every bond
    left) is refused.
  - If the bond supply runs out mid-payment, the rest of the payment is
    forgiven, so cash never goes negative before the end.
- **Reverse-auction and private-sale prices** may go down to $0.
- **Selling a share:** the seller chooses which cube to remove, either a
  square or a loose cube.
- **Private sale:** the buyer chooses which of the seller's cubes to replace.
- **FREE_CUBES:**
  - The sale cost is paid *before* the normal cube removal.
  - The buyer's free cubes and attack come after any sale in the same
    auction ("seller loses cubes first").
  - The attack is one Fight, of up to 2 attacks, in that country.
- **Power Play on a minor with two squares** (Korea's guessed data): the
  first square is the one taken.
- **R3_SALES_MODE** applies to the final round.
- **QE_HYPERINFLATION** pays or charges once per push past an end, and cash
  bottoms out at $0.
- **Giant Squid's faction tweak:**
  - It is offered only when the roll would cause a crisis.
  - Its no-crisis repayment discount applies to Giant Squid's own bonds.
- **Concession:** every decision the leaving player still owes is made for
  them (pass, decline or first option). Their cubes stay on the board.
