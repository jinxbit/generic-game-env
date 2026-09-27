# @game-platform/unique-pick

The platform's example game, and the template for every other game package.
Every round each player secretly picks a number from 1 to 5 at the same time;
once everyone has picked, the picks are revealed and every player whose number
nobody else picked scores it. First to the target score wins (or the highest
score after the last round). It's deliberately tiny, but it exercises every
platform feature: simultaneous moves, secret information, changing a move
before the reveal, concede mid-round, game end with ties. The platform's own
tests play it as their fixture.

This package is laid out exactly like a standalone game repo, so copying it is
the quickest way to start a new game.

## Entry points

| Entry | File | What it is | Loaded by |
| --- | --- | --- | --- |
| `@game-platform/unique-pick/rules` | `src/rules.ts` | `gameDefinition` (the `GameDefinition` from `@game-platform/sdk`), the game's types, option helpers. Pure: no React, no I/O. | browser **and Edge Functions** |
| `@game-platform/unique-pick/view` | `src/view.ts` | `ui` (a `GameUi`: the game's React view, options editor and tagline). | browser only |
| `@game-platform/unique-pick/testing` | `src/testing.ts` | `newGame`, `pick`, `pickAll` for tests. | tests only |

The rules and view are separate entry points so the Edge Functions never load
React.

## The contract

`GameState` (`@game-platform/sdk`) is an envelope. The framework owns
`players`, `turnOrder`, `actionHistory`, `adminModeActive`, `playMode`,
`hiddenInformationEnabled`, `gameType`, `rulesVersion` and `options`; the game
owns `game`, and keeps these envelope fields accurate:

- `status` — `'active'` once `setup` returns, `'completed'` when the game ends.
- `pendingPlayerIds` — **everyone who may act right now**: `[activePlayerId]`
  in a sequential turn, several ids in a simultaneous phase, `[]` when nobody
  is owed a move. Turn notifications, "your turn" badges, the hotseat hand-off
  and admin mode all read it, so it must never be stale.
- `activePlayerId` — the single player whose turn it is, or null in a
  simultaneous phase.
- `turn` and `phase` — a turn/round counter and a short phase id, projected
  into the database for listing screens and notifications.
- `winnerPlayerIds` — set when the game ends (several on a tie).

`GameDefinition` fields and hooks:

- `id` — stable, lowercase letters/digits/dashes; stored on every room
  (`games.game_type`). Never change it once games exist.
- `rulesVersion` — bump it when a change would make an existing game's
  history replay differently (see "Changing the rules" below).
- `title`, `turnLabel`, `minPlayers`, `maxPlayers` — what the platform shows
  and enforces around the game.
- `defaultOptions`, `normalizeOptions(raw)`, `describeOptions(options)` — the
  game's creation-time options. `normalizeOptions` must accept anything (a
  stored row may be missing or out of range).
- `setup(lobby)` — build genesis from the seated players (`lobby.options` is
  already normalized).
- `applyAction(state, action)` — validate and apply one game action; reject
  anything illegal, including a player acting out of turn. Don't touch
  `actionHistory`.
- `onPlayerEliminated(state, playerId)` — after a CONCEDE; advance whatever the
  leaver's move was blocking.
- `nextForcedAction(state)` — a move with exactly one legal option, or null.
  The framework folds these into the triggering action's single log entry.
- `redactGame(state, viewerId)` / `isActionSecret(entry, state, viewerId)` —
  what's hidden from whom *right now*. They must agree, or the log leaks what
  the state hides.
