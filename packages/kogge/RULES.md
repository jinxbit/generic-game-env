# Kogge — Implementation Rules Spec

> **For Claude Code:** this file is the source of truth for the Kogge rules engine (`packages/kogge`).
> - Cite rule IDs (`R-AUC-03` etc.) in code comments, test names and commits.
> - `[AMBIG-n]` marks a gap in the rules summary. Implement the default from §10; the defaults are constants in `src/ambiguities.ts`. Changing one changes how games replay, so ship it with a new `rulesVersion`.
> - Board content (cities, colours, marker and goods counts) is data in `src/data.ts`. The logic never names a city.
> - Variants (§9) are game options, off by default.

Source: *Unofficial Kogge Rules Summary 1.0* (Kogge, © Andreas Steding, Hall Games), plus the board image.

## 1. Components

### 1.1 Cities (R-BRD-01)

Nine trading cities, numbered 0–8 **clockwise** around the Baltic. Each produces goods of one colour, and each route marker's colour is the colour of the city with its number.

| # | City | Colour | Board position |
|---|---|---|---|
| 0 | Tönsberg | grey | top left |
| 1 | Stockholm | grey | top centre |
| 2 | Åbo | grey | top right |
| 3 | Reval | orange | right, upper |
| 4 | Riga | orange | right, lower |
| 5 | Danzig | purple | bottom right |
| 6 | Stralsund | purple | bottom left |
| 7 | Lübeck | white | left, lower |
| 8 | Kopenhagen | white | left, upper |

Each city has two **route slots** (a route marker in each) and room for **two houses** (any owners).

### 1.2 Counts (R-BRD-02)

- **Route markers (90):** six 8s, seven 7s, eight 6s, nine 5s, ten 4s, eleven 3s, twelve 2s, thirteen 1s, fourteen 0s. Every marker a player or city holds comes out of this pool; the rest is the **reserve**, from which random draws are made (so draws are weighted towards low numbers).
- **Goods (66):** 25 grey, 18 orange, 13 purple, 10 white. Goods not on the board, in a house or held by a player are the **supply**. Nothing can be placed or taken beyond the supply.
- **Per player:** a boat, houses (no limit, see R-END-02), two Raid markers (one at start, the second bought, R-GM-02a).
- **Bonus markers (8):** two each of *3:1 Trading*, *+1 Route marker*, *Move 2 spaces*, *Secret Passage*.
- **Guildmaster** and the **Game Ends** marker.

### 1.3 Information

Everything is public except:
- **Route markers in hand:** others see only how many a player holds. A marker is revealed when it is bid, paid, traded or used to build. `[AMBIG-10]`
- **The reserve's make-up:** only its size is public (otherwise the known totals would give hands away).
- **Face-down route markers** (R-ACT-05): only the player who placed it knows its number.
- **Starting picks** (R-SET-07) until they are revealed.

## 2. Setup (R-SET)

