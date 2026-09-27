# Incorporated — Implementation Rules Spec

> **For Claude Code:** this file is the source of truth for the Incorporated rules engine in `generic-game-dev`.
> - Work one chunk from §14 at a time. Every chunk ends with its acceptance checks passing as unit tests.
> - Cite rule IDs (`R-INV-03` etc.) in code comments, test names and commits.
> - `[AMBIG-n]`: implement the default from §13 and keep it configurable. Don't invent other behaviour.
> - `[DATA]` / `[RECON]`: load from data files and stub what's missing. Never hard-code board or card content in logic.
> - Variant flags (§11) are config toggles, off by default.
> - Reuse the repo's existing room, turn and rules-DSL infrastructure where it fits, rather than building parallel systems.
> - If a rule here conflicts with the code, stop and ask; don't silently pick one.

Sources: base rulebook (TCA Games, doc 767-INC-RB002) and the *10th Year Anniversary / Heavy Cardboard Edition* variant sheet. Canonical, editable version: https://claude.ai/code/artifact/255bc438-c895-4bf8-a285-acc4c5cfc020

## 0. How to use this spec

**Scope:** base rules for 2–4 players. Each 10th-anniversary change is a toggle (flag names in §11). Where a toggle changes a base rule, the base section marks the hook as `⚑ FLAG_NAME`.

**Conventions**

- Rule IDs such as `R-INV-03` are stable references for code, tests and tickets.
- `[AMBIG-n]` marks an unclear rule. Each one is listed in §13 with the default I assumed.
- `[DATA]` marks content that has to be supplied (see §12).
- `[RECON]` marks data reconstructed from the board image. Verify it against a physical board.
- "Cube" always means a player asset cube. Black cubes are called "lock cubes".
- "Round" and "turn" mean the same thing: one pass through phases 1–5.

**Recommended build order:** state model (§1) → board data (§2) → setup (§3) → phases in order (§4–§10) → variants (§11). §14 splits this into chunks, each with acceptance checks.

## 1. Game state model

### 1.1 Entities

| Entity | Fields |
|---|---|
| Game | round (1–4, or 1–3 with ⚑ THREE_ROUNDS), phase (1–5), sliders, outlookDeck (4 cards), payoffDeck, payoffDiscard, revealedPayoffs, rdMarker (square id, or null with ⚑ ACCUM_RD), investmentBank (count per major country), battlegroundMarkers (per zone: country id, or removed), turnOrder, activePlayer, variantFlags |
| Player | corporation, colour, cash (hidden from other players), bonds (count), shares (count per major country), cubeSupply, executivesInPool, onceUsed flags (variants) |
| Country | id, zone, isMajor, stability (3–5), affiliation (NATO / SCO / BATTLEGROUND), startingCamp (majors only), localBonus {camp, +n} or none, squares[], arrowsOut[] (directed), looseCubes {player → n} (non-occupying cubes), defenders {player → n} (executives) |
| Square | industry (FIN / HEAVY / ENERGY / TECH / MINING), occupant (player / LOCK / empty), fortified (bool, ⚑ ACCUM_RD) |
| TaxHavens | one FIN square, looseCubes, parked executives. It has no affiliation and belongs to no zone. |

**Information visibility:** cash is private. Everything else is public, including bond count, shares and cube positions. Revealed payoff cards are public. The payoff discard pile is face up but may not be inspected (R-GEN-01: the UI must not show the discard contents). Only the Big Brother player sees the top Outlook card (see R-EARN-07).

### 1.2 Sliders

Movement is clamped at the ends of each track unless a rule says otherwise (see ⚑ QE_HYPERINFLATION).

**Interest Rates:** the loan value per bond. Index 0 is the leftmost position (easy money). Moving right means tighter money.

| idx | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| value | $20 | $19 | $18 | $17 | $16 | $15 | $14 | $13 | $12 | $11 |

**Global Growth** `[RECON]`: moving right means higher growth.

| idx | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| growth % | −3 | −2 | −1 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| payoffs revealed | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |

The rulebook confirms three points: 2% → 5 payoffs, 5% → 8 and 6% → 9. The board image appears to skip 0% [AMBIG-1].

**Stress** `[RECON]`: an integer from −2 to +2. Up means more stress.

**Balance of Power** `[RECON]`: stored as a signed integer. Positive means NATO, negative means SCO. The visible positions are +3, +2, +1, 0, −1, −2 and −3, plus an eagle end-cap on the NATO side and a dragon end-cap on the SCO side. What the end-caps mean is unclear [AMBIG-2]. The clash modifier equals the slider value, applied from the supported side's point of view.

### 1.3 Component counts

