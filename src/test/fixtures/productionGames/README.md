# Recorded game fixtures

Drop a game export into this directory and it becomes a test. No registration
step, no code change: `src/test/__tests__/productionGames.test.ts` globs this
folder, and every export it finds is replayed action by action through the
real `apply-action`/`undo-action`/`redo-action` Edge Functions (or, for a
client-trusted game, through direct `game_state` writes) against a Supabase
stack that behaves like production (`src/test/supabaseStack/`). The same
fixtures drive the live smoke test (`../../productionSmoke/`) and the preview
seeder (`../../previewSeed/`).

## Adding a game

1. Open the game and use **Copy game export** (GamePage.tsx) — or the saved
   `.json` file that button's download produces.
2. Save it here as `<something-descriptive>.json`, unchanged. The file is the
   app's own export format (`src/lib/gameStateExport.ts`,
   `src/lib/gameStateExport.schema.json`): a small JSON object whose
   `gameStateZipped` field holds the gzipped `GameState`.
3. Add a `<something-descriptive>.room.json` sidecar declaring the result (see
   below), and say so there if the game was played client-trusted.
4. Run `npm run test`. The new game shows up as its own suite, named after the
   file.

Pick games worth regression-testing: a finished game, a game that hit a bug,
a game with undo/redo, a concede or admin mode in its history, a hotseat game,
a game played with hidden information. Long games are fine — a few hundred
actions replay in seconds.

**A game that drew random numbers doesn't fit this yet.** Replaying through
`apply-action` makes the server draw each move's numbers afresh from the new
room's own seed (`game_secrets`), and an export never carries the original
game's seed — it's server-only on purpose — so the dice come out differently
and the replay diverges. Setup draws are fine (they travel on the state as
`setupRandom`); move draws (`LoggedAction.random`) aren't. Unique Pick draws
nothing and Rise & Fall draws only at setup, so every fixture here is
unaffected; a game with chance needs its
own replay route before its exports can be dropped in.

## Declaring the result

State a game's outcome in its sidecar, from what you read off the end-of-game
screen, rather than leaving the test to derive it:

```json
{
  "expected": {
    "winners": ["Player A"],
    "finalScores": { "Player A": 12, "Player B": 9 }
  }
}
```

Players are named by display name or by engine player id. A rules change that
moved every game's outcome in step would still satisfy "the replay matches the
export" — both sides move together — but it cannot satisfy a result that came
from outside the code.

`finalScores` is optional, and is the one game-specific piece of this folder:
`gameScores.ts` says how to read a score off a `GameState` (for the example
game, `game.scores`). A game with no notion of a score returns `{}` there and
its sidecars declare `winners` only.

## Which write path a game is replayed on

The app has two, and a game is replayed on the one it was actually played on
(the same branch `GamePage.tsx`'s `submitAction` takes):

- **Rule-enforced** (`ruleEnforcementEnabled`, the default assumed here): each
  action goes to the `apply-action`/`undo-action`/`redo-action` Edge
  Functions, which re-derive the state server-side and write it compressed.
- **Client-trusted**: the client applies the action itself and writes
  `game_state` directly, under RLS and the version compare-and-swap.

A game played client-trusted says so in its sidecar:

```json
{ "settings": { "ruleEnforcementEnabled": false } }
```

Replaying a client-trusted game through the Edge Functions would be testing
it against checks it was never played under (per-seat authorization, the
owner-override check). The smoke test and the preview seeder skip such games
for the same reason.

## What gets asserted

For each game (`productionGames.test.ts`):

- Every logged action is accepted, submitted by the seat that actually made
  it. A rejection fails with that action's position in the history and the
  server's own message.
- `game_state.version` advances by exactly one per action.
- The state stored at the end matches the exported one — with `status` and
  `winnerPlayerIds` asserted separately so "the game ended differently" reads
  as its own failure.
- The declared winners and scores match, the replay scores what the export
  scores, and nobody who conceded is among the winners.
- The stored row is shaped the way that game's write path stores it (gzipped
  for an enforced game), and its `game_state_meta` projection matches.
- The game's first action is refused (403) when submitted by another seat or
  by a signed-in user with no seat, and a direct client `UPDATE` of
  `game_state` is refused by RLS for an enforced game and allowed for a
  client-trusted one (`0001_baseline.sql` section 7).

## What is inferred, and how to override it

