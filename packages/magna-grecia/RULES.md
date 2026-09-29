# Magna Grecia — Implementation Rules Spec

> This file is the source of truth for the Magna Grecia rules engine in
> `packages/magna-grecia`, as of **rules version 1**. Rule ids (`R-CITY-04`
> and so on) are cited in the code and the tests. `[AMBIG-n]` marks a point
> the rulebook leaves open; §11 lists the behaviour chosen for each.
> Changing any of them changes how existing games replay, so it ships with a
> new `rulesVersion`.

Source: the Magna Grecia rulebook (2–4 players, 15 pages, the BGG-reformatted
English edition), as supplied with the request that added this game. Page
numbers in brackets (`[p. 7]`) point back into it. The map is the published
board, as supplied later (the 2023 redraw by Stephan Suhar) [AMBIG-1]. The
rulebook describes the action cards only by example, so the **card values
are this implementation's own design** (§4) [AMBIG-2].

## 1. Components

| Component | Count | Model |
| --- | --- | --- |
| Road tiles | 20 per player (straight one side, curved the other) | `players[id].supply.roads` / `staging.roads`; placed tiles in `roads[cell]` |
| City tiles | 20 per player | `supply.cities` / `staging.cities`; placed tiles in `cityTiles[cell]` |
| Markets | 20 per player | `players[id].markets` (in supply); placed ones in `markets[]` |
| Oracles | 9 (7 with 2–3 players) | `oracles[]`: a cell and the city it attends to |
| Action cards | 12, in 4 border colours | `CARDS` (`src/data.ts`); `card`, `deck`, `usedCards` |
| Scoring track | one marker per player | `players[id].points` |
| Board | hex grid, rows A–P | `HEXES`, `VILLAGES` (`src/data.ts`) |

## 2. The board

- **R-BOARD-01** The board is a grid of hexes, pointy side up, in rows A–P.
  Hexes are named as on the board: a row letter and a column number 1–35,
  each row using every other column (`G3`, `H34`). A hex has six neighbours:
  east and west in its row, and two each in the rows above and below. The
  board's outline is irregular — row A, for one, has two separate runs — and
  a cell is an index into `HEXES` (`src/data.ts`).
- **R-BOARD-02** 42 hexes are **village spaces**. 10 of them, on the edge of
  the board, have a **green border** (A5, A17, A33, B26, C21, G3, H34, P2,
  P18, P32); the other 32 are inland. No two village spaces touch.
- **R-BOARD-03** A village is neutral. A village space stops being a village
  once a city tile covers it — it is then part of that city.
- **R-BOARD-04** Places are what roads connect: **villages** (uncovered
  village spaces), **cities** and **oracles**.

## 3. Setup

- **R-SETUP-01** 2–4 players. Each player starts with 4 road tiles, 4 city
  tiles and all 20 markets in their supply; the other 16 roads and 16 city
  tiles are in their staging area [p. 3].
- **R-SETUP-02** Oracles: 9 with 4 players, 7 with 2 or 3. They are placed at
  random on inland village spaces, one per space; those spaces are oracles,
  not villages, for the whole game. An oracle starts attending to nobody.
- **R-SETUP-03** Starting points: 15 with 4 players, 12 with 3, 10 with 2.
- **R-SETUP-04** Each seat is given one of the four card colours, in seat
  order: seat 1 the first colour (yellow), seat 2 orange, seat 3 brown,
  seat 4 red. Colours without a player are skipped on every card.
- **R-SETUP-05** The action-card stack is built so that every block of four
  consecutive cards holds exactly one card of each border colour, the order
  inside a block random [p. 3]. The engine draws each round's card when the
  round starts (uniformly from the unused cards whose border colour has not
  appeared yet in the current block), which gives exactly that distribution
  without a hidden, pre-shuffled stack [AMBIG-3].

## 4. Action cards

- **R-CARD-01** A card lists the four colours top to bottom — the round's
  turn order — and three basic actions with a number each: **build roads**
  (tiles), **found/expand cities** (tiles) and **resupply** (tiles moved).
- **R-CARD-02** Each basic action's number sits on a step track; the
  **enhanced** value is the next step up:
  roads `1 2 3 4 5 6`, cities `1 2 3 4`, resupply `3 4 5 7 9` [p. 5, example
  A: 3→4, 2→3, 5→7].
