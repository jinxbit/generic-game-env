# Production smoke test

Replays the recorded games in `../fixtures/productionGames/` against the
**live** Supabase project, through the deployed Edge Functions, and checks each
one finishes exactly as recorded — state, winners and any declared scores.

`npm run test` proves the *code* is right, against an in-process stack
(`../supabaseStack/`). This proves the *deployment* is: migrations actually
applied, functions actually deployed and booting, RLS actually as written,
keys still valid. Neither substitutes for the other.

## Running it

```bash
SMOKE_SUPABASE_URL=https://<project-ref>.supabase.co \
SMOKE_SUPABASE_ANON_KEY=<anon key> \
SMOKE_SUPABASE_SERVICE_ROLE_KEY=<service role key> \
npm run test:smoke
```

`.github/workflows/smoke.yml` runs it after every successful
Supabase deploy, nightly, and on demand. `SMOKE_SUPABASE_URL` defaults to the
`SUPABASE_PROJECT_ID` secret the deploy workflow already uses, so only the two
key secrets need adding.

The service-role key is used only around the game, never in it: creating the
run's throwaway users and deleting them again, tearing the room down, and
reading the unredacted `game_state` row back for assertions. Every game action
and every read the replay makes is submitted as a real signed-in player over
the anon key — submitting as the service role would bypass the very
authorization this is here to test.

## It also fails on a slow deploy, not just a wrong one

Each fixture's average `apply-action`/`undo-action`/`redo-action` round trip
(`replayFixture.ts`'s `actionDurationsMs`) is checked against a ceiling —
`DEFAULT_MAX_AVERAGE_ACTION_MS` in `liveProject.ts`, 1500ms, overridable with
`SMOKE_MAX_AVERAGE_ACTION_MS` — and the run fails with the measured average
and the ceiling named in the message if it's exceeded. This exists because of
todo.md #139: a change that roughly doubled the per-action round trip (~860-
890ms baseline) was only visible as the whole run eventually blowing its 900s
cap, twice, with no number in the failure pointing at what got slower. A
report also carries `averageActionMs` for every fixture that ran, not just a
failing one, so the nightly log shows the trend before it crosses the line.

## Why it can't touch anything real

It writes to a live project's database, so isolation is the whole safety story
(`liveProject.ts`):

- **Throwaway users per run**, created and deleted through the admin API. No
  standing credentials, nothing left in the user list.
- **A `private` room**, so it never appears on the Public Rooms screen.
- **`play_mode: 'live'`, never `'async'`.** Both notification functions
  early-return unless the game is async, so a replay cannot page anyone. Play
  mode is carried on `GameState` but never read by the engine, and the
  enforcement path treats live and async identically — so this costs nothing.
  It is the one field the final-state comparison expects to differ on.
- **Teardown deletes the room before the users.** `games.created_by` and
  `players.user_id` reference `auth.users` with no `on delete cascade`
  (`supabase/migrations/0001_baseline.sql`), so the other order fails on a
  foreign key and strands the room. The room is canceled first — an owner may
  only delete a room in `lobby` or `canceled` — and deleting it cascades its
  players, state, meta and chat.
- Teardown runs in a `finally`, and `provisionLiveRoom` tears down its own
  partial work if it fails part-way. If a run is killed hard enough to skip
  both, the leftovers are one `[smoke] …` private room and its accounts.

## Which games run

Only fixtures that were played on the **rule-enforced** write path, and that
actually finished (`smokeEligibility` in `runSmoke.ts`). A client-trusted game
is skipped with a reason rather than forced through checks it was never played
under — the owner-override check and per-seat authorization, which a real
client-trusted game need not survive. A run where *every* fixture was skipped
fails: a green tick that verified nothing is the worst shape a smoke test can
take.

## Hidden information is forced on

`runSmoke.ts` provisions each room with `{ hiddenInformation: true }`,
overriding whatever the export recorded, so every replay — not only a fixture
that happened to be played with it — reaches the deployed Edge Functions'
`redactStateForPlayer` rather than `revealedGameStateView`: every write
response is masked for the acting seat, and every protocol-2 delta has to be
rebuilt through the in-flight overlay.

