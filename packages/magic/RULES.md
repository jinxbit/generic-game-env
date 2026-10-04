# Magic: The Gathering (base set) — rules spec

The source of truth for `@game-platform/magic`. It follows the modern
Comprehensive Rules for a two-player game, restricted to what the cards in
this package's pool need. Every rule has a stable id that code comments and
test names cite; every place where this implementation deliberately
simplifies the real rules is an `AMBIG-n` with the behaviour picked.

Card text is written for this package (modern Oracle wording, paraphrased);
the pool is a selection of cards from the original base set (Alpha/Beta/
Unlimited/Revised) whose abilities the engine implements in full — plus, for
the Commander decks only (§10), two legendary commanders from Legends and a
selection of simple cards from later sets. Cards
whose abilities the engine doesn't model (banding, regeneration, damage
prevention shields, upkeep costs, …) are left out rather than shipped with
abilities missing.

## 1. Setup

- **R-SETUP-01** Two players. Each starts at the room's starting life
  (default 20, 1–100).
- **R-SETUP-02** Each player picks one of the preconstructed 40-card decks
  (`DECKS`, `src/cards.ts`: one per colour, 17 basic lands and 23 spells).
  Both pick at once; a pick stays hidden from the other player until both
  have picked. Both may pick the same deck.
- **R-SETUP-03** The starting player is chosen at random at genesis. They
  skip the draw of their first turn.
- **R-SETUP-04** Once both have picked, each library is shuffled and each
  player draws seven cards.
- **R-MULL-01** London mulligan. Both players decide at once: **keep**, or
  **mulligan** (shuffle the hand into the library and draw seven again).
  A player who keeps after `n` mulligans puts `n` cards from their hand on
  the bottom of their library, chosen as part of the keep. At most seven
  mulligans.
- **R-MULL-02** The cards put on the bottom are secret from the opponent.
  The bottom of the library is drawn only once the rest is exhausted, in the
  order they were put there (AMBIG-1).

## 2. Zones and hidden information

- **R-ZONE-01** Library, hand, battlefield, graveyard, stack, exile. Hands
  and libraries are hidden from the opponent (only their sizes are known);
  everything else is public.
- **R-ZONE-02** A card leaving the battlefield goes to its **owner's**
  zone; auras attached to it go to their owners' graveyards (R-SBA-04).
- **AMBIG-1** A library isn't stored in an order. Each draw takes a card at
  random from the part of the library not put on the bottom (then from the
  bottom part, first put first). Nothing in the pool looks at, reorders or
  searches a library, so this is the same distribution as a shuffled deck
  and nothing undrawn has to be hidden from anyone as an order.

## 3. Turn structure

- **R-TURN-01** A turn is: untap, upkeep, draw, first main phase, combat
  (beginning, declare attackers, declare blockers, combat damage, end),
  second main phase, end step, cleanup.
- **R-TURN-02** Untap: the active player untaps all their permanents. Their
  creatures stop being "summoning sick" (R-CREA-02).