- **Investment cards (30):** US 7, China 7, Eurozone 6, Japan 3, India 3, Russia 2, Brazil 2.
- **Payoff deck:** 25 cards, 5 per industry. **Outlook deck:** 10 cards, 4 drawn per game. **Bonds:** 25.
- **Cubes:** red 45, green 45, blue 35, yellow 30, black (lock) 10. **Meeples:** red 4, green 4, blue 3, yellow 3.
- **Corporations:** Fortress Derivatives (green), Giant Squid (blue), Big Brother (red), Old Money (yellow, colour inferred). Play order is fixed: FD first, Old Money last [DATA: the full order].
- **Dice:** d12 for crisis, d6 for clashes.
- **Cash** is unlimited in code. **Industry chips** are a UI convenience only: derive them from state.

## 2. Board data `[RECON]`

This data is reconstructed from the rulebook images at low resolution. The confidence column shows how sure I am. Treat **Low** rows and the whole arrow list as "verify against a board photo".

### 2.1 Countries

Squares are listed top to bottom as printed. The bottom-most squares matter for setup locks.

| Zone | Country | Major | Stab. | Start affil. | Local bonus | Squares | Conf. |
|---|---|---|---|---|---|---|---|
| America | United States | ✔ | 5 | NATO | NATO (auto-win, R-LOB-09) | FIN, FIN, FIN, TECH, TECH, ENERGY★, HEAVY | High |
| America | Canada | | 5 | NATO | +1 NATO | MINING | Med |
| America | Latin America | | 4 | NATO | none | ENERGY | Med |
| America | Brazil | ✔ | 4 | SCO | +1 SCO | ENERGY, MINING | Med |
| America | South America | | 4 | BATTLEGROUND | +1 SCO | MINING | Med |
| Europe | United Kingdom | | 5 | NATO | +1 NATO | FIN | High |
| Europe | Scandinavia | | 5 | NATO | none | TECH | Med |
| Europe | Eurozone | ✔ | 5 | NATO | +1 NATO | FIN, FIN, TECH, TECH, HEAVY, HEAVY | High |
| Europe | Eastern Europe | | 4 | BATTLEGROUND | +1 SCO | HEAVY | High |
| Europe | Russia | ✔ | 4 | SCO | +1 SCO | ENERGY, ENERGY | High |
| Asia | China | ✔ | 5 | SCO | SCO (auto-win) | FIN, TECH, MINING, HEAVY, HEAVY, FIN, ENERGY | Med |
| Asia | Japan | ✔ | 5 | NATO | +1 NATO | FIN, TECH, HEAVY, HEAVY | High |
| Asia | India | ✔ | 4 | SCO | +1 SCO | MINING, HEAVY, TECH, MINING, HEAVY | High |
| Asia | Korea | | 5? | NATO | ? | FIN? TECH? | Low |
| Asia | South Sea | | 4 | BATTLEGROUND | none | TECH | High |
| Asia | Indonesia | | 4? | SCO | +1 SCO? | ENERGY | Low |
| Asia | Australia | | 5 | NATO | +1 NATO | MINING | Med |
| 3rd World | Iran | | 4 | BATTLEGROUND | +1 SCO | ENERGY | High |
| 3rd World | Central Asia | | 3 | SCO | +1 SCO | ENERGY | High |
| 3rd World | Afpak | | 3 | NATO | none | MINING | Med |
| 3rd World | Gulf States | | 5 | NATO | +1 NATO | ENERGY | Med |
| 3rd World | North Africa | | 3 | NATO | none | MINING | Med |
| 3rd World | South Africa | | 4 | NATO | none | MINING | Med |
| — | Tax Havens | | — | none | — | FIN | High |

★ marks the square that carries the R&D marker at start. The **major countries** (where shares are sold) are US, Eurozone, China, India, Japan, Russia and Brazil. Store `startingCamp` for these, because R-LOB-08 needs it. **Starting battlegrounds:** South America (America), Eastern Europe (Europe), South Sea (Asia) and Iran (3rd World).

### 2.2 Arrows (directed)

This list is **incomplete**. The full adjacency list is needed from a board photo [DATA]. Arrows I could see:

- Eurozone → United Kingdom → Canada
- Scandinavia ↔ Russia (an arrow exists; direction unclear)
- Gulf States → Iran → Central Asia
- Latin America → South America
- Japan → South Sea → Australia → United Kingdom (from the strategy tips)
- Tax Havens → every country (Tax Havens is the source only; nothing leads into it)

## 3. Setup