The rules never read the flag (only the redaction plumbing does), so the game
replays identically; it is reconciled in `fixtureForRoom` alongside
`playMode`, for the same reason, rather than showing up as a divergence on
every run. The replay itself needs nothing from a write response but its
status and version, so a redacted response costs it nothing; the final-state
comparison reads the row through `LiveRoom`'s service-role `readTrueState()`,
since a seated player's own direct read of a hidden-information game's row
gets nothing at all.

## Every call asks for a protocol-2 delta

The replay speaks protocol 2 on every call, and `runSmoke.ts` fails the run if
a delta could not be rebuilt, or if not one response came back as a delta (a
deployment that ignored `protocol: 2` would otherwise pass silently).

The cache is **per seat**, not per room, because that is what the world looks
like: each seat is a separate browser holding its own IndexedDB entry, and a
seat's cache only advances when that seat itself calls. So a request's
`sinceActionIndex` is usually several entries behind the row and the append
comes back multi-entry — the case `extendReplay` has to fold undo/redo
markers through, which a single-action test never reaches.

The client half is `gameApi.ts`'s own `applyReplayDelta`/`deriveBaseFromView`,
imported from `src/lib/replayDelta.ts`. That module exists so they can be
imported at all: `gameApi.ts` pulls in `./supabase`, which throws at import
time without env vars. A smoke test that reimplemented the client half would
prove the deployment agrees with the test, not with the app.

Measured against the in-process stack (each count includes one final
`get-game-state` per seat):

```
three-player-async-undo-concede   20 actions   20 deltas   3 full
three-player-hidden-picks         15 actions   15 deltas   3 full
```

`full` is not a failure count. A seat's first call has no cache, and a
redacted game's safe prefix can move *backwards* (it is not monotonic — a redo
can put a still-secret move back in effect), which `get-game-state` answers
with a full state and the reason `prefix-moved-back`.

## Player ids are remapped

A fixture's history and state name the original room's `players.id` uuids —
as values, and as object keys (the example game keys `game.picks` and
`game.scores` by player id). A fresh room gets fresh uuids, so
`remapFixture.ts` rewrites the history — and the expected end state, scores
and winners — onto the new room before anything is submitted, as a
substitution over the serialized JSON so no id is missed wherever a game
happens to keep one.

## Cost per run

Each action is one Edge Function invocation plus one `game_state` write, and
each write fires the configured Database Webhooks (which return immediately
for a non-async game). The checked-in fixtures are short, so a run is a few
dozen invocations — but worth keeping in mind before adding long recorded
games.

## The hidden-information wire check

`hiddenInformationWire.ts`/`.smoke.ts` is a second, independent check in this
same directory: rather than replaying a recorded game, it opens its own
throwaway three-seat room (same isolation rules as above), plays one round and
one pick of the next, and inspects the *raw* `get-game-state` (full and
protocol-2) and `apply-action` response bodies and a real Realtime
subscription — bypassing `gameApi.ts`'s usual collapse — to prove a
still-pending player's secret pick never crosses the wire in any of them, then
that it's revealed once the round resolves. It runs automatically alongside
the fixture-replay check above: `vitest.smoke.config.ts`'s `include` matches
every `*.smoke.ts` file here, so no separate workflow entry was needed. The
wire half (no socket required) is also exercised on every PR against the
in-process stack via `../__tests__/hiddenInformationWireRunner.test.ts`; the
Realtime half only ever runs here, against a live project.

## The runner is itself tested

`../__tests__/productionSmokeRunner.test.ts` runs this exact runner against the
in-process stack on every PR — it creates users, signs them in, opens a room,
seats players, starts the game, replays a recorded game and cleans up, without
knowing it isn't talking to Supabase. Production is a bad place to discover
that the provisioning sequence, the id remapping or the teardown is wrong.
