# Game Platform

A base for building web apps that play turn-based board games with a small
group of friends — live, async ("play by turn"), or pass-and-play on one
shared device (hotseat). One deployment can host several games — each game
is its own package (it can live in its own repo) that this repo, the main
platform repo, installs and registers. It ships with a tiny example game,
**Unique Pick** (`packages/unique-pick/`), wired all the way through so every
part of the platform is exercised; see
[`packages/unique-pick/README.md`](packages/unique-pick/README.md) for how to
build another.

What the platform gives a game for free:

- Accounts (Discord/Google OAuth, email/password, optional guest sign-in),
  display names and per-account preferences.
- Rooms with codes, public/private listing, a lobby with ready checks,
  owner-editable configuration, cancel/delete lifecycle, and a "your turn"
  overview across all your games.
- An event-sourced rules framework: an append-only action log replayed from
  a deterministic genesis, shared undo/redo, history review, forced-move
  folding, concede, and a logged "admin mode" for unsticking a game.
- Server-side rule enforcement through Supabase Edge Functions that run the
  exact same rules code as the client, plus hidden information (per-viewer
  redaction of whatever the game keeps secret) on the read and write paths.
- Realtime sync, a bandwidth-lean delta read protocol, an IndexedDB state
  cache, gzip-at-rest state storage.
- Site-wide and in-game chat, Discord webhook and Web Push notifications
  for turns, lobby/game lifecycle events and chat.
- A PWA with an update banner, and a test suite that includes an in-process
  Supabase stack behaving like production plus real games replayed as
  regression tests.

## Stack

- **Frontend:** Vite + React + TypeScript, Tailwind CSS v4
- **Backend:** Supabase (Postgres for game state, Realtime for live sync, Auth with Discord/Google OAuth or email/password for identity, Edge Functions for rule enforcement and notifications)
- **Hosting:** Vercel (frontend) + Supabase (backend)

## Architecture

- `packages/sdk/` (`@game-platform/sdk`) — the rules *framework*. Pure
  TypeScript, zero React/Supabase imports, fully unit-testable. Everything
  else treats `GameState` as opaque and only changes it by calling
  `applyAction()` here. A game's current state is always reconstructable by
  replaying its append-only `actionHistory` from genesis (event sourcing),
  which is what makes undo/redo, history review, server enforcement and the
  replay tests work. It knows nothing about any particular game: it finds a
  state's rules in a registry by the state's `gameType`/`rulesVersion`, and
  calls them through the `GameDefinition` contract.
- `packages/<game>/` — one package per game (here just `unique-pick`), each
  with a `rules` entry (its `GameDefinition` — also run by the Edge Functions)
  and a `view` entry (its React view and options form). A game can equally
  live in its own repo and be installed from a registry or git.
- `src/games/` — the deployment's game list: `registry.ts` registers each
  game's rules (browser, Edge Functions and tests all import it), `ui.ts`
  maps each game to its view. `src/site.ts` holds the site's own branding.
- `src/lib/` — Supabase client, auth helpers, and typed query functions
  (`gameApi.ts`) that read/write the `games` / `players` / `game_state` /
  `game_state_meta` / `profiles` tables, plus genesis (`gameGenesis.ts`), the
  storage encoding (`gameStateCompression.ts`), the delta read protocol
  (`replayDelta.ts`) and the export format (`gameStateExport.ts`).
- `src/pages/` + `src/components/` — the platform UI: home/lobby/create
  screens, the in-game shell (`GamePage.tsx`: menu, undo/redo, history
  review, hotseat hand-off, admin mode, chat, log) around the game's own view,
  profile and admin screens.
- `supabase/migrations/` — SQL migrations, starting from one baseline
  (`0001_baseline.sql`). Applied automatically by
  `.github/workflows/deploy-supabase.yml`, or by hand (see below).
- `supabase/functions/` — Edge Functions: `start-game`, `apply-action`,
  `undo-action`, `redo-action` and `get-game-state`, which enforce the rules
  and redact hidden information server-side, plus the `notify-*` turn,
  lifecycle and chat notifiers. They import the SDK and every registered
  game's rules unmodified, through `supabase/functions/deno.json` —
  there is no second copy of the rules.
- `src/test/` — vitest setup, an in-process Supabase stack that behaves like
  production (`supabaseStack/`), and real games replayed as regression tests
  (`fixtures/productionGames/`).

`CLAUDE.md` at the repo root is the short orientation doc: the same layering
plus the invariants and gotchas worth knowing before changing anything.

**Play modes** (`live` / `async` / `hotseat`) share the same rules and the
same `GameState` JSON shape end to end. The only thing that differs between
them is how a client figures out "which player am I" and how it learns about
updates:

- **Live:** all players connected at once; Supabase Realtime pushes every
  state change to every client immediately.