| ID | Step |
|---|---|
| R-SET-01 | Set the sliders: Growth 2% (idx 4), Interest $20 (idx 0), Stress +1, Balance of Power +3 NATO. With ⚑ THREE_ROUNDS, Balance of Power starts at +2 NATO instead. |
| R-SET-02 | Executives per player: 2 players → 4, 3 players → 3, 4 players → 2. In a 4-player game, Old Money gets 1 extra. [AMBIG-3: Old Money's bonus in 2p and 3p games] |
| R-SET-03 | Place the R&D marker on the United States ENERGY square. With ⚑ ACCUM_RD, skip this step: the marker does not exist. |
| R-SET-04 | Draw 4 random Outlook cards out of 10 and shuffle them into the Outlook pile. The other 6 are out of the game. With ⚑ THREE_ROUNDS, draw 3 [AMBIG-4]. |
| R-SET-05 | Shuffle the 25 payoff cards into a face-down deck. The discard pile starts empty. |
| R-SET-06 | Lock the 3 bottom-most India squares (TECH, MINING, HEAVY) and the 2 bottom-most China squares (FIN, ENERGY). |
| R-SET-07 | Set the investment bank to the full counts from §1.3. |
| R-SET-08 | Assign corporations, either at random (default) or by the Advanced Setup auction. In the auction, the highest bidder for a corporation starts with that much less cash [AMBIG-5: auction procedure]. In 2p and 3p games, only some corporations are used [AMBIG-6: what happens to Big Brother and Giant Squid duties when those corporations are absent]. |
| R-SET-09 | Set seat and turn order from the corporations' fixed order: Fortress Derivatives first, Old Money last. Clockwise play follows this order. |
| R-SET-10 | Apply each corporation's own setup: starting shares, pre-placed cubes and cash [DATA §12]. Pre-placed cubes occupy squares. |

## 4. Turn structure and Phase 1: Global Outlook

### 4.1 Turn loop

- **R-TURN-01:** A turn runs phases 1 Outlook → 2 Investment → 3 Competition → 4 Lobbying → 5 Earnings, then the next turn starts.
- **R-TURN-02:** At the end of every phase, all executives return to their owners' pools. Executives parked in Tax Havens or killed executives return too.
- **R-TURN-03:** The game ends at the start of phase 1 if the Outlook pile is empty. By default this means after turn 4, or after turn 3 with ⚑ THREE_ROUNDS.

### 4.2 Phase 1 rules

- **R-OUT-01:** If the Outlook pile is empty, go to End of Game (§10).
- **R-OUT-02:** The Big Brother player draws the top Outlook card and applies its effects in the printed order. Big Brother makes every choice the card requires. The card then leaves the game. ⚑ FACTION_TWEAKS: Big Brother may once per game replace this draw (see §11).
- **R-OUT-03:** Reveal N payoff cards, where N comes from the Growth slider *after* the Outlook effects. Group the revealed cards by industry. If the deck runs out while revealing, shuffle the discard pile into a new deck and keep drawing. Reshuffle only when a draw is impossible.

### 4.3 Outlook effect primitives

Build these as a small effect DSL. The 10 cards [DATA §12] are then just data.

| Primitive | Semantics |
|---|---|
| `moveSlider(slider, ±n)` | Move the slider, clamped at the track ends. |
| `unlockSquare(country, k=1)` | Remove k lock cubes in that country. Big Brother picks which. |
| `lockSquare(country, k=1)` | Lock an empty square if one exists. Otherwise remove a player cube (it returns to supply; the owner keeps the share) and lock that square. Big Brother picks the square. With ⚑ ACCUM_RD, fortified squares are immune. |
| `flipAffiliation(filter → camp)` | Big Brother picks one country matching the filter (for example a minor 3rd World country that is NATO) and sets its affiliation to the target camp. [AMBIG-7: does flipping a major this way wipe cubes and shares as in R-LOB-08?] |
| `campGainsPower(country)` | Move Balance of Power 1 step toward the country's current camp. Do nothing if the country is a battleground. |

**Worked example (from the rulebook):** the card "India Emerging as Global Power" does the following in order. Unlock 1 India square, Growth +4, Interest +4 (tighter), Stress +1, flip a NATO minor in the 3rd World to SCO, then India's camp gains 1 power. Starting from the setup values, the result is Growth 6%, Interest $16, Stress +2 and Balance of Power +2 NATO, and 9 payoffs are revealed.

## 5. Phase 2: Investment

**Loop:** starting with the first player and going clockwise, each player with an executive in their pool places one executive to take one action: **Public Auction**, **Private Sale** or **Pass**. Players with an empty pool are skipped. The phase ends when every pool is empty. Loans may be taken at any time during this phase (§6).

### 5.1 Public Auction (buy from the bank, then a reverse auction to sell to the bank)

- **R-INV-01:** The active player places an executive on a major country whose bank stock is at least 1. If the stock is 0, this action is illegal for that country.
- **R-INV-02 (buy):** The initiator opens with any bid of $3 or more. Bidding then goes clockwise. Each player either raises (strictly higher) or passes, and a player who passes is out. The auction ends when all but one player have passed. The initiator is included in later bidding rounds.
- **R-INV-03:** The winner must pay. If they don't have enough cash, they are forced to take as many loans as needed (§6). A bid can never be withdrawn. Bids are not capped by a player's cash.
- **R-INV-04 (placement):** The winner takes 1 share from the bank and places 1 cube in that country, choosing in this order: (a) any empty, unlocked square; (b) if there is none, replace any opponent's cube, which returns to its owner's supply; (c) if every square is already the winner's, place nothing. ⚑ FREE_CUBES grants extra cubes here and may allow an attack. ⚑ ACCUM_RD makes fortified squares off-limits.
- **R-INV-05 (reverse auction):** the starting value is the final buy price. Any player except the buyer who owns at least 1 share of that country may lower the price, going clockwise from the buyer [AMBIG-8: start seat]. Each lowering is strictly lower, and a player who passes is out. If nobody lowers, nothing is sold. Otherwise the last player still lowering sells 1 share to the bank at their bid: they receive that cash, the share returns to the bank, and they remove 1 of their own cubes in that country (their choice; nothing if they have none).
- **R-INV-06:** Only one share is sold per reverse auction.

**Worked example:** Green opens the US auction at $3. The bids go 4, 7, 11 … and Green wins at $22. Green pays $22 and places a cube. In the reverse auction Blue bids $21, Red $20, Blue $19, and then Red passes. Blue sells a US share for $19 and removes one Blue cube from the US.

### 5.2 Private Sale (at Tax Havens)

- **R-INV-07:** The active player places an executive on Tax Havens, chooses one of their own shares from any country, and announces a minimum price.
- **R-INV-08:** The other players bid clockwise. The first bid must be at least the minimum, and every later bid must be strictly higher. A player who passes is out. The seller does not bid.
- **R-INV-09:** If nobody bids, the action is consumed with no effect. Otherwise the highest bidder pays the seller (with forced loans if needed), takes the share, and replaces 1 of the seller's cubes in that country with their own. If the seller has no cube there, no cube is replaced. No reverse auction follows a private sale.
- ⚑ R3_SALES_MODE: private sales may be disabled in the final round (§11).

### 5.3 Pass

- **R-INV-10:** Place an executive on Tax Havens with no effect. A player who passes can still act later with their remaining executives.

### 5.4 Variant hooks

- ⚑ FREE_CUBES: the buyer gains cubes and the seller loses cubes (§11). Whenever a buy and a sell happen in the same auction, the seller loses cubes first.
- ⚑ CLOSED_AUCTION_SCO: auctions for countries currently affiliated with SCO use sealed bids (§11).

## 6. Loans (Corporate Bonds)

| ID | Rule |
|---|---|
| R-LOAN-01 | **When:** loans can be taken voluntarily at any point during phases 2 and 3. They are also forced whenever a payment exceeds cash (R-INV-03, the Expand $1, and the ⚑ DONT_STALL surcharge). |
| R-LOAN-02 | **Proceeds:** `interestValue − existingBonds × $1`. ⚑ LESS_CRUEL_LOANS drops the penalty, so the proceeds are just `interestValue`. [AMBIG-9: whether proceeds have a floor, and whether the 25 physical bonds cap the number of loans] |
| R-LOAN-03 | **Interest:** at the end of the Earnings phase, each player pays $1 per bond. If they can't cover it, they pay all their cash, drop to $0 (bailout), and keep all their bonds. |
| R-LOAN-04 | **Repayment:** only happens at the end of the Earnings phase, after interest is paid. Each bond costs the current `interestValue`, with no credit penalty, and must be paid from cash on hand. All players decide simultaneously, except that Big Brother may decide after seeing the others' choices. |
| R-LOAN-05 | **End of game:** each unpaid bond costs $20 (⚑ LESS_CRUEL_LOANS: the current `interestValue` instead). This is the only way cash can go negative. |

**Worked example:** with rates at $17 and 3 bonds outstanding, a new loan yields $14. If rates later fall to $12, each bond can be repaid for $12 after paying its $1 interest.

**UI note:** the cash needed for a forced loan must be computed before the payment and shown to the player. The loan count shown to others is public; the cash total is not.

## 7. Phase 3: Competition

**Terms:** an **occupying** cube sits on a square. A **loose** cube is in a country but not on a square. Only loose cubes can attack or move.

- **R-COMP-01 (income):** at the start of the phase, each player adds 1 loose cube per share they own to that share's country. Cubes come from supply. If the supply runs short, the player places as many as they can and chooses which countries get them [AMBIG-10]. Loose cubes already in Tax Havens (from last turn's Lobbying) remain there.
- **R-COMP-02 (loop):** starting with the first player and going clockwise, each active player takes one action: **Fight**, **Defend**, **Expand** or **Pass**. A player can take any number of actions across laps. **Pass** is final: the player is out for the rest of the phase. The phase ends when every player has passed.