An export carries the `GameState` only, so the `games`/`players` rows around it
are reconstructed from it (`reconstructRoom` in `loadFixtures.ts`): seats and
their auth users come from `state.players` (in seat order), the room's
`game_type` and pinned `settings.rulesVersion` from `state.gameType` /
`state.rulesVersion` (so a fixture can be of any game registered in
`src/games/registry.ts`, at any rules version still registered there), and the
settings genesis depends on — the game's options, `hiddenInformationEnabled` —
are carried on the state itself. `ruleEnforcementEnabled` defaults to on.

Every fixture verifies itself at load: the reconstructed genesis is replayed
through the engine and must reproduce the exported state exactly. If it can't,
the loader says so and names the fix — add or extend the sidecar:

```jsonc
// my-game.room.json  (sits beside my-game.json)
{
  "name": "A readable room name",
  "createdBy": "<auth user id of the room owner>",
  "admins": ["<auth user id>"],
  "settings": { "ruleEnforcementEnabled": false },
  "userIdByPlayerId": { "<engine player id>": "<auth user id>" },
  "expected": { "winners": ["<display name>"], "finalScores": { "<display name>": 12 } }
}
```

`admins` is the one to reach for if a replay is refused with *"Submitting this
action would discard another player's undone move"*: that action was made by
the room owner or a site admin with room admin mode on, so the replay needs to
know who that was. (The room owner is also treated as an admin by
`productionGames.test.ts`.)

## The checked-in games

Three of the games here are for the example game ("Unique Pick",
`@game-platform/unique-pick`)
and were generated by `generateExampleFixtures.ts`, not recorded from real
play — each one scripted move by move through the real engine, then encoded
with the app's own `encodeGameStateExport`, with realistic fixed timestamps:

| Fixture | Write path | What it covers |
| --- | --- | --- |
| `two-player-live-win` | client-trusted | a short live game played straight to the target score |
| `three-player-async-undo-concede` | rule-enforced | a changed pick, an undo + redo, an undo followed by a different move, a concede |
| `three-player-hidden-picks` | rule-enforced + hidden information | secret picks, a changed pick while the round is open, room admin mode on and off |

To regenerate them — after a rules change the load-time check reports, say —
run:

```bash
node scripts/generate-example-fixtures.mjs
```

That script loads `generateExampleFixtures.ts` through Vite and writes each
`<name>.json` and `<name>.room.json` here. Replacing the example game means
replacing these (and `gameScores.ts`); real exports of the new game can
simply be dropped in instead.

The fourth, `two-player-rise-and-fall-async-solo-map` (rule-enforced), is a
real Rise & Fall game from the game's standalone app — an async game with
undo and redo on a map one player built alone. It was converted once from
that app's export
(`packages/rise-and-fall/src/__tests__/fixtures/red-beats-blue-async.json`):
the log moved unchanged onto a platform genesis, minus the twelve entries the
old app logged for forced moves before it folded them into the triggering
action, with the player who built the map seated first so that "build
alone" by the host, with the builder's units placed last, sets it up exactly
as it was played — options with no setup draws, which a smoke run's fresh
room would roll differently. The replay matches the original game field for
field bar that seat order, and its declared result is the one the original
game recorded. Its display
names were already anonymized in the standalone app's repository.

The fifth, `three-player-rise-and-fall-saved-map` (rule-enforced), is another
real game from the standalone app, played on a board from that app's saved-map
pool. It was converted the same way, with the board as the room's saved map
(`games.assets.map`, `src/lib/roomAssets.ts`): the game starts from it and
skips tile placement, exactly as it did there. It replays to the original bar
the tiles' `placementId`s, which a saved map drops — they only matter while
tiles are being placed. A game's saved map travels on its state
(`GameState.assets`), and `loadFixtures.ts` puts it back on the rebuilt room,
so such a game is a drop-in like any other.

## Privacy

These files are committed to the repository. A real export contains display
names and auth user ids of everyone who played, plus the full game. Only add
games whose players are fine with that, and use a sidecar's
`userIdByPlayerId` to substitute placeholder ids if not.

Display names have no sidecar override — they're baked into the gzipped
`GameState` itself (`players[].displayName`), unlike auth ids. To anonymize
one, decode `gameStateZipped` (`decodeGameStateExport`), rewrite
`state.players[].displayName`, and re-encode with `encodeGameStateExport`
before committing, then update the sidecar's `name`/`expected` to match.