- **Async ("play by turn"):** no realtime requirement — a player's client
  just loads the current `game_state` row and checks whose turn it is.
  Optional "your turn" pings go out over Discord webhooks and Web Push (see
  below), sent server-side.
- **Hotseat:** one device, players take turns in person. Every seat belongs
  to the one signed-in host account, and the app gates each handover behind
  a "pass the device" screen so the next player doesn't see the previous
  one's secrets (skippable per game — see the hotseat section below).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project values
npm run dev
```

Other scripts:

```bash
npm run test        # the whole test suite (vitest) — engine, UI, and replays
npm run test:watch  # the same, in watch mode
npm run lint        # oxlint
npm run build       # typecheck (3 tsconfig projects) + production build
```

CI (`.github/workflows/ci.yml`) runs lint, test, and build on every pull
request; all three also run in a few seconds to half a minute locally.

If `.env.local` isn't set up yet, the app renders a "Configuration error"
message instead of a blank screen — that's expected until you complete the
Supabase setup below.

## Supabase setup (do this yourself)

1. Create a new project at [supabase.com](https://supabase.com).
2. Apply every migration in `supabase/migrations/`, in filename order. The
   easy way is the CLI — `supabase link --project-ref <your-project-ref>`
   then `supabase db push` — which applies all of them and records what it
   applied; the SQL editor works too if you paste them in order.
   `0001_baseline.sql` creates everything the app needs: rooms (`games`,
   `players`), game state (`game_state` and its `game_state_meta`
   projection), Row Level Security, `profiles`, `push_subscriptions`, chat,
   and the `supabase_realtime` publication.
3. Copy your project's **Project URL** and **anon public key** (Settings →
   API) into `.env.local` as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
4. Deploy the Edge Functions if you want server-side rule enforcement or
   turn notifications — `supabase functions deploy` — plus the per-function
   secrets described in the sections below. Everything else works without
   them.

## Deploying Supabase changes (optional)

Migrations and Edge Functions can be applied by hand (SQL editor / `supabase`
CLI, as described throughout this doc) or automatically on every push to
`main` via [`.github/workflows/deploy-supabase.yml`](.github/workflows/deploy-supabase.yml).
That workflow runs whenever a file under `supabase/migrations/` or
`supabase/functions/` changes (or on manual trigger from the Actions tab),
links the CLI to your project, runs `supabase db push` to apply any new
migrations, and `supabase functions deploy` to redeploy all Edge Functions.

To enable it, add these repository secrets (**Settings → Secrets and
variables → Actions**):

- `SUPABASE_ACCESS_TOKEN` — a personal access token from your [Supabase
  account settings](https://supabase.com/dashboard/account/tokens).
- `SUPABASE_PROJECT_ID` — your project's ref, the subdomain in its API URL
  (`https://<project-ref>.supabase.co`).
- `SUPABASE_DB_PASSWORD` — the database password you set when creating the
  project (Settings → Database, or reset it there if forgotten).

Function-specific secrets (`DISCORD_NOTIFY_WEBHOOK_SECRET`, VAPID keys, etc.)
still need to be set once per project with `supabase secrets set`, as
described in each function's setup section below — the workflow only
deploys code, not secrets.

## Email/password sign-in

Supabase's built-in Email provider is enabled by default, so no extra setup
is required beyond a fresh Supabase project — the home page's "or" divider
lets a player register with a username, email, and password, or sign back in
with the same email/password. The username becomes the account's display
name (`full_name`), same as the Discord/Google flows. If the Supabase
project has **Confirm email** turned on (Authentication → Providers →
Email), a new account can't sign in until the player clicks the
confirmation link sent to their inbox.