### 7.1 Fight

- **R-COMP-03:** A Fight is up to 2 attacks. The two attacks can be in different countries. Attacks are never allowed in Tax Havens, apart from grabbing its FIN square.
- **R-COMP-04 (grab):** move 1 of your loose cubes onto an empty, unlocked square in the same country.
- **R-COMP-05 (kill):** remove 1 of your loose cubes and 1 target in the same country. The target can be an opponent's loose cube or a defending executive at any time. It can be an opponent's occupying cube only if that opponent has no loose cubes **and** no defending executives in that country. A removed cube returns to supply. A killed executive goes to Tax Havens and stays inactive until the phase ends.
- **R-COMP-06:** The second attack may use the result of the first. For example, the first attack kills an occupying cube and the second grabs the square it freed.

### 7.2 Defend

- **R-COMP-07:** Place 1 executive from your pool in any country. It counts as a protecting loose cube for R-COMP-05 only: it cannot attack, move or occupy. Several executives may defend the same country.

### 7.3 Expand

- **R-COMP-08:** Pay $1 (a forced loan is allowed) to make 2 movements: either one loose cube moves twice, or two loose cubes move once each.
- **R-COMP-09 (legal move A → B):** there must be an arrow from A to B in that direction, and one of these must hold: (a) A and B have the same affiliation (NATO→NATO or SCO→SCO); (b) B is a battleground and A is NATO or SCO; (c) A is Tax Havens, in which case B can be any country. A cube can never leave a battleground, and no move can enter Tax Havens. Occupying cubes never move.
- **R-COMP-10:** Expand never occupies a square. Taking a square requires Fight.

