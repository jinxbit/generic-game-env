# Shark — Implementation Rules Spec

> This file is the source of truth for the Shark rules engine in
> `packages/shark`, as of **rules version 2**. §10 lists what version 1,
> still registered for games started under it, did differently. Rule ids (`R-PLACE-03` and so on) are cited in the code
> and the tests. `[AMBIG-n]` marks a point the rulebook leaves open; §9 lists
> the behaviour chosen for each. Changing any of them changes how existing
> games replay, so it ships with a new `rulesVersion`.

Source: the Shark rulebook (sections 1–7), as supplied with the request that
added this game. Section numbers in brackets (`[§6.1 d]`) point back into it.

## 1. Components

| Component | Count | Model |
| --- | --- | --- |
| Currency, Flying Turtles (F.T.) | notes of 1 000, 5 000, 10 000, 50 000 | an integer per player, in F.T. The bank is unlimited. Denominations are not modelled. |
| Markers | 20 per colour; colours blue, green, red, yellow | `supply[colour]`: markers not yet placed |
| Share certificates | per colour: 15 × 1 share + 5 × 5 shares = **40 shares** | `bank[colour]`: shares the bank still holds; `players[id].shares[colour]` |
| Board | 12 columns × 10 rows = 120 boxes, six zones of 4 × 5 | `board[row * 12 + col]`: a colour or empty |
| Stock exchange scale | 15 levels, one price marker per colour | `prices[colour]`: 0–15, a share costs `price × 1 000` F.T. |
| Dice | one normal d6 (zone), one colour die | colour die faces: blue, green, red, yellow, white, white [AMBIG-1] |

## 2. Board

- **R-BOARD-01** The grid is 12 columns wide and 10 rows tall. Rows are
  numbered 0–9 from the top, columns 0–11 from the left.
- **R-BOARD-02** Zones are blocks of 4 columns × 5 rows, numbered 1–3 left to
  right on the top half and 4–6 on the bottom half:
  `zone = floor(row / 5) * 3 + floor(col / 4) + 1`.
- **R-BOARD-03** Zone borders do not stop groups: adjacency is orthogonal
  (up, down, left, right — never diagonal) across the whole grid.
- **R-BOARD-04** A **group** is a maximal set of orthogonally connected
  markers of one colour. A group of one marker is an **isolated marker**.

## 3. Setup

- **R-SETUP-01** 3–6 players. Nobody has money (`startingCash` option,
  default 0 — a house rule, not in the rulebook). Every player starts with
  **one share of each colour**, taken from the bank.
- **R-SETUP-02** All prices start at 0 and all 20 markers of each colour are
  in the supply. The bank holds the other shares: 40 of each colour minus
  one per player.
- **R-SETUP-03** The first player is the first seat; play goes on in seat
  order ("by common agreement … clockwise").

## 4. Share price

