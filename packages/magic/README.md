# @game-platform/magic

**Magic: The Gathering**, base set: two players, each with one of five
preconstructed 40-card decks (one per colour) built from cards of the
original base set (Alpha/Beta/Unlimited/Revised). Played under the modern
rules: the stack and priority, instants in response, combat with first
strike, trample, flying, protection and landwalk, state-based actions, the
London mulligan.

**Commander** is an option at room creation (RULES.md §10): two 100-card
singleton decks, each led by a legendary commander from Legends that waits
in the command zone, with the commander tax, the trip back to the command
zone, and 21 commander damage — one on one, at 40 life. The Commander
decks add simple cards from later sets (Sol Ring, Earthquake, Overrun, …);
a base-set game never sees them.

`RULES.md` is the spec. Every rule has an id cited by code comments and test
names, and every deliberate simplification of the real rules is an
`AMBIG-n`. The main ones:
- priority with an empty stack is only offered where it matters (AMBIG-2);
- a caster passes priority along with the spell (AMBIG-3);
- a player with nothing public they could do passes automatically (AMBIG-4);
- Hypnotic Specter's trigger resolves at once (AMBIG-5);
- combat damage is assigned automatically (AMBIG-6);
- Commander is one on one (AMBIG-9), and a commander always returns to the
  command zone (AMBIG-10).

## Layout

| File | What it is |
| --- | --- |
| `src/types.ts` | `GameData`, cards, permanents, the stack, actions. |
| `src/cards.ts` | The card pool (`CARDS`) as data — costs, types, keywords, effects, abilities — and the decks (`DECKS`, and the Commander decks `COMMANDER_DECKS`). |
| `src/mana.ts` | Mana pools, mana sources and automatic cost payment (a matching of coloured symbols to sources). |
| `src/engine.ts` | The game: characteristics, targeting, casting, the stack, combat, state-based actions, the turn — and Commander's few hooks, all behind `game.format === 'commander'`. |
| `src/rules.ts` | The `GameDefinition`: setup, one action at a time, redaction, narration. |
| `src/view/`, `src/GameView.tsx` | The React table: deck choice, mulligans, click a card to play it, click a target, click creatures to attack and block. |
| `src/testing.ts` | `newGame`, `startedGame`, `commanderGame`, `blankBoard` + `arrange`/`put`/`give` for scenarios, and `simplestMove`, a simple bot. |

## Adding a card

A card is data in `src/cards.ts`. If everything it does is already an
`Effect`, `StaticAbility`, `Keyword`, aura or activated ability the engine
knows, adding it is one entry (and a place in a deck). A new kind of effect
goes into `Effect` (`src/types.ts`) and `runEffect` (`src/engine.ts`).
Anything a pool card does must be modelled completely: a card whose text
the engine can't honour stays out of the pool. Changing a deck's list, or a
card an existing deck holds, changes genesis or legality, so it needs a new
`rulesVersion` (see `packages/unique-pick/README.md`, "Changing the
rules"). Adding a card no existing deck can reach doesn't — that's how the
Commander decks shipped: everything about them sits behind the `commander`
option, which a standard game's options don't even carry.

## Hidden information

Hands and libraries are secret from the opponent; a deck choice is secret
until both have chosen. Libraries are unordered: each draw takes a random
card from what's left (RULES.md AMBIG-1). No order is stored for anyone to
see, and every draw records its own random numbers, which a redacted viewer
never receives. `isActionSecret` hides the two actions that name hidden cards:
a keep that puts cards on the bottom, and a deck choice while the opponent
is still choosing.
