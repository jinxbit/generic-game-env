# Bauernschlau — Implementation Rules Spec

> This file is the source of truth for the Bauernschlau rules engine in
> `packages/bauernschlau`, as of **rules version 3**. §11 lists what versions
> 1 and 2, still registered for games started under them, did differently. Rule ids
> (`R-FENCE-03` and so on) are cited in the code and the tests. `[AMBIG-n]` marks a point
> the rules sheet leaves open; §10 lists the behaviour chosen for each.
> Changing any of them changes how existing games replay, so it ships with a
> new `rulesVersion`.

Source: a one-page English rules summary of *Bauernschlau (Crooked
Shepherds)* supplied with the request that added this game. It names the
components and actions but gives no board layout, counter mix or examples, so
much of the geometry below is this implementation's own.

## 1. Components

| Component | Count | Model |
| --- | --- | --- |
| Board | a hexagon of hexes, radius 4 [AMBIG-1] | `CELLS` (board.ts), axial coordinates: 91 hexes of a radius-5 grid numbered row by row, of which the board uses the 61 within its radius (`GameData.radius`) |
| Farmhouses | six, one per colour | the six hexes around the centre |
| Sheepdog | one | `dog`: a cell, or null for the centre |
| Sheep counters | 90 [AMBIG-3] | `bag`, `hand`, `sheep[cell]` |
| Fences | per player: 16 (2–3 players), 12 (4–5), 10 (6) | `farms[id].fencesLeft`; built fences on `borders[i].path` |

- **R-COMP-02** The sheep counters [AMBIG-3]: white sheep worth +5 ×4,
  +4 ×6, +3 ×10, +2 ×12, +1 ×14, −1 ×12, −2 ×10, −3 ×8, −4 ×4, and 10
  black sheep worth 0.

## 2. Board

- **R-BOARD-01** The board is a hexagon of radius 4: 61 hexes in rings 0–4
  around the centre — five hexes from the centre to the edge, inclusive.
- **R-BOARD-02** The seven central hexes — the centre and the six
  farmhouses around it — are unplayable. The other 54 hexes are **fields**.
- **R-BOARD-03** Eighteen fields are **bonus fields**, each multiplying the
  sheep on it. The six **long diagonals** run from the centre through each
  farmhouse to a corner of the board; on ring k they cross the ring at its
  corners, every k-th hex.
  - **Ring 2** (the first ring of fields): every 2nd hex, the six *not* on a
    long diagonal — each where two farmhouses meet — **×2**.
  - **Ring 3**: every 3rd hex, the six *on* the long diagonals — **×3**.
  - **Ring 4**: every 4th hex, the six exactly midway between two long
    diagonals — **×3**.
- Cells are labelled by row letter from the top (A–I) and position in the row
  from the left: the top-left field is A1, the centre E5.

## 3. Setup

- **R-SETUP-01** 2–6 players, seated clockwise in seat order.
- **R-SETUP-02** Each player takes a farmhouse: all six with 6 players, and
  spread out otherwise — positions (0 = top right, clockwise) 2p: 0, 3;
  3p: 0, 2, 4; 4p: 0, 1, 3, 4; 5p: 0–4 [AMBIG-2].
- **R-SETUP-03** Fences per player: 16 for 2–3 players, 12 for 4–5, 10
  for 6.
- **R-SETUP-04** The sheepdog stands in the centre; every sheep is in the bag.
- **R-SETUP-05** A random start player. Play goes clockwise. A new round
  begins each time the turn comes back round to the start player.

## 4. Turns

- **R-OPEN-01** In the first round each player must take one sheep, look at
  it and put it face down on any empty field — nothing else.
- **R-TURN-01** From the second round on, each player takes one action on
  their turn:
  place a sheep (R-PLACE), flip a sheep (R-FLIP), the sheepdog (R-DOG),
  build a fence (R-FENCE) or a sheep special (R-SPECIAL).
- **R-TURN-02** Turning over a black sheep by flipping it — or with the dog,
  unless the first-edition rule is on (R-DOG-03) — gives two extra actions, taken at once, of any kind (R-FLIP-02). Extra
  actions stack.
- **R-TURN-03** A player who can take no action at all is skipped
  [AMBIG-8]. If nobody can act, the game ends (R-END-02).

