# Texas Hold'em — rules spec

No-limit Texas Hold'em, played as a tournament (a "sit and go"): everyone
starts with the same stack, the blinds rise on a schedule, and a player who
runs out of chips is out. The last player with chips wins. This file is the
source of truth for `src/`; code comments and tests cite its ids. Gaps the
usual rules leave open, and simplifications made for online play, are listed
as `AMBIG-n` in §9 with the behaviour chosen.

## 1. Setup

- **R-SETUP-01** 2–9 players. Each starts with `startingStack` chips (option,
  default 1 000).
- **R-SETUP-02** One standard 52-card deck. Cards are dealt at random from
  whatever the current hand hasn't dealt yet (AMBIG-1).
- **R-SETUP-03** The first hand's button is the first seat (AMBIG-2).

## 2. Blinds

- **R-BLIND-01** The big blind of hand *h* is `bigBlind × 2^level`, where
  `level = floor((h − 1) / blindsDoubleEvery)`, or 0 when `blindsDoubleEvery`
  is 0 (fixed blinds). The small blind is half the big blind, rounded down.
- **R-BLIND-02** With three or more players the small blind is the next
  player after the button and the big blind the next after that. Heads-up
  (two players) the button posts the small blind and the other player the
  big blind.
- **R-BLIND-03** A player who can't cover a blind posts what they have and
  is all in.
- **R-BLIND-04** The button moves each hand to the next player, in seat
  order, who still has chips (AMBIG-2).

## 3. A hand

- **R-HAND-01** Every player with chips is dealt two hole cards, which only
  they may see.
- **R-HAND-02** Streets, in order: pre-flop, flop (three board cards), turn
  (one), river (one). Each street has a betting round; after the river's
  comes the showdown.
- **R-HAND-03** Pre-flop, the first to act is the player after the big blind
  (heads-up: the button). On later streets, the first player after the
  button who can still act.
- **R-HAND-04** A hand ends as soon as only one player hasn't folded: they
  win every pot uncontested and show nothing.
- **R-HAND-05** When at most one player who hasn't folded can still bet (the
  rest are all in) and they have matched the highest bet, no more betting
  happens: the remaining board cards are dealt straight away (AMBIG-3).

## 4. Betting

- **R-BET-01** A player to act may **fold**, **check** (only when there is
  nothing to call), **call** (match the current bet, or put in everything
  they have if that's less) or **bet / raise** to a total for the street.
  Folding when a check is possible is refused (AMBIG-4).
- **R-BET-02** No limit: a player may bet up to everything they have.
- **R-BET-03** The minimum bet is the big blind. A raise must increase the
  current bet by at least the size of the last full bet or raise on this
  street (pre-flop, the big blind counts as a bet of one big blind).
- **R-BET-04** A player may always go all in. An all-in raise smaller than a
  full raise is allowed but is **incomplete**: it doesn't reopen the betting
  — a player who has already acted and faces only incomplete raises since
  may call or fold, not raise (AMBIG-5).
- **R-BET-05** Pre-flop, callers must match the full big blind even when the
  big blind posted less (R-BLIND-03); the big blind may check or raise when
  nobody has raised.
- **R-BET-06** A betting round ends when every player who hasn't folded and
  isn't all in has acted since the last full raise and matched the current
  bet.
- **R-BET-07** Nobody may raise when no other player could respond (all the
  others still in the hand are all in).

## 5. Pots

- **R-POT-01** At the end of a hand, the part of the largest contribution
  that nobody matched is returned to its owner ("uncalled bet").
- **R-POT-02** Side pots: each level at which a player still in the hand went
  all in closes a pot. A pot is contested by every player still in the hand
  who contributed at least that level; folded players' chips are in the pots
  but they can't win them.
- **R-POT-03** Each pot goes to the best hand among its contenders. Ties
  split it evenly; the odd chips go one at a time to the tied winners in seat
  order starting after the button.

## 6. Hand ranking

- **R-RANK-01** Each player's hand is the best five of their two hole cards
  and the five board cards. From best to worst: straight flush, four of a
  kind, full house, flush, straight, three of a kind, two pair, one pair,
  high card. Suits never break ties.
- **R-RANK-02** The ace plays high, or low in the five-high straight
  (A-2-3-4-5, the "wheel").
- **R-RANK-03** Hands of the same category compare by their ranks in order of
  importance (the quads, trips or pairs first, then kickers, highest first).
- **R-SHOW-01** At a showdown every player still in the hand shows their hole
  cards (AMBIG-6).

## 7. Busting out and the end

- **R-END-01** After a hand, a player with no chips is out of the tournament.
- **R-END-02** The game ends when only one player has chips: they win.
- **R-END-03** With `maxHands` set (option, 0 = no limit), the game also ends
  after that many hands; the players with the most chips win (ties share).
- **R-LEAVE-01** A player who concedes folds any hand they are in (their bets
  stay in the pot) and their remaining chips leave the game.

## 8. Options

| Option | Default | Range |
| --- | --- | --- |
| `startingStack` | 1 000 | 100 – 1 000 000 |
| `bigBlind` | 20 | 2 – 100 000, even |
| `blindsDoubleEvery` (hands) | 10 | 0 (never) – 100 |
| `maxHands` | 0 (no limit) | 0 – 1 000 |

## 9. Decisions (AMBIG)

- **AMBIG-1** No burn cards, and no deck order is kept: each card is drawn at
  random from the cards the hand hasn't dealt at the moment it is dealt (hole
  cards when the hand starts, board cards when their street opens). It is
  equivalent to dealing from a shuffled deck, keeps undealt cards out of the
  game state entirely, and makes every card-revealing move one that drew
  random numbers — which is what the platform's "lock revealed information"
  undo setting keys on.
- **AMBIG-2** The button starts in the first seat and simply moves to the
  next player with chips; there is no "dead button" or "dead small blind"
  rule when players bust.
- **AMBIG-3** An all-in run-out, and the next hand's deal after a hand ends,
  happen inside the move that caused them — there is no pause between hands.
  The last hand's result (who showed what, who won which pot) stays on the
  table until the next hand ends.
- **AMBIG-4** Folding when checking is free is refused, as it can only lose.
- **AMBIG-5** Several incomplete all-in raises that together add up to a full
  raise still don't reopen the betting.
- **AMBIG-6** Everyone still in at a showdown shows; there is no mucking.