1. **R-SET-01** Each city gets 3 goods of its colour.
2. **R-SET-02** Each player takes one Raid marker, 2 grey goods, 1 orange good and one route marker of each value 0–8.
3. **R-SET-03** Draw one marker at random from the reserve; the Guildmaster and the Game Ends marker start in the city with that number. The marker goes back (R-SET-05).
4. **R-SET-04** Each city gets two face-up route markers from two sets of 0–8, randomly mixed, such that both markers in a city differ from each other and from the city's number.
5. **R-SET-06** The rest of the goods form the supply.
6. **R-SET-07** Every player simultaneously and secretly picks a route marker in hand (it stays in hand). Once all have picked, they are revealed and each player places a house and their boat in the matching city. If three or more players picked the same city, all of those players pick again (the others' placements stand).
7. **R-SET-08** Initial turn order: by city number, lowest first. Players sharing a city are ordered randomly.

## 3. Winning (R-END)

- **R-END-01 Development Points (DP):** 1 per house on the board (including the starting house) + 1 per bonus marker.
- **R-END-02** The moment a player has **5 DP** they win and the game ends. (Houses are not limited to four pieces.)
- **R-END-03** Otherwise, the game ends when the Guildmaster reaches its starting city for the **second** time (it counts when the Guildmaster lands on or passes through that city, including when the city is skipped for a raid). `[AMBIG-1]`
- **R-END-04 Victory points:** house 10, unused Raid marker in hand 10, bonus marker 20, goods held (by the player and in their houses): white 7, purple 5, orange 3, grey 1. Most VP wins. A tie shares the win.

## 4. Round structure (R-RND)

Each round: **1. Auction** (R-AUC) → **2. Guildmaster** (R-GM) → **3. Actions** (R-ACT). `GameState.turn` counts rounds.

## 5. Auction (R-AUC)

- **R-AUC-00** Before anything else, each player with a *+1 Route marker* bonus draws one random marker from the reserve into hand, in turn order.
- **R-AUC-01** Any lots left in the market go back to the reserve. Then four **lots** of two random markers are drawn from the reserve (the same number whatever the player count; fewer if the reserve runs out).
- **R-AUC-02** Once around, in turn order, each player bids by revealing one or more markers from hand.
- **R-AUC-03 Bid strength**:
  - a. A **set** — two or more markers all of the same number — beats any non-set. `[AMBIG-2]`: a single marker is not a set.
  - b. Between sets, more markers win; with equal size, the higher number wins.
  - c. Between non-sets, the higher sum wins.
  - d. Equal strength: the earlier bidder ranks higher. `[AMBIG-3]`
- **R-AUC-04** A bid may not exactly duplicate (same multiset) an earlier bid this round.
- **R-AUC-05** A player must bid if able. A player with no markers, or whose every possible bid would duplicate one, is skipped and ranks below all bidders (keeping their previous relative order).
- **R-AUC-06** The strongest bid becomes turn order 1 (the starting player), and so on.
- **R-AUC-07** Resupply: for each bid marker, the city with that number gets 2 goods of its colour. Cities are supplied from the highest number down, so a short supply shorts the low numbers. Bid markers go back to the reserve.
- **R-AUC-08 House supply** (applies to every placement of goods into a city — R-AUC-07, R-GM-01): if a city with houses receives at least as many goods as it has houses, one of the placed goods goes next to each house (the house owner's, collected later, R-MOV-06); if fewer, none do. `[AMBIG-4]`

## 6. Guildmaster phase (R-GM)

- **R-GM-01** The starting player moves the Guildmaster one or two cities clockwise. Cities holding any Raid marker are skipped and don't count. Then 2 goods of the destination's colour are placed there (R-AUC-08).
- **R-GM-01a Taxes variant** (⚑ `taxes`): afterwards, each player whose boat is in that city pays one good to the supply (their cheapest colour, grey first `[AMBIG-5]`), and the city loses every good not of its colour.

## 7. Actions phase (R-MOV, R-ACT)

In turn order, each player moves their boat, then takes actions in the city where it stopped.

### 7.1 Movement (R-MOV)

- **R-MOV-01** A move goes from the current city to the city numbered by one of the two route markers there. The first move is free. Each further move costs one good or one route marker from hand (paid to the supply / reserve). A player may stop at any point, including before moving.
- **R-MOV-02** *Move 2 spaces* bonus: the second move is free too.
- **R-MOV-03** *Secret Passage* bonus: a move may go to the Guildmaster's city from anywhere (not from the Guildmaster's city itself), for one good or marker on top of the move's normal cost.
- **R-MOV-04** Choosing a **face-down** marker turns it face up (for good) before moving. If its destination is a city with the mover's own Raid marker, the move is used up (and paid for, if it cost something) but the boat stays.
- **R-MOV-05** A player may never move (by a face-up marker or the Secret Passage) to a city with their own Raid marker.
- **R-MOV-06** Goods next to a player's houses are picked up whenever that player's boat is in the city during their turn — the city it starts the turn in, and every city it enters. `[AMBIG-6]`: pick-up is automatic.
- **R-MOV-07** Movement ends when the player stops, or takes any action (R-ACT). Proposing a player trade (R-ACT-07) doesn't end it.

### 7.2 Actions (R-ACT) — each at most once per turn, in any order

- **R-ACT-01 Build a house:** pay one good of each colour other than the city's, and one route marker with the city's number — two such markers if the city already has a house. At most two houses per city (a player may own both).
- **R-ACT-02 Trade with the Guildmaster** (Guildmaster in this city), one of:
  - a. three identical route markers → reserve, take your second Raid marker (once per game);
  - b. six goods of one colour → supply, take an available bonus marker of your choice;
  - c. one good → supply, take a reserve route marker of that colour (your choice of number);
  - d. one route marker → reserve, take a good of its colour from the supply.
- **R-ACT-03 Buy route markers:** pay one good, take one lot from the market into hand.
- **R-ACT-04 Trade with the city** (only if the boat changed city this turn): put one good into the city, take two goods from the city (three with the *3:1 Trading* bonus), none of the colour given. `[AMBIG-7]`
- **R-ACT-05 Change trade routes:** swap a face-up marker in this city for a marker from hand, which goes in **face down**. It may not show the city's own number. The taken marker goes to hand.
- **R-ACT-06 Raid:** place one of your Raid markers in this city, permanently, and either
  - a. take half the goods of a player whose boat is here: they split their goods into two groups whose sizes differ by at most one, and you take one group; or
  - b. take every good in the city, including those next to houses.

  Then your boat moves once, for free, along one of this city's two routes chosen by the player to your left (next in seat order) — R-MOV-04/05 apply — and your turn ends.
- **R-ACT-07 Trade with other players:** during your turn, you may offer a trade of goods and/or route markers to a player whose boat is in your city. They accept or decline. `[AMBIG-8]`: only the active player proposes, and only goods and markers change hands (promises are made in chat and not enforced).

## 8. End of round (R-RND-02)

After the last player's turn: if the Guildmaster has reached its start for the second time this round (R-END-03), the game ends and is scored (R-END-04). Otherwise the next round begins.

## 9. Variants

| Option | Rule | Implemented |
|---|---|---|
| `taxes` | R-GM-01a | ✔ |
| Trading with houses | — | not yet |
| Conflicts | — | not yet (needs secret goods) |
| Memory | — | not yet |

## 10. Ambiguities and defaults

| Id | Question | Default |
|---|---|---|
| AMBIG-1 | Does the game end the moment the Guildmaster reaches its start the second time, or after that round? | After that round's Actions phase, so the final Guildmaster move still matters. Passing over the start city counts as reaching it. |
| AMBIG-2 | Is a single marker a "set"? | No: a set is 2+ identical markers. A single marker is valued by its number, like any non-set. |
| AMBIG-3 | Tie between equally strong bids. | The earlier bidder (in the old turn order) ranks higher. |
| AMBIG-4 | Does the house supply rule also apply to the Guildmaster's 2 goods? | Yes — every placement of goods into a city. |
| AMBIG-5 | Which good does a taxed player pay? | The cheapest they hold: grey, orange, purple, white. |
| AMBIG-6 | Is picking up house goods optional, and does the starting city count? | Automatic, and yes. |
| AMBIG-7 | "Take different 2 goods" | Two goods, neither of the colour you put in (they may match each other). |
| AMBIG-8 | Player trades "at any time", including promises. | Active player proposes to a player sharing their city; goods and markers only. |
| AMBIG-9 | What happens to a conceding player's pieces? | Their houses and boat stay on the board (houses keep receiving goods); they are skipped from then on. |
| AMBIG-10 | Are route markers in hand secret? | Yes: bids are "revealed" and face-down routes must be remembered, which only makes sense if hands are hidden. The reserve's make-up is hidden with them. |