### Placing a sheep

- **R-PLACE-01** Take a sheep from the bag at random, look at it, and put it
  face down on any empty field — one with no sheep and no dog. In the app
  this is two steps: take the sheep (you see it), then click a field.

## 5. Hidden information

- **R-HIDE-01** A face-down sheep is known only to the player who put it
  there. Nobody else sees it until it is turned over. A player placing
  sheep sees what they drew; nobody else does.
- **R-HIDE-02** The bag's contents are hidden. Draws are random, from the
  framework's `Random`, so for a rule-enforced game they come from the
  server's secret seed.
- **R-HIDE-03** When the game ends, every sheep is shown.

## 6. Actions on the board

### Flipping

- **R-FLIP-01** Turn over any face-down sheep, wherever it is. It stays on
  its field for the rest of the game.
- **R-FLIP-02** A player who turns over a black sheep gets two extra
  actions (R-TURN-02).

### The sheepdog

- **R-DOG-01** Put the dog on a field holding a face-down sheep. The dog
  leaves wherever it stood, so that field is empty again.
- **R-DOG-02** Move that sheep to another empty field (the one the dog just
  left counts) and only then turn it over.
- **R-DOG-03** A black sheep turned over this way gives the two extra
  actions too — **except under the first-edition rule** (option
  `firstEdition`, on by default), where turning a black sheep over with the
  dog gives no extra actions. Flipping one (R-FLIP-02) always does.
- **R-DOG-04** The dog stays where it was set down, on the sheep's old field,
  occupying it; it doesn't move with the sheep [AMBIG-5].

### Fences

Fences run along the edges between hexes and join at hex corners
("vertices"). Each farm has two **borders**, one shared with each
neighbouring farm — with two players, the two farms share both.

- **R-FENCE-01** On your turn you may build one fence extending either of
  your farm's borders. Your neighbour may extend the same border on theirs.
- **R-FENCE-02** A border's first fence starts at a **junction**: the corner
  where two neighbouring farmhouses meet the fields. With six players there
  is one junction per border; with fewer, a border may start at any junction
  between its two farms' farmhouses, and the first fence decides which.
- **R-FENCE-03** Fences may not be built back towards the farmhouses: a fence
  may run along a boundary between two rings of hexes, or out to the next
  one, never in to an earlier one [AMBIG-6]. After its first fence a line
  never runs along a farmhouse — only between two fields.
- **R-FENCE-04** A line may not touch another line, nor itself: no
  branching, forking or joining.
- **R-FENCE-05** A fence may not cut off any border's last remaining path
  to the edge of the board (its own included).
- **R-FENCE-06** A border is **finished** when its line reaches the outer
  edge of the board. It takes at least six fences.
- **R-FENCE-07** A player with no fences left can't build.
- A farm is **enclosed** when both its borders are finished. Its fields are
  everything reachable from its farmhouse without crossing a fence line (each
  line counts as reaching all the way in to the centre).

### Sheep special

- **R-SPECIAL-01** Available when no sheep on the board is face down
  [AMBIG-7]: take one sheep per player still in the game (fewer if the bag or
  the empty fields run short), look at them, and put each face down on its
  own empty field — in any order, one click each.
- **R-SPECIAL-02** It is the turn's action.

## 7. Scoring

- **R-SCORE-01** Only an enclosed farm scores its sheep.
- **R-SCORE-02** It scores the value of every face-up sheep on its fields.
  Face-down sheep score nothing [AMBIG-9]; black sheep are worth 0.
- **R-SCORE-03** A sheep on a bonus field counts its field's multiplier times
  (×2 or ×3, R-BOARD-03) [AMBIG-4].
- **R-SCORE-04** Each unused fence scores −1, enclosed or not.
- **R-SCORE-05** Multi-round variant (option `multiRoundScoring`): an
  unenclosed farm scores 10 less than the lowest-scoring enclosed farm of a
  player still in the game (−10 if there is none). The platform plays single
  games; the option only changes the scoring.
- Highest total wins; a tie shares the win.

## 8. The end