- **R-CARD-03** The 12 cards (`CARDS`, §2 of `src/data.ts`) are three per
  border colour. The border colour is the card's first player. The three
  cards of a colour carry (roads, cities, resupply) = (3, 2, 5), (4, 1, 5)
  and (2, 2, 7); their orders after the first player are clockwise,
  counter-clockwise and "across" (first, +2, +1, +3) [AMBIG-2].

## 5. A round

- **R-ROUND-01** The game lasts **12 rounds**, or 8 in the short game (option
  `rounds`) [p. 15].
- **R-ROUND-02** Each round uses one new card. The players take turns in the
  card's colour order, skipping colours nobody plays and players who have
  conceded.
- **R-ROUND-03** On their turn a player:
  1. takes **up to two** of the three basic actions, or **one enhanced**
     action (§6) — resupply always last;
  2. then may **build one market or sell one market** (§8), not both;
  3. then passes the card on.
- **R-ROUND-04** After the last turn of the last round the game ends (§10).

## 6. Basic actions

- **R-ACT-01** Build roads and found/expand cities may be interleaved in any
  order in one turn [p. 5].
- **R-ACT-02** Resupply comes last: once a player has resupplied they may
  not place tiles that turn, so tiles resupplied are never used the same turn.
- **R-ACT-03** A player may always do less than an action allows.
- **R-ACT-04** An action counts as *taken* once at least one tile of it has
  been placed (or resupplied). With two actions taken, each may use at most
  its card value; with only one taken, it may use up to its enhanced value.
  A player who has used more than a card value of one action can take no
  second action that turn [p. 5].
- **R-ACT-05 Resupply** moves up to the allowed number of tiles, in any mix
  of roads and cities, from the staging area to the supply [p. 4]. It is
  one move: the player chooses both counts at once.

## 7. Roads and cities

### Roads

- **R-ROAD-01** A road tile covers one empty hex (no village, oracle, city
  or road) and joins two of its six sides: two opposite sides (the straight
  face) or two sides one apart (the curved face) — nine placements in all.
  There is no sharp turn between neighbouring sides [AMBIG-12]. Both faces
  are always available. Neither end may point off the board [AMBIG-4].
- **R-ROAD-02** Two road tiles are joined when each has an end pointing at
  the other. A **road** is a maximal chain of joined tiles. A road
  **connects** the places its two outer ends point at; a place counts once
  however many roads reach it, and a road whose two ends reach the same
  place, or nothing, connects nothing.
- **R-ROAD-03** A new road tile must have an end that points at [p. 9]:
  - any city tile (the player's own or an opponent's); or
  - an oracle or a village one of the player's own roads already points at;
    or
  - the open end of one of the player's own road tiles, pointing back.
  A tile merely beside such a thing without pointing at it doesn't count
  [AMBIG-5].
- **R-ROAD-04** A player never lengthens an opponent's road: neither end of
  a new tile may point at an end of another player's tile that points back.
  A road may otherwise run past or cut off other roads [p. 10].
- **R-ROAD-05** Roads cost no points [p. 9].

### Cities

- **R-CITY-01 Founding.** A city is founded on a village space that has a
  green border, or that one of the player's own roads points at [p. 6].
- **R-CITY-02 Expanding.** A city grows by a city tile on a cell next to one
  of the player's own city tiles. Opponents' cities can't be expanded [p. 7].
- **R-CITY-03** A city tile may never be placed on an occupied cell, nor
  next to an opponent's city tile, a village, or an oracle [p. 7]. It may be
  placed on a village where markets stand.