- **R-TURN-03** Draw: the active player draws one card (not on the starting
  player's first turn, R-SETUP-03).
- **R-TURN-04** Cleanup: the active player discards down to seven cards
  (their choice); then all damage is removed and every "until end of turn"
  effect ends.
- **R-TURN-05** Mana empties from each player's mana pool at the end of every
  step and phase. There is no mana burn (modern rules).
- **R-TURN-06** A player may play one land per turn, during a main phase of
  their own turn, with priority and the stack empty.

## 4. Priority and the stack

- **R-PRIO-01** Spells and non-mana activated abilities go on the stack.
  When every player passes priority in succession, the top object resolves;
  afterwards the active player receives priority.
- **R-PRIO-02** Instants and activated abilities can be used whenever the
  player has priority. Every other spell (creatures, sorceries, enchantments,
  artifacts) needs a main phase of its controller's own turn and an empty
  stack.
- **R-PRIO-03** Mana abilities (lands, Llanowar Elves, Birds of Paradise,
  Dark Ritual is a spell) don't use the stack and resolve immediately. Costs
  are paid automatically from the mana pool first, then by tapping mana
  sources (lands before creatures); a player may tap sources by hand first
  to choose. A source that makes more than one mana (Sol Ring) and is tapped
  for less leaves the rest in its controller's pool.
- **R-PRIO-04** A spell or ability whose targets are all illegal when it
  would resolve doesn't resolve ("fizzles"); a spell goes to its owner's
  graveyard.
- **AMBIG-2 (priority windows)** To keep a two-player game playable without a
  click per step, a player is given priority with an **empty** stack only in
  these windows:
  - first and second main phase: the active player;
  - declare attackers step (after attackers are declared): the defending
    player — declaring blockers is their pass;
  - declare blockers step: the active player, then the defending player;
  - end step: the defending player.

  Whenever the stack is **not** empty both players receive priority as the
  real rules say. The active player's pass in the declare attackers and end
  steps is folded into declaring attackers and passing in the second main
  phase respectively; they can still respond to anything the defending
  player puts on the stack.
- **AMBIG-3 (no holding priority)** Casting a spell or activating an ability
  passes priority to the opponent: the caster can't respond to their own
  spell before the opponent has had the chance to.
- **AMBIG-4 (automatic passes)** A player who holds priority with no cards
  in hand, no non-mana activated ability they could pay for and (§10) no
  commander in the command zone they could cast passes automatically. That is judged only from public information (hand size,
  permanents, untapped mana sources), so it gives nothing away.
- **AMBIG-5 (triggers)** The pool's one triggered ability (Hypnotic Specter)
  resolves immediately when it triggers instead of going on the stack.

## 5. Creatures and combat

- **R-CREA-01** A creature with damage marked on it equal to or greater than
  its toughness is destroyed; one with toughness 0 or less goes to the
  graveyard (R-SBA-02/03).
- **R-CREA-02** A creature can't attack, and its {T} abilities can't be
  activated, unless its controller has controlled it continuously since the
  start of their most recent turn ("summoning sickness").
- **R-ATK-01** The active player declares attackers: untapped creatures they
  control that aren't summoning sick and don't have defender. Attacking taps
  a creature unless it has vigilance. A creature that "attacks each combat
  if able" must be declared when it can. With no creature able to attack,
  combat is skipped.
- **R-BLK-01** The defending player declares blockers: each untapped
  creature they control may block one attacker. An attacker may be blocked
  by several creatures.
- **R-BLK-02** Evasion: a creature with flying can be blocked only by
  creatures with flying or reach; with landwalk (swampwalk, islandwalk, …)
  it can't be blocked while the defending player controls a land of that
  type; with protection from a colour it can't be blocked by creatures of
  that colour; Juggernaut can't be blocked by Walls.
- **R-DMG-01** Combat damage: an unblocked attacker deals damage equal to its
  power to the defending player. A blocked attacker deals its damage to its
  blockers; a blocked attacker whose blockers have all left combat deals no
  damage unless it has trample. Each blocker deals damage equal to its power
  to the attacker it blocks.
- **R-DMG-02** An attacker blocked by several creatures assigns lethal damage
  to each in turn before moving on; with trample, the rest may go to the
  defending player. **AMBIG-6:** the order and assignment are automatic —
  blockers in the order they were declared, exactly lethal damage to each
  (counting damage already marked), all the rest to the player with trample,
  or to the last blocker without.
- **R-DMG-03** First strike: if any attacking or blocking creature has first
  strike, creatures with first strike deal their combat damage first, in a
  step of their own; the others deal theirs in a second step (if still on
  the battlefield).
- **R-DMG-04** Damage from a source of a colour a creature has protection
  from is prevented.
- **R-KW-01** Keywords: flying, reach, first strike, trample, vigilance,
  defender, protection from a colour (can't be blocked by, targeted by,
  dealt damage by, or enchanted by that colour), landwalk, haste (ignores
  R-CREA-02), "can't be blocked".

## 6. State-based actions

Checked after every spell or ability resolves, after combat damage, and
after each action.

- **R-SBA-01** A player with 0 or less life loses. A player who had to draw
  from an empty library loses.
- **R-SBA-02** A creature with toughness 0 or less goes to its owner's
  graveyard.
- **R-SBA-03** A creature with lethal damage marked on it is destroyed.
- **R-SBA-04** An aura not attached to a legal object (gone, or protected
  from the aura's colour) goes to its owner's graveyard.
- **R-SBA-05** Commander only: a player who has taken 21 or more combat
  damage from a single commander loses (R-CMD-05).
- **R-END-01** When a player loses, the other wins. If both lose at once the
  game is a draw (no winner).

## 7. Colours and characteristics

- **R-CHAR-01** A card's colours are the colours of the mana symbols in its
  cost; lands and artifacts are colourless.
- **R-CHAR-02** A creature's power and toughness are its printed values
  (Nightmare's are the number of Swamps its controller controls), plus
  static anthems (Crusade, Bad Moon), plus its auras, plus "until end of
  turn" effects.

## 8. Card-specific notes

- **AMBIG-7** Fireball deals X damage to one target (its option of dividing
  the damage among several targets isn't offered).
- **AMBIG-8** X is chosen when casting; X is 0 anywhere else (a spell with
  X in a zone other than the stack).

## 9. Options

- `startingLife` — 20 by default, clamped to 1–100 (40 by default when
  `commander` is set and no life is given; the options editor proposes 40
  when Commander is picked, and 20 when it's unpicked).
- `commander` — play Commander (§10). Stored only when on, so a standard
  game's options and genesis are exactly what they were before the format
  existed (no new `rulesVersion` was needed: nothing a standard game can
  reach changed).

## 10. Commander

- **R-CMD-01** With the `commander` option, each player picks one of the
  Commander decks (`COMMANDER_DECKS`, `src/cards.ts`) instead of a base-set
  one: a legendary creature — the **commander** — and 99 other cards, at
  most one of each card but basic lands, every one of them within the
  commander's **colour identity** (the colours of the mana symbols in its
  cost and rules text). The two decks are Tobias Andrion's white-blue
  *Tobias's Skies* and Jerrard of the Closed Fist's red-green *Jerrard's
  Stampede* (37 basic lands each). Both may pick the same deck.
- **R-CMD-02** Once both have picked, each commander is set aside in its
  owner's **command zone**, which is public; the other 99 cards are the
  library. Opening hands and mulligans follow R-SETUP-04 and R-MULL-01 (the
  first mulligan isn't free: that's a multiplayer rule).
- **R-CMD-03** A player may cast their commander from the command zone
  whenever they could cast it from their hand (a creature: R-PRIO-02),
  paying an additional {2} for each time they've already cast it from the
  command zone (the **commander tax**).
- **R-CMD-04** A commander that would leave the battlefield for anywhere
  (graveyard, exile, hand), and a commander spell that would go to the
  graveyard (countered), goes to the command zone instead. Auras that were
  on it still go to their owners' graveyards (R-SBA-04).
- **R-CMD-05** Each player's combat damage taken from each commander is
  tracked over the whole game; 21 or more from one commander loses the game
  (R-SBA-05), whatever their life total. Only combat damage counts.
- **AMBIG-9 (two players)** Commander is usually played by more; this
  engine is two-player, so it plays the one-on-one game, under the
  multiplayer format's rules otherwise (40 life proposed, 21 commander
  damage).
- **AMBIG-10 (automatic command zone)** The real rules let the owner choose
  whether a commander goes to the command zone; here it always does (it's
  almost always the better choice, and it saves a prompt). That includes a
  commander returned to its owner's hand.