- **R-END-01** The game ends as soon as one farm is enclosed and every one of
  its fields is occupied, by a sheep or the dog — checked after every
  action, and after each sheep of a sheep special [AMBIG-10]. Extra actions
  still owed are lost; sheep still in hand go back to the bag.
- **R-END-02** It also ends when no player can take any action (the bag is
  empty or every field is occupied, nothing is face down, and no fence can be
  built).

## 9. Leaving

- **R-LEAVE-01** A player who concedes is out: their farm, fences and sheep
  stay on the board, sheep they had drawn go back to the bag, and their
  neighbours may still build on the borders they shared. Their farm can still
  end the game (R-END-01) but they can't win.

## 10. Decisions beyond the rules sheet

- **AMBIG-1 Board.** The sheet shows no board. Radius 4 (54 fields, borders
  of 6+ fences) was given after version 2, which played on radius 5 (84
  fields, borders of 8+ fences, §11). The fence counts (16/12/10 per player
  over 2–6 shared borders) leave room to bend.
- **AMBIG-2 Farms with fewer than six players.** Farmhouses are spread as
  evenly as six positions allow; the unused ones stay unplayable.
- **AMBIG-3 Sheep counters.** The sheet gives no mix. 90 counters (more than
  the 54 fields — and the 84 of the older radius-5 board — so the bag never
  runs dry before the board is full),
  weighted positive, with 10 black sheep.
- **AMBIG-4 Bonus fields.** The sheet's "geese fields multiply the sum of all
  sheep within them" gives no layout; the layout and multipliers of R-BOARD-03
  were given after version 1 (which had six ×2 geese fields, §11). Each field
  holds one sheep, so a multiplier applies to that sheep.
- **AMBIG-5 Where the dog ends up.** It stays on the field it was set down
  on, where the sheep was (a ruling given after version 1). The sheet's "the
  sheepdog can be returned to the centre of the board, or any other empty
  space" is read as describing where the dog stands before it is used —
  in the centre at the start, or wherever the last herd left it — not as a
  move of its own. Version 1 read it as a choice after herding (§11).
- **AMBIG-6 "Towards the farmhouses".** Measured by ring boundary: sideways
  along a boundary is allowed, inward is not. (Requiring every fence to lead
  strictly outward would make every border exactly six fences long, and the
  fence counts meaningless.) A line may run along a farmhouse only as its
  first fence, so a border can't wrap round a farmhouse and cut it off from
  its own fields.
- **AMBIG-7 Sheep special timing.** "At the beginning of your turn" is read
  as "whenever you choose an action", extra actions included. It is one of
  the five actions, not a compulsory extra.
- **AMBIG-8 A player who can't act** is skipped rather than passing
  indefinitely.
- **AMBIG-9 Face-down sheep at the end** score nothing, as the sheet says
  ("face up sheep"); they are shown afterwards.
- **AMBIG-10 Ending mid-special.** The game ends the moment a farm fills,
  even with sheep of a special still to place.

## 11. Older rules versions

Games replay under the version they started with. Versions 1 and 2 are kept
registered (`gameDefinitionV1`, `gameDefinitionV2`) and run from the same
code, branching on `rulesVersion` (`boardRadius`, `dogStays`,
`herdingBlackGivesBonus`, `bonusFields`) or on the board radius stored on the
game (`radiusOf`).

### Version 2

- **Radius 5.** The board had rings 0–5: 91 hexes, 84 fields, cells labelled
  A–K with the centre F6, and borders of at least eight fences. Such games
  carry no `radius` on their state, which `radiusOf` reads as 5. The bonus
  fields were the same; ring 4's stood one ring in from the edge.

### Version 1

As version 2 (radius 5), except in three ways:

- **Where the dog ends up.** After herding, the player chose: the dog stayed
  on the sheep's old field, went back to the centre (`dog: null`), or went
  to any other empty field. The `HERD` action had to say which (`dog`).
- **No first-edition rule.** A black sheep turned over with the dog always
  gave the two extra actions. The `firstEdition` option, which such games'
  options now read as on, is ignored.
- **Geese fields, not bonus fields.** Six fields, the ring-3 hex straight
  out from each farmhouse (where version 2 has its ×3 fields), each doubled
  its sheep (`GEESE`). `bonusFields(rulesVersion)` picks the layout.