- **R-CITY-04 Bridging.** A city tile next to exactly one village is still
  allowed if a second city tile goes straight onto that village; both tiles
  are placed by one move [p. 7, examples D and E]. The pair either expands a
  city (the first tile touches one of the player's cities) or founds one (it
  doesn't; the village must then satisfy R-CITY-01). A tile next to two
  villages can never be placed. Founding a city on any other non-village
  cell is not possible [AMBIG-6].
- **R-CITY-05** A tile may not join two of the player's own cities together
  [AMBIG-7].
- **R-CITY-06** At most one city may be founded per turn; any number may be
  expanded, including the one just founded [p. 8].
- **R-CITY-07** Each city tile placed costs 1 point. A player without the
  points can't place it [p. 8].
- **R-CITY-08 Founding market.** Founding a city places one of the founder's
  markets in it for free, unless they already have a market (sold or not) in
  that village. Other players' markets in the village stay, now in the city
  [p. 8]. With no market left in supply, none is placed.
- **R-CITY-09** A city's identity is the village space it was founded on;
  later tiles, and villages absorbed by bridging, join it. When a city
  absorbs a village holding a market of a player who already has one in the
  city, the absorbed village's market leaves the board — back to its
  owner's supply if unsold, out of the game if sold [AMBIG-8].

## 8. Markets

- **R-MKT-01** A player has at most one market (sold or not) per city or
  village [p. 10].
- **R-MKT-02 Building.** At the end of their turn a player may build one
  market in a village or in an opponent's city, paying: in a city, 1 point
  per city tile plus 1 per unsold opponent market there; in a village, 1
  point plus 1 per unsold opponent market there [p. 10, 13].
- **R-MKT-03 Active.** A market is active when it is in its owner's city,
  or in a village or opponent's city that a road connects directly to one of
  its owner's cities. Inactive and sold markets are worth nothing [p. 11].
- **R-MKT-04 Value.** A market is worth the number of places directly
  connected to its city or village (R-ROAD-02) [p. 11].
- **R-MKT-05 Selling.** Instead of building, a player may sell one of their
  active, unsold markets at the end of their turn and move its current value
  up the scoring track. The market stays where it is, sold; it never counts
  again, never counts towards a market's building cost, and never lets its
  owner build another there [p. 12–13]. A market worth 0 can't be sold
  [AMBIG-9].
- **R-MKT-06** Building or selling ends the turn.

## 9. Oracles

- **R-ORACLE-01** A city's **importance** is the number of places directly
  connected to it.
- **R-ORACLE-02** When the first of the cities connected to an oracle
  connects, the oracle attends to it [p. 13].
- **R-ORACLE-03** Afterwards the oracle switches only to a connected city
  strictly more important than the one it attends to; a tie keeps it
  [p. 13–14]. Villages are never attended to.
- **R-ORACLE-04** Attention is re-checked after every move that places a
  tile. When several cities qualify at once, the most important wins; a
  remaining tie goes to the moving player's city, then to the city founded
  first [AMBIG-10].

## 10. Game end and scoring

- **R-END-01** After the last round each player's final score is: points on
  the scoring track, plus the value of each of their active unsold markets,
  plus 4 for every oracle attending to one of their cities [p. 14–15].
- **R-END-02** The highest score wins; a tie is shared [AMBIG-11].
- **R-LEAVE-01** A player who concedes is skipped from then on; their tiles,
  cities and markets stay on the board and still count for everyone else.

## 11. Ambiguities and the behaviour chosen

| Id | Question | Behaviour |
| --- | --- | --- |
| AMBIG-1 | The rulebook has no map. | The published board as supplied (the 2023 redraw): its hexes, 10 green-bordered starting villages and 32 inland villages, read off the image into `src/data.ts`. |
| AMBIG-2 | Card values and orders aren't listed. | Three cards per border colour: (3, 2, 5), (4, 1, 5), (2, 2, 7); orders clockwise, counter-clockwise and across from the border colour. |
| AMBIG-3 | A pre-shuffled face-up stack would be hidden information. | Each round's card is drawn when the round starts, with the same distribution. Nothing is hidden. |
| AMBIG-4 | May a road end point off the board? | No. |
| AMBIG-5 | Does "adjacent to" a city/oracle/village/road mean pointing at it? | Yes — an end must point at the anchor. |
| AMBIG-6 | "Found on a non-village space if other tiles that turn reach a legal village." | Only as the two-tile bridge of R-CITY-04 (the rulebook's example E). |
| AMBIG-7 | May a player join two of their own cities? | No (a city could then hold two of one player's markets). |
| AMBIG-8 | Absorbing a village where the player already has a market in the city. | The village's market leaves the board (to supply if unsold). |
| AMBIG-9 | Selling a market worth 0. | Not allowed — it would only waste the market. |
| AMBIG-10 | Several cities overtake an oracle's city at once. | Most important, then the mover's, then the first founded. |
| AMBIG-11 | Ties at the end. | Shared win. |
| AMBIG-12 | Which turns does the curved road face make on a hex? | A gentle curve between sides one apart; no sharp turn between neighbouring sides. |
