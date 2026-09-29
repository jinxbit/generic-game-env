# Vernissage — Implementation Rules Spec

> This file is the source of truth for the Vernissage rules engine in
> `packages/vernissage`, as of **rules version 1**. Rule ids (`R-FATE-04` and
> so on) are cited in the code and the tests. `[AMBIG-n]` marks a point the
> rulebook leaves open; §12 lists the behaviour chosen for each. Changing any
> of them changes how existing games replay, so it ships with a new
> `rulesVersion`.

Source: the English translation of the Vernissage rulebook (Peter Wotruba,
via The Game Cabinet), supplied with the request that added this game. The
translation describes the board only in words and gives none of its printed
numbers (fame-track values, counter values, pile prices, number of steps). All
of those are therefore choices made here. Each is a named constant in
`src/data.ts` and an `AMBIG` entry below.

## 1. Components

| Component | Count | Model |
| --- | --- | --- |
| Money, Rubens | bank of notes | an integer per player. The bank is unlimited. |
| Promissory notes | 10 | `players[id].notes`, unlimited [AMBIG-9] |
| Artists | 5: Elfrieda Krach, Joe Boyz, Donna Salva Kali, Karl Hering, Ron Lightenstone | `artists[id]` |
| Success staircase | steps 1–10 per artist [AMBIG-1] | `artists[id].step`, `artists[id].counters` |
| Scale of fame | spaces 1–27, plus OUT [AMBIG-2] | `artists[id].fame` (0 once OUT) |
| Fate counters | 14 purchase, 12 criticism, 12 scandal [AMBIG-3] | `pool[kind][value - 1]`: counters available |
| Fate die | purchase, purchase, criticism, scandal, wild, minus [AMBIG-4] | drawn in `ROLL_FATE` |
| Red dice | 2 × d6 | drawn when a Trial of Strength is decided |
| Agents | 3 per player | `players[id].agents`: a step, or null when in reserve |
| Critic's feather | 1 | `feather`: an artist, or null |
| Brown cards | 35 works (7 per artist), 23 might, 13 critic, 11 unlimited step change | dealt into hands and the seven piles |
| Grey cards | 23 limited step change [AMBIG-5] | `greyDeck`, `greyDiscard` |

## 2. Setup

- **R-SETUP-01** 3–5 players, each with one gallery.
- **R-SETUP-02** Every artist stands on step 1 with no counters in front of it.
  Every fame marker starts on the 100 000 space (space 16).
- **R-SETUP-03** Each player's agents start on steps 1 and 2; the third is in
  reserve. Everyone therefore starts with influence over every artist.
- **R-SETUP-04** Brown cards are shuffled and three are dealt to each player.
  A player dealt three works puts them back, the brown deck is reshuffled and
  they draw three again [AMBIG-6].
- **R-SETUP-05** Seven piles of seven brown cards are dealt face down. They
  cost 10 000, 20 000, … 70 000 Rubens [AMBIG-7]. The brown cards left over
  are set aside unseen for the whole game [AMBIG-8].
- **R-SETUP-06** Grey cards are shuffled into the grey deck. Everyone starts
  with 200 000 Rubens.
- **R-SETUP-07** The first seat starts and play goes clockwise (seat order)
  [AMBIG-10].

## 3. Influence

- **R-INF-01** A player has influence over an artist who is still in the
  game when one of their agents stands on the artist's step.
- **R-INF-02** Two agents of one player may never share a step. Agents of
  different players may.

## 4. The turn

A turn is three steps in order: **assign a fate counter** (§5), **buy a
card** (§8), **play cards** (§9).

- **R-TURN-01** A player with influence over no artist skips the fate step.
- **R-TURN-02** The turn ends when the player ends it or plays a critic card
  (the last card a turn may play).

## 5. Fate counters

- **R-FATE-01** The player rolls the fate die (`ROLL_FATE`).
- **R-FATE-02** Purchase, criticism or scandal: they take a counter of that
  kind. Wild: any kind. Minus: criticism or scandal. They pick any value still
  available of an allowed kind.
- **R-FATE-03** If no counter of any allowed kind is left, they may take any
  kind that is. (A turn never starts with the pool empty: R-END-04.)
- **R-FATE-04** They place the counter (`PLACE_COUNTER`) in front of an
  artist they have influence over, on the next empty step above the artist:
  step `artist.step + counters + 1`.
- **R-FATE-05** Purchase counters are worth their value; criticism and scandal
  counters are worth minus their value.
- **R-FATE-06** If no other player has influence over that artist, the counter
  takes effect at once (§7). Otherwise objections follow (§6).

## 6. Objections and the Trial of Strength