### 7.4 Pass and cleanup

- **R-COMP-11 (Pass):** all executives still in your pool are placed as defenders, and you choose where each one goes. You then take no further actions this phase.
- **R-COMP-12 (cleanup):** when the phase ends, remove every loose cube on the whole board, including Tax Havens, and return them to supply. All executives return to their pools.

### 7.5 Variant hooks

- ⚑ DONT_STALL: each action must use 2 cubes, or 1 cube only if it is your last. When every other player has passed, each of your actions costs an extra $1 (§11).
- ⚑ ACCUM_RD: fortified squares cannot be killed or taken.
- ⚑ FREE_CUBES: attacks made during the Investment phase use these same rules.

## 8. Phase 4: Lobbying

- **R-LOB-01 (loop):** starting with the first player and going clockwise, each player places 1 executive on an available event and resolves it immediately. Placement continues until every pool is empty. There is no pass; Tax Havens is always available.
- **R-LOB-02 (availability):** each event can be used once per turn, with two exceptions. **Tax Havens** is unlimited. **Power Play** can be used once per zone (up to 4 times), and only in zones that still have a battleground marker.

### 8.1 Power Play (zone Z → the battleground country C in that zone)

- **R-LOB-03:** The player picks a camp to support, S, and rolls a d6. The modified roll is `roll + BoP(toward S) + localBonus(C)`. The local bonus is added if it favours S and subtracted otherwise.
- **R-LOB-04:** The camp S wins if the modified roll is at least C's stability. A natural 1 always fails and a natural 6 always wins. If S fails, nothing happens.
- **R-LOB-05 (minor country won):** the player replaces whatever cube is on C's square with their own; if the square is empty, they simply place one. C becomes S. The player then moves the battleground marker to another country in Z that belongs to the losing camp. A major country may be chosen only if no minor country in Z belongs to the losing camp.
- **R-LOB-06 (zone resolved):** if no country in Z belongs to the losing camp, remove Z's marker from the game and move Balance of Power 1 step toward S. The rulebook states this for the 3rd World (which has no majors), but it is applied here in every zone [AMBIG-11]. From then on, Power Plays in Z are unavailable.
- **R-LOB-07 (major country, starting camp wins):** move the marker to a minor country in Z [AMBIG-12: whose camp]. Nothing else changes.
- **R-LOB-08 (major country, starting camp loses):** remove every player's cubes in C, discard every share of C from the game [AMBIG-13: including the bank stock?], move Balance of Power 1 step away from the losing camp, switch C to the other camp, and remove Z's marker from the game.
- **R-LOB-09:** The US always wins for NATO and China always wins for SCO, with no roll.

**Worked example:** Balance of Power is +2 NATO and Eastern Europe (stability 4) has +1 SCO. Supporting NATO gives a net +1, so a roll of 3 or more wins. Supporting SCO gives a net −1, so it needs a 5 or more. After a NATO win, the only country left in Europe belonging to SCO is Russia, so the marker moves to Russia.

### 8.2 Other events

| ID | Event | Effect |
|---|---|---|
| R-LOB-10 | Tax Havens | Place 1 cube from supply as a loose cube in Tax Havens. In the next Competition it can Expand to any country or grab the Tax Havens FIN square, where it can never be attacked. |
| R-LOB-11 | Central Banks | Move Interest **or** Stress by 2 in either direction, clamped at the track ends [AMBIG-14: exactly 2 or up to 2]. |
| R-LOB-12 | Budget | **Austerity:** Growth −1, and discard 1 revealed payoff card of your choice. **Stimulus:** Growth +1, and reveal 1 more payoff card. ⚑ FACTION_TWEAKS: for Stimulus, draw 2, keep 1 and discard the other. |
| R-LOB-13 | R&D | Move the R&D marker to any industry square in a stability-5 country. That square counts as 2 squares for Earnings and End-game scoring. ⚑ ACCUM_RD replaces this event entirely (§11). |
| R-LOB-14 | Subsidies | Look at the top 3 cards of the payoff deck. Swap 1 of them with 1 revealed payoff card. Discard the replaced card and the other 2 you looked at. |