- **R-PRICE-01** A colour's price is the sum, over its groups of **two or
  more** markers, of `min(size, 7)` [§6.1 b: "a group of 7 does not rise
  further; there can be two groups of 7"].
- **R-PRICE-02** If that sum is 0 but at least one marker of the colour is on
  the board, the price is 1 — the first marker of a colour starts it
  [§6.1 a], and isolated markers keep it at 1 when groups are eliminated
  [§6.2 important point 1].
- **R-PRICE-03** No marker of the colour on the board: price 0.
- **R-PRICE-04** The price is capped at 15, the top of the scale.
- **R-PRICE-05** Prices are recomputed from the board after every placement.
  All of a colour's groups count, wherever they are [§6.1 "Remember!"].

## 5. A turn

Each turn, in order [§6]:

1. **R-TURN-01 Trade (optional).** Buy and/or sell shares with the bank.
2. **R-TURN-02 Roll (mandatory).** Roll both dice. The colour die gives the
   marker colour — a white face lets the player choose any colour — and the
   d6 gives the zone.
3. **R-TURN-03 Place (mandatory).** Place one marker of that colour on an
   empty box of that zone, if a legal box exists (§6). If no legal placement
   exists — for the rolled colour or, on white, for any colour — the player
   misses the rest of the turn [AMBIG-2].
4. **R-TURN-04 Trade again (optional).** Buy and/or sell again, then end the
   turn.

### Trading

- **R-SHARE-01** Shares are bought from and sold to the bank at the current
  price (`price × 1 000` each).
- **R-SHARE-02** At most **5 shares bought per turn in total**, across both
  trade steps and all colours. Selling is unlimited.
- **R-SHARE-03** A purchase needs the cash to pay for it and enough shares
  in the bank. A colour at price 0 can be bought and sold too — for nothing
  (purchases still count toward the 5-share cap).
- **R-SHARE-04** Only the player whose turn it is trades, and only in the
  trade steps.

## 6. Placing a marker

Let *c* be the placed colour and *N* the size of the group of *c* the new
marker belongs to (1 + the sizes of the distinct groups of *c* it touches).

- **R-PLACE-01** The box must be empty and in the rolled zone.
- **R-PLACE-02 Isolated marker** [§6.1 a] — touches no marker of any colour.
- **R-PLACE-03 Growing a group** [§6.1 b] — touches a group of *c*.
- **R-PLACE-04 Joining groups** [§6.1 c] — touches two or more groups of
  *c*; they become one group of *N*.
- **R-PLACE-05 Touching other colours** [§6.1 d] — the placement is legal
  only if *N* is strictly greater than the size of **every** group of another
  colour the new marker touches. Those groups are then all **eliminated**:
  removed from the board and from play (they do not return to the supply).
- **R-PLACE-06** Every placement takes one marker from the supply of *c*.

### Money from a placement

With prices before (*P₀*) and after (*P₁*) the placement and eliminations:

- **R-PAY-01** If *P₁[c] > P₀[c]* the placer receives *P₁[c] × 1 000*
  [§6.1 "Remember!"]; otherwise the placer receives the isolated-marker bonus
  of 1 000 [§6.1 a, AMBIG-4].
- **R-PAY-02 Dividends** [§6.2 rise]: when *P₁[c] > P₀[c]*, every player —
  the placer included — receives *(P₁[c] − P₀[c]) × 1 000* per share of *c*
  they hold.
- **R-PAY-03 Falls** [§6.2 fall]: for every colour *k* with *P₁[k] < P₀[k]*,
  every player **except the placer** pays *(P₀[k] − P₁[k]) × 1 000* per share
  of *k* they hold. This includes *c* itself if joining groups lowered its
  price through the 7-cap [AMBIG-5].

Worked example [§6.2]: red at 7; A (5 red shares) grows a red group of 3 to
5, red goes to 9. A receives 9 000 + 2 000 × 5 = 19 000; B (2 shares) 4 000;
C (1 share) 2 000; D (7 shares) 14 000.

### Forced sales

- **R-DEBT-01** A player who can't pay a fall goes into debt (negative cash)
  and must sell shares to the bank at **half the current price**
  (`price × 500` each) until the debt is covered [§6.2 important point 2].
- **R-DEBT-02** A debtor with a real choice (sellable shares in two or more
  colours, worth more than the debt at half price) is asked which to sell;
  every debtor chooses at the same time, before the placer's second trade
  step. A debtor may sell no more of a colour than it takes to clear the debt.
- **R-DEBT-03** A debtor without a choice is settled automatically: with one
  sellable colour, just enough of it is sold; if all their sellable shares
  can't cover the debt, all are sold and the rest is written off [AMBIG-6].

## 7. End of the game

- **R-END-01** The game ends immediately after a placement that brings any
  price to 15, or that uses the last marker of a colour from the supply
  [§7]. No forced sales take place then.
- **R-END-02** Every share is sold back to the bank at the current price.
  A player's wealth is their cash (debt counts negative) plus
  `price × 1 000` per share held.
- **R-END-03** The richest player wins; a tie shares the win.

## 8. Leaving the game

- **R-LEAVE-01** A player who concedes returns their shares to the bank.
  If it was their turn, the next player's turn starts; if they owed a forced
  sale, it is dropped.

## 9. Ambiguities and the chosen behaviour

| Id | Question | Chosen behaviour |
| --- | --- | --- |
| AMBIG-1 | Faces of the colour die. | Blue, green, red, yellow and two white ("the white faces"). |
| AMBIG-2 | "Misses his turn" when nothing can be placed. | The turn ends at once; there is no second trade step. |
| AMBIG-3 | Buying and selling a colour priced 0. | Allowed, for nothing (version 2). Version 1 refused both. |
| AMBIG-4 | Payment for a placement that doesn't move the price but isn't isolated (a group already of 7+, or one that only knocks out others). | The 1 000 isolated-marker bonus. |
| AMBIG-5 | Joining groups whose capped sizes add up to more than 7 lowers the colour's price. | Treated as a fall (R-PAY-03), so shareholders other than the placer pay. |
| AMBIG-6 | A debtor whose shares can't cover the debt. | They sell everything; the bank writes off the rest. |
| AMBIG-7 | Where the 5-share cap is counted. | Per turn of the buying player, across both trade steps. |

## 10. Rules versions

A game always replays under the version it started with, so both versions
stay registered (`gameDefinition` and `gameDefinitionV1` in `src/rules.ts`,
one code path branching on `rulesVersion`).

| Version | Differences |
| --- | --- |
| 2 (current) | Every player starts with one share of each colour (R-SETUP-01). Colours priced 0 can be bought and sold, for nothing (R-SHARE-03). |
| 1 | Nobody starts with shares; the bank holds all 40 of each colour. A colour priced 0 can't be bought or sold. |