The rulebook resolves objections by free negotiation. The platform turns it
into fixed rounds [AMBIG-11]:

- **R-OBJ-01** Every other player with influence over the artist answers at
  the same time (`RESPOND`): accept, or object and propose another value of
  the same kind that is still available.
- **R-OBJ-02** If nobody objects, the counter takes effect (§7).
- **R-OBJ-03** Otherwise the placer sees the proposals and either agrees to
  one (`NEGOTIATE` with a value), which swaps the counter for that value and
  settles the dispute for everyone, or refuses (`NEGOTIATE` without a value).
- **R-OBJ-04** After a refusal, every objector decides at the same time
  whether to call a Trial of Strength (`CHALLENGE`). If nobody does, the
  counter takes effect unchanged. Those who do are the contra players; the
  placer is the pro player.
- **R-TRIAL-01** Might cards are committed face up in rounds (`COMMIT_MIGHT`,
  any number from the hand, zero included). The contra players commit first,
  at the same time; then the pro player. If the pro player added a card, the
  contra players get another round; if they then add nothing, the dice decide.
  Otherwise after a contra round in which someone added cards, the pro player
  answers again. So the pro player always has the last decision.
- **R-TRIAL-02** Then every participant rolls two dice, contra players first,
  and adds one per might card they committed. The highest total wins. If the
  pro player ties the best contra total, those tied roll again (their might
  still counts) until one side is ahead.
- **R-TRIAL-03** Pro player wins: the counter stays and takes effect (§7).
  Every contra player's agent on the artist's step goes back to reserve.
- **R-TRIAL-04** Contra side wins: the counter goes back to the pool. The pro
  player's agent on the artist's step goes back to reserve. The turn goes on
  with buying a card.
- **R-TRIAL-05** Committed might cards go back to their owners' hands.
- **R-TRIAL-06** Option `mightVariant` (the rulebook's variant): a
  participant whose first total is 14 or more discards one of their committed
  might cards from the game.

## 7. A counter takes effect

- **R-EFFECT-01** The fame marker moves by the counter's worth, plus −5 if
  the artist carries the critic's feather (R-CRITIC-03).
- **R-EFFECT-02** Then, if the counters in front of the artist include all
  three kinds, the artist holds a Vernissage (§7.1).
- **R-EFFECT-03** A counter on the top step that stays ends the game once it
  has taken effect (R-END-01).

### 7.1 Vernissage

- **R-VERN-01** The artist jumps over its counters to the next free step,
  `step + counters + 1`, at most the top step. The counters go back to the
  pool.
- **R-VERN-02** Its position is then 1 + the number of artists still in the
  game standing on a higher step. Position 1 (level with or above everyone):
  Great Vernissage, fame +12. Position 2: Small Vernissage, fame +6. Lower:
  nothing.
- **R-VERN-03** An artist carrying the critic's feather still jumps but gets
  no bonus.

### 7.2 The scale of fame

- **R-FAME-01** Space `n` is worth `(n − 6) × 10 000` Rubens: space 1 is
  −50 000, space 16 is 100 000, space 27 is 210 000.
- **R-FAME-02** Spaces 24–27 are the golden IN region. A marker moving past
  space 27 stops on it.
- **R-FAME-03** A marker moving to space 0 or below is OUT (§7.4).

### 7.3 The artist is IN

- **R-IN-01** When a fame marker enters the IN region, each player may show
  any of that artist's works still hidden in their hand (`DISPLAY`, all
  players at the same time — everyone is asked, so being asked reveals
  nothing about a hand) [AMBIG-12].
- **R-IN-02** Shown works stay face up for the rest of the game. Every shown
  work of the artist then earns the value of the IN space the marker reached.
- **R-IN-03** The marker then moves to space 23, the first space outside the
  IN region.
- **R-IN-04** One counter can put an artist IN twice (the counter, then its
  Vernissage). Each time pays; players are asked once.

### 7.4 The artist is OUT

- **R-OUT-01** The artist leaves the game with its fame marker. Its counters
  go back to the pool and the feather, if it carries it, leaves the board.
  Nobody has influence over it any more.
- **R-OUT-02** Its works stay where they are and cost their owner 100 000 at
  the end.
- **R-OUT-03** When the second artist goes OUT, the game ends at once.

## 8. Buying a card

- **R-BUY-01** The player must buy a card if any is available: a brown pile
  (`BUY_PILE`), paying the pile's price, or the top grey card (`BUY_GREY`) for
  10 000.
- **R-BUY-02** Buying a pile shows the buyer its cards. They take one or none
  (`TAKE_CARD`); the rest go back face down. The price is not refunded.
