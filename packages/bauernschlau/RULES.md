# Bauernschlau — Implementation Rules Spec

> This file is the source of truth for the Bauernschlau rules engine in
> `packages/bauernschlau`, as of **rules version 1**. Rule ids (`R-FENCE-03`
> and so on) are cited in the code and the tests. `[AMBIG-n]` marks a point
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
| Board | a hexagon of hexes, radius 5 [AMBIG-1] | `CELLS` (board.ts), axial coordinates, 91 hexes numbered row by row |
| Farmhouses | six, one per colour | the six hexes around the centre |
| Sheepdog | one | `dog`: a cell, or null for the centre |
| Sheep counters | 90 [AMBIG-3] | `bag`, `hand`, `sheep[cell]` |
| Fences | per player: 16 (2–3 players), 12 (4–5), 10 (6) | `farms[id].fencesLeft`; built fences on `borders[i].path` |

- **R-COMP-02** The sheep counters [AMBIG-3]: white sheep worth +5 ×4,
  +4 ×6, +3 ×10, +2 ×12, +1 ×14, −1 ×12, −2 ×10, −3 ×8, −4 ×4, and 10
  black sheep worth 0.

## 2. Board

- **R-BOARD-01** The board is a hexagon of radius 5: 91 hexes in rings 0–5
  around the centre.
- **R-BOARD-02** The seven central hexes — the centre and the six
  farmhouses around it — are unplayable. The other 84 hexes are **fields**.
- **R-BOARD-03** Six fields are **geese fields**: the ring-3 hex straight out
  from each farmhouse [AMBIG-4].
- Cells are labelled by row letter from the top (A–K) and position in the row
  from the left: the top-left field is A1, the centre F6.

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
- **R-TURN-02** Turning over a black sheep, by flipping or with the dog,
  gives two extra actions, taken at once, of any kind (R-FLIP-02). Extra
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
  actions too.
- **R-DOG-04** The dog then stays on the sheep's old field, or goes back to
  the centre, or to any other empty field, occupying it [AMBIG-5].

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
  edge of the board. It takes at least eight fences.
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
- **R-SCORE-03** A sheep on a geese field counts double [AMBIG-4].
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

- **AMBIG-1 Board.** The sheet shows no board. A radius-5 hex hexagon gives
  84 fields and borders of 8+ fences, which fits the fence counts (16/12/10
  per player over 2–6 shared borders) with room to bend.
- **AMBIG-2 Farms with fewer than six players.** Farmhouses are spread as
  evenly as six positions allow; the unused ones stay unplayable.
- **AMBIG-3 Sheep counters.** The sheet gives no mix. 90 counters (more than
  the 84 fields, so the bag never runs dry before the board is full),
  weighted positive, with 10 black sheep.
- **AMBIG-4 Geese.** "Geese fields multiply the sum of all sheep within
  them" — read as: a geese field doubles the sheep on it. Six geese fields,
  one on each farmhouse's axis at ring 3.
- **AMBIG-5 Where the dog ends up.** "The sheepdog can be returned to the
  centre of the board, or any other empty space" is read as part of the
  sheepdog action: after herding, the dog stays, goes home, or moves on. It
  is not a separate action (which would let the game stall forever).
- **AMBIG-6 "Towards the farmhouses".** Measured by ring boundary: sideways
  along a boundary is allowed, inward is not. (Requiring every fence to lead
  strictly outward would make every border exactly eight fences long, and the
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