## 9. Phase 5: Earnings

The steps run in this order: crisis check, payoff, interest, repayment.

### 9.1 Crisis

- **R-EARN-01:** Compute `difficulty = growth% + stress`, using the Growth percentage (not the slider index). The Giant Squid player rolls a d12. If `roll ≥ difficulty`, there is no crisis.
- **R-EARN-02:** Otherwise the crisis has `intensity = difficulty − roll`. Move Growth left by the intensity, and move Interest left by the intensity (money gets cheaper). Discard as many revealed payoff cards as the intensity. The Giant Squid player picks which ones; if Giant Squid is not in the game, pick at random. Then reset Stress to 0.
- **R-EARN-03:** Stress is reset only when a crisis happens. Growth changes caused by a crisis do not reveal or remove any further cards this turn.
- ⚑ FACTION_TWEAKS: Giant Squid has a once-per-game reroll or a "no crisis" declaration (§11).

**Worked example:** Growth 5% plus Stress +1 gives a difficulty of 6. A roll of 4 gives intensity 2: discard 2 payoff cards, move Growth and Interest 2 steps left, and set Stress to 0.

### 9.2 Payoff

- **R-EARN-04:** Resolve one industry at a time, in the order FIN, TECH, HEAVY, ENERGY, MINING. Let `k` be the number of revealed cards of that industry. Each player earns `k × squares`, where the R&D square counts 2 and each ⚑ ACCUM_RD fortified square counts 2. The Tax Havens FIN square counts as a normal FIN square.
- **R-EARN-05 (Market Leader):** the leader is the single player with strictly the most squares in an industry (counting as in R-EARN-04). If several players tie for most, nobody is leader. The leader gets +$2 (+$1 in a 2-player game), but only if `k ≥ 1`.
- **R-EARN-06:** After resolving an industry, discard its revealed cards to the payoff discard pile.

### 9.3 Bonds

- **R-EARN-07:** Pay interest (R-LOAN-03), then allow repayment (R-LOAN-04). Big Brother decides after the other players.
- ⚑ QE_HYPERINFLATION: see §11.

After repayment, return all executives and go to the next turn's phase 1.

## 10. End of Game

End-game scoring runs when phase 1 finds the Outlook pile empty (R-OUT-01). The last turn's Earnings phase, including repayment, is already complete at that point.