- **R-BUY-03** An empty grey deck is refilled by shuffling the grey discard.
- **R-BUY-04** A player who can't pay borrows 100 000 from the bank for a
  150 000 promissory note, as often as needed [AMBIG-9].
- **R-BUY-05** If no card can be bought at all, the step is skipped.
- **R-BUY-06** Works are never sold back or given away.

## 9. Playing cards

- **R-PLAY-01** A player may play at most two cards: a step change card, then
  a critic card. Either can be played alone.
- **R-PLAY-02** Unlimited step change (brown): every agent on the board may
  move to any step, and any reserve agent may be placed on any step. Agents
  on the board stay on the board. The card leaves the game.
- **R-PLAY-03** Limited step change (grey, value `n`): one agent on the board
  moves at most `n` steps up or down [AMBIG-13], or one reserve agent is
  placed on a step no higher than `n`. The card goes to the grey discard.
- **R-CRITIC-01** A critic card is played on an artist the player has
  influence over. The player puts the critic's feather on that artist (from
  wherever it was), and the card leaves the game.
- **R-CRITIC-02** The artist's fame marker moves 5 spaces toward OUT.
- **R-CRITIC-03** While an artist carries the feather, every counter that
  takes effect in front of it moves it 5 more spaces toward OUT, and its
  Vernissage earns no bonus.

## 10. End of the game

- **R-END-01** The game ends when a counter on the top step stays (after any
  Trial), when an artist reaches the top step, or when the second artist goes
  OUT. A last counter or jump still pays its Vernissage and IN payments.
- **R-END-04** It also ends when a turn starts with no fate counter left in
  the pool, since nothing can move any more [AMBIG-17].
- **R-END-02** Every player's assets: cash, plus each of their works (shown
  or hidden) at the value of its artist's fame space — negative spaces cost
  money — or −100 000 for an artist who is OUT, minus 150 000 per promissory
  note.
- **R-END-03** The most assets wins; ties share the win.

## 11. Leaving the game

- **R-LEAVE-01** A player who concedes loses their agents from the board and
  is dropped from every decision still open.
- **R-LEAVE-02** If it was their turn, a counter still under dispute goes back
  to the pool, committed might cards go back, and the next player's turn
  begins. An IN payment already under way is still paid.
- **R-LEAVE-03** A contra player who leaves a Trial withdraws. If no contra
  player is left, the counter stays and takes effect.

## 12. Ambiguities and the choices made

| Id | Question | Choice |
| --- | --- | --- |
| AMBIG-1 | How many steps has the staircase? | 10. Artists start on step 1, the top step is 10. |
| AMBIG-2 | The fame track's spaces and values. | Spaces 1–27 at `(n − 6) × 10 000`. Start on 16 (100 000, as the rulebook says). IN is 24–27. The rulebook's IN example (a 60 000 space) doesn't fit this track and is ignored. |
| AMBIG-3 | The counters' values. The rulebook says "all different", but that can't hold for 14 counters with example values −6 and −3. | Two of each value: purchase +1…+7, criticism −1…−6, scandal −1…−6. |
| AMBIG-4 | The fate die's six faces (five symbols are listed). | purchase, purchase, criticism, scandal, wild, minus. |
| AMBIG-5 | The grey cards' numbers. | 8 × 1, 8 × 2, 7 × 3. |
| AMBIG-6 | "If someone receives three works of art, they can draw again." | Always redraw; the rulebook says "can", but three works and no other card is never a useful start. |
| AMBIG-7 | The seven piles' prices. | 10 000 to 70 000 in steps of 10 000. |
| AMBIG-8 | What happens to the brown cards not dealt? | Set aside unseen. |
| AMBIG-9 | When is the loan taken? | Automatically, at the moment a purchase costs more than the player's cash. Unlimited. |
| AMBIG-10 | "The highest roll starts." | Seat order decides, since the platform already seats players in random order. |
| AMBIG-11 | Free negotiation. | The fixed rounds of §6. Players can still talk in chat. |
| AMBIG-12 | Is showing works at IN optional? | Yes. The tips ("Consider the fallout") only make sense if it is. |
| AMBIG-13 | May a limited step change move an agent down? | Yes, up or down, at most `n` steps. |
| AMBIG-14 | May a critic card be played on the artist already carrying the feather? | Yes; it moves 5 more spaces. |
| AMBIG-15 | When several objectors propose values and the placer agrees to one. | That settles the dispute for everyone. |
| AMBIG-17 | Every counter stands in front of an artist and no artist can hold a Vernissage. | The game ends (R-END-04). The rulebook never reaches this state; without the rule a game could stall forever. |