**Forgot password:** "Forgot password?" on the sign-in form emails a reset
link (Supabase's `resetPasswordForEmail`) that lands on `/reset-password`,
where the player sets a new password. That path needs to be reachable from
the allow list in **Authentication → URL Configuration → Redirect URLs** —
add `<your-origin>/reset-password` (e.g. `http://localhost:5173/reset-password`
for local dev) alongside the plain origins already added for Discord/Google
OAuth above, or use a wildcard like `http://localhost:5173/**` to cover both.

## Discord OAuth setup (do this yourself)

This uses Supabase Auth's built-in Discord provider, so a player's Discord
username/avatar becomes their in-game identity, with a stable account
across live/async/hotseat sessions.

**1. Create the Discord application**

- Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
- Name it whatever you like (e.g. your game).
- Under **OAuth2 → General**, note the **Client ID** and **Client Secret**
  (click "Reset Secret" if one isn't shown yet) — you'll paste both into
  Supabase in step 3.

**2. Get your Supabase callback URL**

- In the Supabase dashboard: **Authentication → Providers → Discord**.
- Supabase shows a **Callback URL (for OAuth)** field, something like:
  `https://<your-project-ref>.supabase.co/auth/v1/callback`
- Copy it exactly.

**3. Register the redirect URL in Discord**

- Back in the Discord Developer Portal, under **OAuth2 → General → Redirects**,
  click **Add Redirect** and paste the Supabase callback URL from step 2.
- Save changes.

**4. Configure the scopes**

- No extra scope configuration is needed on the Discord side for basic
  login — Supabase requests `identify` and `email` by default when you
  enable the provider, which is enough to get the user's Discord username,
  id, and avatar. You don't need to add a redirect scope or bot
  permissions; this is a plain OAuth login, not a bot install.

**5. Enable the provider in Supabase**

- In **Authentication → Providers → Discord**, toggle it on, paste in the
  **Client ID** and **Client Secret** from step 1, and save.

**6. Add your app's redirect URLs**

- In **Authentication → URL Configuration**, add the URLs your app will
  actually run on to the allow list, e.g.:
  - `http://localhost:5173` (local dev)
  - your Vercel deployment URL, once you have one
- The app calls `signInWithOAuth` with `redirectTo: window.location.origin`,
  so whatever origin the user is on when they click "Sign in with Discord"
  needs to be in this list.

Once that's done, "Sign in with Discord" on the home page should work end
to end.

## Google OAuth setup (do this yourself)

This uses Supabase Auth's built-in Google provider as an alternative to
Discord — a player's Google name/avatar becomes their in-game identity, with
a stable account across live/async/hotseat sessions, same as Discord.

**1. Create OAuth credentials in Google Cloud**

- Go to the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials)
  and select or create a project.
- Click **Create Credentials → OAuth client ID**. If prompted, configure the
  **OAuth consent screen** first (External is fine for testing).
- Application type: **Web application**. Name it whatever you like (e.g.
  your game).
- Note the **Client ID** and **Client Secret** — you'll paste both into
  Supabase in step 3.

**2. Get your Supabase callback URL**

- In the Supabase dashboard: **Authentication → Providers → Google**.
- Supabase shows a **Callback URL (for OAuth)** field, something like:
  `https://<your-project-ref>.supabase.co/auth/v1/callback`
- Copy it exactly.

**3. Register the redirect URL in Google Cloud**

- Back in the Google Cloud Console, edit the OAuth client from step 1, and
  under **Authorized redirect URIs**, add the Supabase callback URL from
  step 2.
- Save changes.

**4. Enable the provider in Supabase**

- In **Authentication → Providers → Google**, toggle it on, paste in the
  **Client ID** and **Client Secret** from step 1, and save.

**5. Add your app's redirect URLs**

- In **Authentication → URL Configuration**, add the URLs your app will
  actually run on to the allow list, e.g.:
  - `http://localhost:5173` (local dev)
  - your Vercel deployment URL, once you have one
- (Skip this if you've already added them for Discord — it's the same list.)
- The app calls `signInWithOAuth` with `redirectTo: window.location.origin`,
  so whatever origin the user is on when they click "Sign in with Google"
  needs to be in this list.

Once that's done, "Sign in with Google" on the home page should work end to
end.

## Discord turn notifications (optional, per player)

This is separate from Discord OAuth above — sign-in identifies who you are,
this is just an optional ping for async games. No bot or extra Discord app
setup: each player creates their own [Discord
webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)
on a channel they control and pastes the URL into the "Discord
notifications" panel on the home page. When it becomes their turn in an
async game, a Supabase Edge Function (`supabase/functions/notify-discord-turn`)
sends the ping — not a co-player's browser, so it still fires even if
everyone else has closed the tab, and no player's webhook URL needs to be
readable by anyone but the backend.

1. In Discord, go to the channel you want pings in → **Edit Channel →
   Integrations → Webhooks → New Webhook**.
2. Copy its **Webhook URL**.
3. On the Profile page, open **Discord notifications**, paste the
   URL in, and hit **Save**. **Send test** confirms it's wired up correctly.

**Backend setup** (do this once per Supabase project):

1. Apply the migrations (the baseline creates the `profiles` table webhook
   URLs are stored in, readable only by each player's own row).
2. Deploy the Edge Function with the [Supabase
   CLI](https://supabase.com/docs/guides/functions/deploy):
   ```bash
   supabase functions deploy notify-discord-turn
   supabase secrets set DISCORD_NOTIFY_WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are provided automatically at
   runtime; `DISCORD_NOTIFY_WEBHOOK_SECRET` is a value you choose, used to
   confirm requests actually came from your project's Database Webhook.
   Optionally also set `SITE_URL` (e.g. `supabase secrets set
   SITE_URL=https://your-deployed-site.example`) so the ping includes a
   direct link to the game — without it, the ping falls back to showing the
   room code instead of a link. Only the origin is used, so it's fine even
   if the value has a path on the end (e.g. one copy-pasted from the browser
   address bar while testing).
3. Register the Database Webhook — **Database → Webhooks → Create a new
   hook** in the Supabase dashboard.
   - Table: `game_state`. Events: `Update`.
   - Type: **Supabase Edge Functions**, targeting `notify-discord-turn`.
   - Add an HTTP header `x-webhook-secret` set to the same value as
     `DISCORD_NOTIFY_WEBHOOK_SECRET` above.

Steps 2 and 3 are what the **Set Up Discord Notifications** workflow
(Actions → Run workflow) does for you, including registering the hook —
see [Setting the backend up from GitHub Actions](#setting-the-backend-up-from-github-actions)
below. Re-running it rotates the secret on both sides at once.

This one hook feeds two pings: "it's your turn", and the game-finished
lifecycle ping (see the lifecycle section below). See
`supabase/functions/notify-discord-turn/index.ts`'s doc comment for how the
function decides who to ping.

## Push notifications (optional, per player)

The app is installable as a PWA (Add to Home Screen / Install app) and can
send a system notification when it becomes your turn in an async game — no
Discord setup needed, just a browser permission prompt. Same design as
Discord turn notifications above: a Supabase Edge Function
(`supabase/functions/notify-web-push`) sends the push server-side, so it
still fires even if every tab is closed.

1. On the Profile page (once the backend below is set up), open
   **Profile → Push notifications** and hit **Turn on**, then allow the
   browser's permission prompt.
   - **iOS Safari**: only works after the app has been installed to the
     Home Screen (Share → Add to Home Screen) — Safari doesn't support Web
     Push for regular browser tabs, only for installed PWAs, and needs
     iOS/iPadOS 16.4+.
   - **Android (Chrome and most others)**: works either installed or as a
     regular browser tab.

**Backend setup** (do this once per Supabase project):

1. Apply the migrations (the baseline creates the `push_subscriptions`
   table subscriptions are stored in).
2. Generate a VAPID keypair (identifies your server to push services —
   nothing to sign up for):
   ```bash
   npx web-push generate-vapid-keys
   ```
3. Set `VITE_VAPID_PUBLIC_KEY` in your `.env` (see `.env.example`) to the
   public key — this is what enables the opt-in UI at all; leaving it unset
   hides it. Rebuild/redeploy the frontend after setting it.
4. Deploy the Edge Function and set its secrets:
   ```bash
   supabase functions deploy notify-web-push
   supabase secrets set VAPID_PUBLIC_KEY=<the public key from step 2>
   supabase secrets set VAPID_PRIVATE_KEY=<the private key from step 2>
   supabase secrets set PUSH_NOTIFY_WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```
   `VAPID_CONTACT` is optional (`supabase secrets set
   VAPID_CONTACT=mailto:you@example.com`) — some push services use it to
   reach you if your server is misbehaving; defaults to a placeholder.
   `SITE_URL` (see the Discord section above) is reused here too, so the
   notification can deep-link straight to the game.
5. In the Supabase dashboard: **Database → Webhooks**, and either add a
   second target to the same hook created for Discord above, or create a
   new one — Table: `game_state`, Events: `Update`, Type: **Supabase Edge
   Functions**, targeting `notify-web-push`, with an HTTP header
   `x-webhook-secret` set to `PUSH_NOTIFY_WEBHOOK_SECRET` from step 4.

Steps 4 and 5 (and the keypair in step 2) are what the **Set Up Web Push
Notifications** workflow does for you — see [Setting the backend up from
GitHub Actions](#setting-the-backend-up-from-github-actions) below. Step 3
stays yours: nothing in this repo's Actions can set an env var on the
frontend host.

See `supabase/functions/notify-web-push/index.ts`'s doc comment for how the
function decides who to ping — it's the same turn-detection logic as the
Discord function, just a different delivery channel.

## Lobby & game lifecycle notifications (optional, per player)

Same two channels and same per-player opt-in as above (Discord webhook /
push subscription — there's no separate toggle for these), but for four
room-lifecycle events instead of "it's your turn": a player joining the
lobby, the game starting, the game finishing, and the game being canceled.

Three of the four are away from the board, on tables the turn notifications
don't watch, so two more Edge Functions send them —
`notify-discord-lifecycle` and `notify-web-push-lifecycle`, each triggered by
two Database Webhooks (`players` inserts and `games` status updates). The
fourth, **game finished**, is `game_state` reaching `completed` — the same
table and event the turn notifications already watch, so `notify-discord-turn`
and `notify-web-push` send that one off the hook they already have. Giving it
its own hook meant invoking a second function on every action write in every
game to catch the one write per game that completes it.

Live players already see all of this over Realtime and hotseat has nobody
remote to ping, so — same rule as the turn notifications above — only async
games trigger a ping.

**Backend setup**: run the **Set Up Lifecycle Notifications** workflow
(Actions → Run workflow → pick the environment, type `YES`). It deploys both
functions, generates and sets `DISCORD_LIFECYCLE_WEBHOOK_SECRET` /
`PUSH_LIFECYCLE_WEBHOOK_SECRET`, registers all four Database Webhooks, and
probes both functions with the headers those hooks now carry. Do the
Discord/push turn-notification setup first: these functions reuse the same
`profiles` / `push_subscriptions` tables, the same VAPID keypair, and the
same per-player opt-in — there is no separate toggle for lifecycle events.

By hand instead, once per Supabase project:

1. Deploy both Edge Functions and set their secrets:
   ```bash
   supabase functions deploy notify-discord-lifecycle
   supabase secrets set DISCORD_LIFECYCLE_WEBHOOK_SECRET=$(openssl rand -hex 32)

   supabase functions deploy notify-web-push-lifecycle
   supabase secrets set PUSH_LIFECYCLE_WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```
   Both reuse `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (automatic) and
   `SITE_URL` (optional, already set above if you configured turn
   notifications) for the game link. `notify-web-push-lifecycle` also reuses
   the existing `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CONTACT`
   secrets from the push notifications setup above — no new keypair, since
   it's the same subscriber pool.
2. In the Supabase dashboard: **Database → Webhooks**, create two hooks
   per function (four total) — one per source table, each targeting the
   matching lifecycle function:
   - Table: `players`, Events: `Insert`
   - Table: `games`, Events: `Update`

   No `game_state` hook: the turn notifications' existing one sends the
   finished ping. If you set these up before that fold and have one, delete
   it — the function ignores those payloads now.

   Each hook needs Type **Supabase Edge Functions** and an HTTP header
   `x-webhook-secret` set to `DISCORD_LIFECYCLE_WEBHOOK_SECRET` (for the
   three targeting `notify-discord-lifecycle`) or
   `PUSH_LIFECYCLE_WEBHOOK_SECRET` (for the three targeting
   `notify-web-push-lifecycle`).

See `supabase/functions/notify-discord-lifecycle/index.ts`'s doc comment for
the full trigger/dispatch details, which apply to both functions.

## Chat message notifications (optional, per player, in-game chat only)

Same two channels as the notifications above, but **not** the same
per-player opt-in: a player who already pasted in a Discord webhook or
turned on push for turn/lifecycle pings does not automatically get pinged on
every chat message too. There's a second, separate toggle — **Profile →
Chat message notifications**, on by default — that a
player can turn off if turn/lifecycle pings are enough on their own.

Two more Edge Functions, `notify-discord-chat` and `notify-web-push-chat`,
send this, triggered by a Database Webhook on `chat_messages` inserts. Site-
wide chat (`game_id is null`) never notifies — there's no natural recipient
for a message that isn't addressed to anyone in particular, same reasoning
CHAT_PLAN.md §13 already applied to the unread indicator. In-game chat
follows the same "only async games" rule as every notification above: a live
player already sees new messages over `chat_messages`' Realtime subscription,
and hotseat has nobody remote to ping.

**Backend setup**, once per Supabase project — or use the **Set Up Chat
Notifications** workflow (Actions → Run workflow), which does all of the
below in one dispatch, the same way the other three families' setup
workflows do; see
[Setting the backend up from GitHub Actions](#setting-the-backend-up-from-github-actions).

1. Deploy both Edge Functions and set their secrets:
   ```bash
   supabase functions deploy notify-discord-chat
   supabase secrets set DISCORD_CHAT_WEBHOOK_SECRET=$(openssl rand -hex 32)

   supabase functions deploy notify-web-push-chat
   supabase secrets set PUSH_CHAT_WEBHOOK_SECRET=$(openssl rand -hex 32)
   ```
   Both reuse `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (automatic) and
   `SITE_URL` (optional, already set above if you configured turn
   notifications). `notify-web-push-chat` also reuses the existing
   `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_CONTACT` secrets — same
   subscriber pool, no new keypair.
2. Register the Database Webhook — either **Database → Webhooks → Create a
   new hook** in the dashboard (Table: `chat_messages`, Events: `Insert`,
   Type: **Supabase Edge Functions**, targeting `notify-discord-chat` /
   `notify-web-push-chat`, HTTP header `x-webhook-secret` set to the matching
   secret from step 1), or run `scripts/supabase/register-database-webhook.sh`
   directly the way the other setup workflows do:
   ```bash
   SUPABASE_PROJECT_ID=<project-ref> SUPABASE_ACCESS_TOKEN=<token> \
   FUNCTION_NAME=notify-discord-chat WEBHOOK_SECRET=<the secret from step 1> \
   WEBHOOK_HOOKS="chat_messages:INSERT" \
   ./scripts/supabase/register-database-webhook.sh
   ```
   (and again with `FUNCTION_NAME=notify-web-push-chat` /
   `PUSH_CHAT_WEBHOOK_SECRET`). See that script's own header comment for what
   it does and its `WEBHOOK_DRY_RUN=1` option.

See `supabase/functions/notify-discord-chat/index.ts`'s doc comment for the
full trigger/scope details, which apply to both functions.

## Setting the backend up from GitHub Actions

Four manually-dispatched workflows do the notification backend setup above
without a terminal — useful for rotating a leaked secret from a phone, and
the only practical way to keep eight hooks consistent:

| Workflow | Deploys | Registers |
| --- | --- | --- |
| Set Up Discord Notifications | `notify-discord-turn` | `game_state`/Update |
| Set Up Web Push Notifications | `notify-web-push` | `game_state`/Update |
| Set Up Lifecycle Notifications | `notify-discord-lifecycle`, `notify-web-push-lifecycle` | `players`/Insert, `games`/Update, per function |
| Set Up Chat Notifications | `notify-discord-chat`, `notify-web-push-chat` | `chat_messages`/Insert, per function |

Each one asks which environment to target (Preview is pre-production, the
project `main` deploys to; production is the live one) and refuses to run if
that GitHub Environment has no `SUPABASE_PROJECT_ID` of its own and would
have silently inherited production's — the same guard, and the same
incident, as `deploy-supabase.yml`.

Each generates a fresh webhook secret, sets it on the function, and writes
it into the hooks in the same run, so **re-running a setup workflow is how
you rotate a secret**; nothing has to be copied by hand and the two sides
cannot drift apart. A Database Webhook is only a Postgres trigger calling
`supabase_functions.http_request`, so registration is
`scripts/supabase/register-database-webhook.sh` sending SQL over the
Supabase Management API. It describes a function's hooks in full rather than
adding to them: everything already pointing at that function is dropped
first, so a hook you created by hand is adopted rather than doubled, and one
the function no longer needs is retired. `WEBHOOK_DRY_RUN=1` prints the SQL
instead of sending it.

Two things stay manual, because nothing here can do them:

- Each player's own opt-in — pasting a Discord webhook URL, or enabling
  push — in the app's Profile screen. That's per-player data.
- `VITE_VAPID_PUBLIC_KEY` on the frontend host (Vercel), after generating a
  new keypair. The workflow prints the value to paste.

If registration can't run at all — the Management API is unreachable, or
Database Webhooks were never enabled on a fresh project (**Database →
Webhooks → Enable**, which is what installs
`supabase_functions.http_request`) — the run says so, prints the dashboard
steps and the secret to paste, and fails loudly rather than leaving you with
a function nothing calls.

## Replaying production games in tests

Real games can be turned into regression tests by dropping their export into
`src/test/fixtures/productionGames/`. Use **Copy game export** on a game page
(see `src/lib/gameStateExport.ts`), save the JSON there, and `npm run test`
picks it up — no registration step.

Each one is replayed action by action, submitted by the seat that actually
made each move, on the same write path the game was played on — the real
`apply-action`/`undo-action`/`redo-action` Edge Functions for a rule-enforced
game, or a direct `game_state` write for a client-trusted one — against a
Supabase stack that behaves like production: the migrations' Row Level
Security, `game_state`'s compare-and-swap `version`, the
`game_state_sync_meta` trigger and the gzipped-at-rest state encoding are all
in play (`src/test/supabaseStack/`). The test then asserts the game ends
exactly where production ended it, winners included.

The only pieces that are test doubles are Postgres and the Deno Edge Runtime
themselves, so this runs on a plain Node CI runner with no Docker. For the
remaining fidelity — a real Postgres running the actual migration SQL, and
the functions on the real Edge Runtime — bring up the local stack with
`supabase start` && `supabase db push` && `supabase functions serve` (see
`supabase/config.toml`).

See `src/test/fixtures/productionGames/README.md` for what gets asserted,
what the loader infers about a game's room row, and how to override it.

## Smoke-testing the live deployment

`npm run test` verifies the code against an in-process stack. It cannot tell
you whether a migration actually applied, an Edge Function actually deployed,
or a policy was edited in the dashboard. `npm run test:smoke` does: it
replays the same real games against the **live** Supabase project, through the
deployed `apply-action`/`undo-action`/`redo-action` functions, and checks each
one finishes with the winners it finished with in production.

```bash
SMOKE_SUPABASE_URL=https://<project-ref>.supabase.co \
SMOKE_SUPABASE_ANON_KEY=<anon key> \
SMOKE_SUPABASE_SERVICE_ROLE_KEY=<service role key> \
npm run test:smoke
```

`.github/workflows/smoke.yml` runs it after every successful
Supabase deploy, nightly, and on demand — add `SMOKE_SUPABASE_ANON_KEY` and
`SMOKE_SUPABASE_SERVICE_ROLE_KEY` as repository secrets and it works (the URL
falls back to the `SUPABASE_PROJECT_ID` secret the deploy workflow already
uses).

It writes to production, so each run works in an isolated, private `live`-mode
room owned by throwaway accounts it deletes afterwards, and can never page a
real player (both notification functions only fire for `async` games). See
`src/test/productionSmoke/README.md` for the full isolation story, which games
are eligible, and the per-run cost.

## Testing without Discord OAuth set up

Set `VITE_ALLOW_GUEST_AUTH=true` (see `.env.example`) to show a "Continue
as guest (testing)" button next to the Discord one. It uses Supabase's
built-in anonymous sign-in, which produces a real session/`auth.uid()`, so
RLS and the rest of the app work exactly as with a Discord identity — the
only difference is the display name (`Guest 1234`) and no persistent
account across browsers/devices.

This requires **Authentication → Sign In / Providers → Allow anonymous
sign-ins** to be enabled in the Supabase dashboard (off by default).

Leave `VITE_ALLOW_GUEST_AUTH` unset in production — Discord sign-in is
meant to be mandatory there; this is a testing-only escape hatch. This isn't
just convention: `isGuestAuthAllowed()` (`src/lib/auth.ts`) also requires a
non-production build by the same `VITE_ENVIRONMENT` signal the environment
badge uses, so a shared/mis-scoped Vercel env var can't turn
guest sign-in on in production by itself.

## Hotseat identity — how it works

**One signed-in host seats several named local players under their own
account.** `players` has no `unique (game_id, user_id)` constraint, so
several rows can share one `user_id` (`unique (game_id, seat_index)` still
keeps seats distinct),
and the host adds them in the lobby with `addLocalPlayer()`
(`src/lib/gameApi.ts`). No player but the host ever signs in, and there is
no multi-session juggling.

In game, `GamePage.tsx` makes "which player is this browser acting as"
follow whoever must act next (`currentActorId`, `packages/sdk/src/turnOrder.ts`)
rather than a fixed identity, and puts a **"pass the device"
confirmation** in front of each handover so the next player doesn't see the
previous one's secrets. A game can opt out of that gate
(`settings.skipHotseatPassGate`) when players don't care about hiding
information from each other.

The same "act as whoever is pending" mechanism is what admin mode reuses
for live/async games, where a room owner or site admin can take a turn on
behalf of the player the game is waiting on.

## Debugging: game state export

Every in-progress game's menu (the hamburger icon top-left of `GamePage`)
has a **"Copy game export"** action that copies a small JSON file to the
clipboard — useful for attaching to a bug report, pasting into a chat, or
inspecting a specific game's state without going through Supabase.

The file is real JSON (open it in any editor, `JSON.parse` it, or save it
as `whatever.json`) with this shape — see
`src/lib/gameStateExport.schema.json` for the full JSON Schema:

```json
{
  "schema": "game-platform/game-state-export",
  "version": 1,
  "exportedAt": "2026-08-15T22:00:00.000Z",
  "gameStateZipped": "H4sIAAAAAAAAA6tWKknMzs..."
}
```

`schema`/`version` identify the file and its format; `exportedAt` is when
it was generated. The actual game state lives in `gameStateZipped` —
gzip-compressed then base64-encoded, since the state (with its whole action
log) would otherwise dominate the file. To get the
state back out:

- **In this codebase**: `decodeGameStateExport(text)` from
  `src/lib/gameStateExport.ts` parses the file, decompresses
  `gameStateZipped`, and returns `{ schema, version, exportedAt, gameState }`
  with `gameState` as a `GameState` (`@game-platform/sdk`).
- **From the command line**, with `jq` and `gzip` installed:
  ```sh
  jq -r .gameStateZipped export.json | base64 -d | gunzip
  ```
- **In any language with gzip + base64 support**: base64-decode
  `gameStateZipped`, then gunzip the result — you get back the
  `JSON.stringify`'d `GameState`.

There's also a **"Show game state JSON"** toggle in the same menu that
prints the current state as plain (uncompressed) pretty-printed JSON
inline in the page, for quick eyeballing without decoding anything.

A site admin can go the other way: the **Import game export** admin screen
(`/admin/import`, linked from the hamburger menu) pastes one of these
exports back in and turns it into a brand-new hot seat room the admin owns —
useful for reproducing a reported game locally without Supabase access or
the reporter's account. Every seat becomes a local pass-and-play player
under the admin's own account (same conversion GamePage.tsx's own
"Duplicate as hot seat" action does for a live game already in this
project); the game the export came from is never read or modified. Since the export only
carries a `GameState`, not the source game's settings, the new room gets
defaults — rule enforcement and hidden information both off — except the
game's own options, recovered from `GameState.options`
(`src/lib/gameApi.ts`'s `importGameExportAsHotseat`).

## Server-side rule enforcement

A game is either *client-trusted* or *rule-enforced*, fixed at creation by
`settings.ruleEnforcementEnabled`:

- **Client-trusted:** each client runs the rules itself and writes the
  resulting `game_state` row directly, with the `version` column providing
  compare-and-swap concurrency. Fine among friends, but it takes every
  client at its word. `createGame()` defaults to this for any caller that
  omits the flag (tests included).
- **Rule-enforced:** every game the create-game screen makes. Start Game
  goes through the `start-game` Edge Function, and every move, undo and redo
  through `apply-action` / `undo-action` / `redo-action`: the client submits
  the raw *action*, and the server resolves the caller's seat from their
  JWT, refuses any action naming somebody else's seat, re-derives the state
  with the same rules code the client bundles, and does its own
  compare-and-swap write. RLS rejects direct `game_state` writes for these
  games, so the Edge Functions are the only way in. Their state is also
  stored gzipped.

**Hidden information** (`settings.hiddenInformationEnabled`) builds on
enforcement: reads go through `get-game-state`, which hands each viewer a
copy with whatever the game keeps secret masked (the game decides what's
secret — `GameDefinition.redactGame`/`isActionSecret`), and the write
functions redact their responses the same way. Each player's client keeps the
whole game log, undo/redo and history review from a per-player **view log**:
the server records each move's change to every player's view when it writes
the move, and a read sends only the new entries in that player's form
(`packages/sdk/src/viewLog.ts`). Long-lived secrets such as cards in a hand
cost no more on the wire than short ones. The create-game screen turns
it on for every non-hotseat game; hotseat never gets it, since one shared
login across every local seat makes per-seat masking actively wrong there
(`src/lib/hiddenInformationEligibility.ts`).

**Undo in a shared game.** Undo and redo are logged actions, so every client
agrees on them. Undoing is always allowed for a seated player; submitting a
*new* action behind the tip discards the undone tail, and if that tail
contains another player's action, only the room owner or a site admin with
**admin mode** switched on (a logged action, so the room keeps a record) may
do it. A room created with **"Don't allow undoing a move once it has revealed
hidden or random information"** (`settings.lockRevealedInformationEnabled`,
checked by default on the create-game screen for every non-hotseat game)
also needs that override to undo a move that revealed something: the last
pick of a round that showed everyone's picks, or a move whose dice a player
has seen (`isUndoLockedByReveal`, `packages/sdk/src/undoRedo.ts`). The
`undo-action` Edge Function enforces it; the Undo button is disabled to
match, and is the only check for a client-trusted game.

**Randomness.** A game's rules draw random numbers from what the framework
hands them, and every number drawn is recorded in the log, so replay never
rolls again (`packages/sdk/src/random.ts`). A rule-enforced game's numbers
come from a per-game seed only the Edge Functions can read — the
`game_secrets` table (`supabase/migrations/0002_game_secrets.sql`), with RLS
on and no policies — so players can see every roll that has happened but not
predict the next one. A client-trusted game's client rolls its own.

## Games, sites and branding

**Adding a game.** Each game is a package with a `rules` entry and a `view`
entry. To add one — from this repo's `packages/` or installed from another
repo — add it to `package.json`, register its rules in
`src/games/registry.ts` and its view in `src/games/ui.ts`, and map its
`rules` entry in `supabase/functions/deno.json` so the Edge Functions
can load it (a test fails if you forget). No migration is needed.
[`packages/unique-pick/README.md`](packages/unique-pick/README.md) covers the
contract, the rules every game must follow, and starting a game in its own
repo.

**One site or one per game.** A deployment hosts whichever games
`src/games/registry.ts` registers. With several, the create-game screen shows
a picker and every room records which game it plays (`games.game_type`); with
one, the picker disappears and it's a single-game site. Running a game as its
own site is just another deployment of this repo — its own Supabase and
Vercel projects — with only that game registered.

**Branding.** The site's name and tagline live in `src/site.ts` and flow into
the page title, the PWA manifest, the home page and notification fallbacks.
Each game's own name comes from its definition and appears on room cards, in
the lobby and in notifications about that game.

**Rules versions.** Every game records the `rulesVersion` it started with and
always replays under it, so a rules change that would alter existing games
ships as a new version registered alongside the old one (see the game package
README).

## What's not built yet

- **An accessibility pass** (keyboard navigation, contrast, focus states).
- **End-to-end verification of enforcement and redaction in a real
  two-browser session** against a deployed project — the in-process stack
  covers the same checks, but not the real Edge Runtime or a real browser.
- **Ratings/leaderboards.**