- **R-END-01:** For each industry, in the order FIN, TECH, HEAVY, ENERGY, MINING, each player earns $5 per square. Squares are counted as in R-EARN-04, so R&D and fortified squares count 2.
- **R-END-02:** The market leader in each industry gets +$10 (+$5 in a 2-player game). Ties mean no leader [AMBIG-15: the rulebook doesn't state the tie rule for end-game scoring; this assumes it matches Earnings].
- **R-END-03:** Each unpaid bond costs $20 (⚑ LESS_CRUEL_LOANS: the current `interestValue` instead). Cash may end up negative.
- **R-END-04:** The player with the most cash wins. There is no tiebreaker; tied players share the win (a draw).

**Worked example:** in FIN, Green has 4 squares and is leader, so Green scores 4 × $5 + $10 = $30. Blue has 2 squares and scores $10. Red has 3 and scores $15.

## 11. Variant toggles (10th Anniversary)

The ratings are the designer's own, given as Recommendation / Playtested / Impact on a scale of 10. The designer strongly advises enabling THREE_ROUNDS and FREE_CUBES together, so the lobby could offer a "Designer's Recommended" preset that turns both on.

| Flag | Ratings | Rules |
|---|---|---|
| `THREE_ROUNDS` | ∞ / 10 / 10 | The game lasts 3 rounds: deal 3 Outlook cards (R-SET-04). Balance of Power starts at +2 NATO. |
| `FREE_CUBES` | 11 / 5 / 20 | **Buying** a share in round r gives r−1 free cubes, placed loose in that country. The buyer may then make one attack under Competition rules: grab empty squares, or with 2 cubes kill-and-enter. Normal defence rules apply. **Selling** a share in round 2 or 3 (by any method) requires losing r−1 of your cubes from that country and/or Tax Havens; if you can't, the sale is illegal. When a buy and a sell happen in the same auction, the seller loses cubes first. [AMBIG-16: whether leftover free cubes persist into phase 3; how r−1 applies in a 4-round game] |
| `R3_SALES_MODE` | 6 / 1 / 0 | An enum with three values. `normal` keeps base selling. `reverseOnly` disables private sales in round 3, so selling happens only through the reverse auction (the cube loss still applies); in addition, the Investment phase ends as soon as the bank runs out of shares. `banned` forbids all selling in round 3. There is a sub-option to cut round-3 free cubes to 1, which the designer does not recommend. |
| `DONT_STALL` | 10 / 9 / 2 | Each Fight or Expand action must use 2 cubes, unless the player has only 1 left. When every other player has passed, each action the last player takes costs +$1. |
| `LESS_CRUEL_LOANS` | 8 / 10 / 5 | New loans carry no −$1-per-existing-bond penalty. At the end of the game, bonds cost the current `interestValue` instead of $20. |
| `ACCUM_RD` | 9 / 2 / 2 | The R&D marker is removed. The R&D event now means: place 1 extra cube from supply on a square you occupy in a stability-5 country. That square is **fortified**: it counts double, and nothing can remove or flip it (attacks, power plays or events). Each square can be fortified at most once. |
| `CLOSED_AUCTION_SCO` | 5 / 10 / 2 | For countries that are currently SCO, every player secretly commits cash (loans may be taken beforehand, publicly). The bids are revealed together and the highest wins. On a tie, the initiator picks the winner. There is no reverse bidding: only the initiator may sell a share, at the buying price. For NATO countries, the base open auction is used, and the initiator gets +$1 from the bank if they end up buying or selling. [AMBIG-17: does a player have to bid? Can a bid exceed cash?] |
| `QE_HYPERINFLATION` | 5 / 0 / 2 | When the Interest slider is at an end and an effect would push it further past that end: at the $20 end, each player loses $1 per bond; at the other end, each gains $1 per bond. The source text says "$10" for the far end, but the track ends at $11 [AMBIG-18]. |
| `FACTION_TWEAKS` | 8 / 1 / 3 | A set of once-per-game abilities and small changes, listed below. |

**FACTION_TWEAKS details**

- **Giant Squid:** once per game, after the crisis die is rolled, either reroll it (intensity capped at 3) or declare "no crisis". If no crisis happened all game, loan repayments in the final round and at the end of the game are reduced by $2 [AMBIG-19: per bond or in total?].
- **Big Brother:** Big Brother may take any square unlocked by an event, for free. Once per game, instead of the normal Outlook draw, discard that card, draw 2 random cards from those out of the game, and play 1 of them.
- **Old Money:** once per game, act first in Lobbying. That first action must be a Power Play.
- **Fortress Derivatives:** once per game in Lobbying, FD's last executive may act after everyone else. It is then not blocked by other players' executives, so it can use an event that someone else already took. It is still blocked by FD's own executives.
- **Budget event:** Stimulus draws 2 payoff cards, keeps 1 and discards the other.

## 12. Data slots `[DATA]`

### 12.1 Corporation cards

The card images show a separate setup block for each player count (2p, 3p and 4p), each listing Investments, Assets, Cash and Position, plus one Special Ability. Proposed schema:

```
Corporation {
  id, name, colour, turnOrder,
  setup: { "2p"|"3p"|"4p": { shares: {country: n}, cubes: [{country, industry}], cash, position } },
  specialAbility: { name, text, hooks[] }   // for example a hook such as "payoffDiscardChoice"
}
```

| Corporation | Colour | Order | Known role | Setup and ability |
|---|---|---|---|---|
| Fortress Derivatives | green | 1 | first player | ability "High-Frequency Trading": text TBD; setup TBD |
| Giant Squid | blue | ? | rolls the crisis die and chooses crisis discards | TBD |
| Big Brother | red | ? | draws Outlook cards, makes Outlook choices, makes lock/unlock choices, decides repayment last | TBD |
| Old Money | yellow? | last | +1 executive in a 4-player game | TBD |

### 12.2 Outlook cards (10)

Proposed schema: `OutlookCard { id, name, effects: Effect[] }`, where each Effect is one of the §4.3 primitives. Only 1 card is fully known:

| Card | Effects |
|---|---|
| India Emerging as Global Power | unlockSquare(India) · moveSlider(growth, +4) · moveSlider(interest, +4 tighter) · moveSlider(stress, +1) · flipAffiliation(3rd World minor, NATO → SCO) · campGainsPower(India) |
| Asia Infrastructure Bank | TBD (the name is visible in an image) |
| De-Dollarization | TBD (the name is visible in an image) |
| 7 × unknown | TBD |

If any card needs an effect the primitives can't express, add a new primitive rather than special-casing the card.

## 13. Open questions and assumed defaults

Each default below is what the code should do until the question is answered. Keep every one configurable where that's cheap.

| # | Question | Assumed default |
|---|---|---|
| 1 | Does the Growth track have a 0% position? | No: the track is −3, −2, −1, 1 … 7. |
| 2 | What do the Balance of Power end-caps (eagle, dragon) mean? | They are ±4 and give a ±4 modifier. |
| 3 | Does Old Money get a bonus executive in 2p and 3p games? | No, only in 4p. |
| 4 | How many Outlook cards with THREE_ROUNDS? | 3. |
| 5 | How does the Advanced Setup corporation auction work? | Not implemented in v1; assignment is random only. |
| 6 | Who does Big Brother's and Giant Squid's jobs when those corporations are absent? | Outlook choices go to the first player; the system rolls the dice; crisis discards are random. |
| 7 | Does an Outlook flip of a major country wipe cubes and shares? | No; only Power Plays wipe. |
| 8 | Where does the reverse auction start? | The seat clockwise after the buyer. |
| 9 | Do loan proceeds have a floor, and is the loan count capped? | Proceeds never go below $1; at most 25 bonds exist in total. |
| 10 | Who chooses where to place cubes when the supply runs short? | The owning player. |
| 11 | Does zone resolution apply outside the 3rd World? | Yes, whenever the losing camp has no countries left in the zone. |
| 12 | After a major country's starting camp wins, which camp's minor gets the marker? | A minor of the losing camp; if there is none, remove the marker. |
| 13 | When a major flips, are the bank's shares for it discarded too? | Yes; the country can no longer be auctioned. |
| 14 | Do Central Banks move by exactly 2 or up to 2? | Exactly 2, clamped at the ends. |
| 15 | Who leads on a tie in end-game scoring? | Nobody. |
| 16 | Do FREE_CUBES leftovers persist? Does FREE_CUBES work with 4 rounds? | Leftover cubes stay loose until the Competition cleanup. FREE_CUBES requires THREE_ROUNDS. |
| 17 | In a closed auction, is a bid capped by cash, and must players bid? | A bid can't exceed cash plus loans taken before the reveal; a $0 bid counts as a pass. |
| 18 | Where is the far end of the Interest track for QE_HYPERINFLATION? | $11. |
| 19 | Is Giant Squid's $2 reduction per bond or in total? | Per bond. |
| 20 | What does DONT_STALL's "use 2 cubes" mean? | A Fight must make 2 attacks and an Expand must make 2 movements, unless only 1 cube is available. |
| 21 | Is the Subsidies swap mandatory? | Yes; the player picks 1 of the 3. |
| 22 | In a private sale, may the first bid equal the minimum? | Yes (bid ≥ minimum). |
| 23 | Can Big Brother see the top Outlook card at any time? | Yes; the rulebook implies it when explaining the repayment timing. |
| 24 | What if all 10 lock cubes are in use? | No cap in code. |
| 25 | Missing data: full arrow list, Low-confidence countries, corporation cards, Outlook cards. | Placeholders, see §2 and §12. |

## 14. Implementation work chunks

**Suggested shape:** a pure rules engine, `apply(state, action) → {state, events}`, plus `legalActions(state, player)` for each phase and a seeded RNG so games can be replayed. All pending choices, such as Big Brother picks, reverse-auction turns and forced-loan confirmations, are modelled as explicit prompts. Every worked example in this doc becomes a unit test.

| # | Chunk | Covers | Acceptance checks |
|---|---|---|---|
| C1 | State model and board data | §1, §2 | The board JSON loads; every arrow endpoint exists; the slider tables round-trip; 30 shares total. |
| C2 | Setup and phase machine | §3, R-TURN | A 4-player setup matches R-SET; with every player passing, the game ends after 4 turns (3 with THREE_ROUNDS); executives return after each phase. |
| C3 | Outlook and effect DSL | §4 | The India card from setup gives Growth 6%, $16, Stress +2, BoP +2 NATO and 9 payoffs revealed; a reshuffle happens only when the deck is empty. |
| C4 | Loans | §6 | $17 with 3 bonds gives $14; forced loans cover any shortfall; the interest bailout sets cash to $0. |
| C5 | Investment | §5 | The US auction example ($22 buy, then Blue sells for $19); both private-sale examples; the replacement cube rule when a country is full; the phase ends when pools are empty. |
| C6 | Competition | §7 | Occupying cubes can't be killed while loose cubes or defenders protect them; kill-then-grab in one Fight; NATO→SCO move rejected; moving out of a battleground rejected; Tax Havens→anywhere allowed; cleanup empties all loose cubes. |
| C7 | Lobbying | §8 | The Eastern Europe example (a 3 wins for NATO, the marker moves to Russia); a major flip wipes cubes and shares and moves BoP; the US and China auto-win; the event-uniqueness rules hold. |
| C8 | Earnings | §9 | The crisis example (difficulty 6, roll 4, intensity 2); the payoff example (Heavy 2 cards: 2 sq → $4, 3 → $6, 4 → $8 + $2 leader); R&D counts double; a tie gives no leader. |
| C9 | End game | §10 | The FIN example ($30 / $10 / $15); −$20 per bond; draws are supported. |
| C10 | Hidden info | cross-cutting | Each player's view hides opponents' cash; Big Brother alone sees the top Outlook card; closed-auction bids stay sealed until the reveal. |
| C11 | Variants | §11 | One test file per flag; the "Designer's Recommended" preset enables THREE_ROUNDS and FREE_CUBES. |

**Blocked on data:** C1 needs the arrow list, C2 needs the corporation setups, and C3 needs the full text of the Outlook cards. Stub these so C4–C9 can proceed.