- `describeAction(action, before, after)` — log narration (`{player}` is
  replaced with the actor's name); give secret actions a `redactedMessage`.
- `describePhase(phase)` — label for listing screens and notifications.

Every game action must carry `playerId: string`; the framework reserves the
action types `CONCEDE`, `UNDO_ACTION`, `REDO_ACTION`, `SET_ADMIN_MODE` and
`HIDDEN_ACTION`.

The view (`GameUi`, from `@game-platform/sdk/ui`) gets `state`, the seated
`players`, `myPlayerId` (null when read-only), `submitting`, and `onAction` to
submit a move — the platform routes it to the right write path and shows any
rejection.

## Rules every game must follow

1. **Deterministic.** Every hook is a pure function of its inputs: no
   `Math.random()`, no `Date.now()`, no module-level mutable state. The whole
   game is replayed from genesis on undo, on every server submission, when a
   client rebuilds state from a delta, and in tests. For randomness, draw
   from the game's own seed with `gameRandom` from `@game-platform/sdk` —
   see "Randomness" below.
2. **Server-safe rules.** Everything reachable from the `rules` entry runs in
   Supabase Edge Functions (Deno): no React, no JSON imports without
   `with { type: 'json' }`, and **every relative import carries an explicit
   `.ts` extension** — a missing one only fails at deploy time.
3. **Never mutate.** Return new objects; the framework keeps the old ones for
   undo, review and the log.
4. **One submitted action, one log entry.** Use `nextForcedAction` for
   follow-ups nobody needs to be asked about.

## Randomness

`setup`, `applyAction` and `onPlayerEliminated` receive a `random` argument
(`Random` from `@game-platform/sdk`: `next()`, `int(min, max)`,
`pick(items)`, `shuffle(items)`). It's the only randomness a rule may use:

```ts
setup(lobby, random) {
  const firstPlayerId = random.pick(lobby.turnOrder)
  // ...
}

applyAction(state, action, random) {
  const roll = random.int(1, 6)
  // ...
}
```

Every number a hook draws is recorded — on the move's log entry
(`LoggedAction.random`), or for `setup` on the state (`setupRandom`) — and
replay feeds the recorded numbers back instead of rolling again. So a replay
never needs the seed, and the rules must draw exactly the same numbers in the
same order every time they're given the same state and action.

Where fresh numbers come from is the platform's business: for a rule-enforced
game, a seed that never leaves the server, keyed by the move's position, so
undoing a move and making it again draws the same numbers. Two things follow
for a game:

- **What setup decides is public.** Every client carries `setupRandom` to
  rebuild genesis. Pick a first player or a board layout there, but don't
  shuffle a secret deck in `setup` — deal each secret card when it's dealt,
  with `random.pick` from what's left.
- **A secret draw needs a secret entry.** The numbers recorded on an entry
  reveal what was drawn, so when a draw decides something some player mustn't
  know yet (the card dealt into a hand), `isActionSecret` must say that entry
  is secret from them. Redaction then withholds the numbers with the action.

A room can also lock a move against undo once it has revealed something —
including random numbers a player has seen (see the platform README's "Undo
in a shared game"). That's judged with your `isActionSecret`, so keeping it
accurate matters here too.

## Changing the rules

A game in progress is replayed under the `rulesVersion` it started with. A
change that can't alter any existing game's history (new wording, a fix to an
unreachable branch) can ship as-is. A change that can — different scoring,
a new legality check — needs a new `rulesVersion`, and the old definition must
stay registered until no game uses it. The simplest way is to keep the old
version installed under an npm alias and register both in the platform's
`src/games/registry.ts`:

```jsonc
// platform package.json
"@you/my-game": "^2.0.0",
"@you/my-game-v1": "npm:@you/my-game@^1.0.0"
```

## Making a new game in its own repo

1. Copy this package into a new repo and rename it (`name` in `package.json`,
   `id`/`title` in `rules.ts`, `id` in `view.ts`).
2. Depend on `@game-platform/sdk` as a peer dependency, and publish the
   package (GitHub Packages works for private repos) — or install it straight
   from git.
3. Write the rules, view and options editor. Test the rules against the real
   framework with `@game-platform/sdk/testing` (`seatPlayers`, `act`) — see
   `src/__tests__/` here.
4. In the platform repo, add the package to the platform's `package.json`,
   register its rules in `src/games/registry.ts` and its UI in
   `src/games/ui.ts`, and map its `rules` entry in
   `supabase/functions/deno.json` (for a package in `node_modules`, e.g.
   `"@you/my-game/rules": "../../node_modules/@you/my-game/src/rules.ts"`).
   `src/test/__tests__/edgeFunctionImports.test.ts` fails if that mapping is
   missing.

No database migration is needed: the database stores `GameState` as opaque
JSON and only reads the envelope's `status`, `phase`, `turn`,
`pendingPlayerIds` and `activePlayerId`.
