# The game slot

Everything specific to the game being played lives in this folder. The rest
of the platform — rooms, lobby, accounts, undo/redo, history review, admin
mode, concede, server-side rule enforcement, hidden information, realtime
sync, notifications, chat, the test harness — only ever talks to it through
the files below. To build a different game, replace them.

The example here is **Unique Pick**: every round each player secretly picks a
number from 1 to 5 at the same time; once everyone has picked, the picks are
revealed and every player whose number nobody else picked scores it. First to
the target score wins (or the highest score after the last round). It's
deliberately tiny, but it exercises every platform feature: simultaneous
moves, secret information, changing a move before the reveal, concede
mid-round, game end with ties.

## Files

| File | What it is | Imported by |
| --- | --- | --- |
| `types.ts` | `GameData` (the game-specific slice of `GameState`, stored under `state.game`), `GameAction` (the game's actions — each must carry `playerId: string`), `GameOptions` (creation-time options). | engine, server, UI |
| `rules.ts` | `gameDefinition`, implementing `GameDefinition` (`../engine/gameDefinition.ts`). The rules. | engine (via `../engine/game.ts`), server |
| `display.ts` | `GAME_TITLE`, `GAME_TAGLINE`, `TURN_LABEL`, `describeGameOptions`, `describePhase` — the strings the platform's own screens and notifications show. | UI, notifications |
| `GameView.tsx` | The in-game view (`GameViewProps`). Rendered by `src/pages/GamePage.tsx`. | UI |
| `GameOptionsEditor.tsx` | The creation-time options form, shown on the create-game screen and in the lobby's config editor. | UI |
| `__tests__/` | Rules tests. The engine's own tests (`src/engine/__tests__/`) use this game as their fixture too. | — |

`index.html` and the PWA manifest in `vite.config.ts` carry their own copy of
the title — update them alongside `display.ts`.

## The contract

`GameState` (`../engine/types.ts`) is an envelope. The framework owns
`players`, `turnOrder`, `actionHistory`, `adminModeActive`, `playMode`,
`hiddenInformationEnabled`; the game owns `game` and `options`, and is
responsible for keeping these envelope fields accurate:

- `status` — `'active'` once `setup` returns, `'completed'` when the game ends.
- `pendingPlayerIds` — **everyone who may act right now**: `[activePlayerId]`
  in a sequential turn, several ids in a simultaneous phase, `[]` when
  nobody is owed a move. Turn notifications, "your turn" badges on every
  listing screen, the hotseat hand-off and admin mode all read this, so it
  must never be stale.
- `activePlayerId` — the single player whose turn it is, or null in a
  simultaneous phase.
- `turn` and `phase` — a turn/round counter and a short phase id. Both are
  projected into `game_state_meta` for listing screens and notifications;
  `display.ts` turns them into labels.
- `winnerPlayerIds` — set when the game ends (several on a tie).

`GameDefinition`'s hooks:

- `setup(lobby, options)` — build genesis from the seated players. Normalize
  `options` (a stored row may be missing or out of range) and store them on
  `state.options`.
- `applyAction(state, action)` — validate and apply one game action; reject
  anything illegal, including a player acting out of turn. The framework
  appends the log entry — don't touch `actionHistory`.
- `onPlayerEliminated(state, playerId)` — called after a CONCEDE, once the
  framework has removed the player from `turnOrder`/`pendingPlayerIds`
  (and ended the game itself if only one player is left). Advance whatever
  their pending move was blocking.
- `nextForcedAction(state)` — a move with exactly one legal option that
  nobody needs to be asked to make, or null. The framework dispatches these
  until none is left and folds them into the triggering action's single log
  entry.
- `redactGame(state, viewerId)` / `isActionSecret(entry, state, viewerId)` —
  what's hidden from whom *right now*. They must agree: anything masked in
  the state must also be masked in the log, or the log leaks it straight
  back out. Masking is always derived from the current state, so an undo can
  re-hide something — that's fine.
- `describeAction(action, before, after)` — narration for the game log;
  `{player}` is replaced with the actor's name. Give secret actions a
  `redactedMessage`.
- `describePhase(phase)` — label for listing screens.

## Rules every game must follow

1. **Deterministic.** Every hook is a pure function of its inputs: no
   `Math.random()`, no `Date.now()`, no module-level mutable state. The whole
   game is replayed from genesis on undo, on every server submission, when a
   client rebuilds state from a delta, and in tests — anything
   non-deterministic desyncs clients from the server. Randomness a game
   needs (a shuffled deck, a random first player) must be rolled once before
   genesis, persisted into `games.settings`, and read from there by `setup`
   (see `src/lib/gameGenesis.ts` and the `start-game` Edge Function).
2. **Pure data, no I/O.** `types.ts` and `rules.ts` (and anything they import)
   run inside Supabase Edge Functions: no React, no Supabase, no JSON imports
   without `with { type: 'json' }`, and **every relative import carries an
   explicit `.ts` extension** — the Edge Runtime doesn't resolve extensionless
   imports, and a missing one only fails at deploy time, not in CI.
3. **Never mutate.** Return new objects; the framework keeps the old ones for
   undo, review and the log.
4. **One submitted action, one log entry.** Don't split a move into several
   actions the client must submit in sequence if the later ones are forced —
   use `nextForcedAction`.

## Swapping in a new game

1. Replace `types.ts`, `rules.ts`, `display.ts`, `GameView.tsx`,
   `GameOptionsEditor.tsx` and `__tests__/`.
2. Update the title in `index.html` and `vite.config.ts`.
3. Rewrite the engine tests that use this game as their fixture
   (`src/engine/__tests__/`) and the test harness's move picker
   (`src/test/supabaseStack/sampleGame.ts`), and regenerate the replay
   fixtures (`src/test/fixtures/productionGames/`).
4. `npm run lint && npm run test && npm run build`.

No migration is needed: the database stores `GameState` as opaque JSON, and
the only fields SQL reads (`status`, `phase`, `turn`, `pendingPlayerIds`,
`activePlayerId`) are the envelope's.
