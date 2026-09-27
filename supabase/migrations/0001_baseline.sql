-- Baseline schema
--
-- One migration that builds the whole `public` schema for a fresh Supabase
-- project: rooms and their lifecycle, seated players, the authoritative game
-- state (plus its slim public projection), per-account profiles, Web Push
-- subscriptions and chat.
--
-- The platform is game-agnostic. The database never interprets a game's
-- rules: `game_state.state` is an opaque GameState JSON document written by
-- the rules engine (client-side for a client-trusted game, by the
-- apply-action / undo-action / redo-action / start-game Edge Functions for a
-- rule-enforced one). The only fields SQL ever reads out of it are the
-- generic top-level ones every GameState carries: `status`, `phase`, `turn`
-- and `pendingPlayerIds` (see section 6).
--
-- Written to be safely re-runnable (`if not exists`, `create or replace`,
-- `drop ... if exists` before each trigger/policy, guarded publication adds)
-- so audit-and-fix-migrations.yml can re-apply it over a partially-built
-- schema to restore whatever objects are missing. Note that re-running it
-- does not add a column to a table that already exists.
--
-- Turn/lifecycle/chat notifications are NOT created here: they are Supabase
-- Database Webhooks (triggers calling supabase_functions.http_request) that
-- the "Set Up ... Notifications" workflows register per project via
-- scripts/supabase/register-database-webhook.sh, because they embed a
-- per-project secret.
--
-- Sections:
--    1. Shared helpers
--    2. profiles (display names, admin flag, Discord webhook, preferences)
--    3. games (rooms and their lifecycle)
--    4. players (seats, hotseat local players, config readiness)
--    5. game_state (authoritative state + optimistic-concurrency version)
--    6. game_state_meta (slim public projection of game_state)
--    7. Rule-enforcement lockdown (game_state writes)
--    8. Hidden-information lockdown (game_state reads)
--    9. push_subscriptions (Web Push)
--   10. Chat (app_config kill switch, messages, rate limit, read status,
--       sender display names)
--   11. Realtime publication


-- ===========================================================================
-- 1. Shared helpers
-- ===========================================================================

-- Generic `updated_at` bookkeeping, attached as a BEFORE UPDATE trigger to
-- every table that carries the column and is updated in place.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ===========================================================================
-- 2. profiles
--
-- Per-account settings that are not tied to any one game. Created before
-- the game tables because their admin policies read profiles.is_admin.
--
--   discord_webhook_url  a player's own Discord webhook for "your turn" and
--                        chat notifications. Sent server-side by the
--                        notify-discord-* Edge Functions under the service
--                        role, so no browser ever needs to read another
--                        player's URL: the row is strictly own-row readable.
--   display_name         optional custom name overriding the one derived
--                        from the auth provider. Null = use the provider's
--                        name. Exposed to other users only through
--                        chat_sender_display_names() (section 10).
--   is_admin             grants the admin policies below (delete any room,
--                        read any game state). Nothing in the app sets it;
--                        an admin is granted by hand in the SQL editor:
--
--     insert into public.profiles (user_id, is_admin)
--     values ('<auth-user-id>', true)
--     on conflict (user_id) do update set is_admin = true;
--
--   preferences          free-form per-account UI preferences (jsonb), so a
--                        new simple preference needs no migration.
-- ===========================================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discord_webhook_url text,
  display_name text,
  is_admin boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 40)
);

comment on table public.profiles is
  'Per-account settings not tied to any one game: Discord webhook URL, custom display name, admin flag and a free-form preferences blob. Own-row access only.';
comment on column public.profiles.display_name is
  'Optional custom display name. Null means use the name from the auth provider.';
comment on column public.profiles.is_admin is
  'Grants the admin RLS policies (delete any game, read any game state). Set by hand in SQL; nothing in the app writes it.';
comment on column public.profiles.preferences is
  'Free-form per-account preferences. Add keys here instead of new columns.';

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The own-row insert/update policies below would otherwise let any user
-- grant themselves is_admin. A signed-in PostgREST session (role
-- 'authenticated' or 'anon') may never set or change it; the service role and
-- the SQL editor's own roles still can.
create or replace function public.enforce_profiles_is_admin_unchanged()
returns trigger
language plpgsql
as $$
begin
  if current_setting('role', true) in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.is_admin then
      raise exception 'is_admin can only be granted by an administrator';
    end if;
    if tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin then
      raise exception 'is_admin can only be changed by an administrator';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_is_admin_unchanged on public.profiles;
create trigger profiles_enforce_is_admin_unchanged
  before insert or update on public.profiles
  for each row execute function public.enforce_profiles_is_admin_unchanged();

alter table public.profiles enable row level security;

drop policy if exists "users can read their own profile" on public.profiles;
create policy "users can read their own profile"
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid());


-- ===========================================================================
-- 3. games (rooms and their lifecycle)
--
-- One row per room. `room_code` is the short code/link players join by;
-- `name` is chosen by the owner (created_by) at creation and immutable.
-- `game_type` says which game the room plays (a registered GameDefinition.id,
-- src/games/registry.ts) — opaque to SQL, and immutable like `name`.
-- `visibility = 'public'` lists the room on the Public Rooms screen; a
-- private room is reachable only via its code/link. Every games row is
-- readable by any signed-in user (that is how join-by-code works).
--
-- Lifecycle (games.status): lobby -> active, lobby -> canceled,
-- active -> canceled. Nothing else is a legal transition. A finished game
-- still reads 'active' here — completion lives in game_state.state.status.
-- Only the owner may update the row; the owner may delete it only while it
-- is 'lobby' or 'canceled', an admin may delete it in any state.
--
-- `settings` holds all per-game, creation-time configuration as one jsonb
-- blob (src/lib/dbTypes.ts's GameSettings), so a new pregame option needs no
-- migration. The only keys SQL reads are `ruleEnforcementEnabled` (sections
-- 3 and 7) and `hiddenInformationEnabled` (section 8); both read as false
-- when absent. Editing settings (or the player-count bounds) bumps
-- `config_version`, which players must re-confirm Ready for (section 4).
-- ===========================================================================

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  name text not null,
  game_type text not null,
  play_mode text not null check (play_mode in ('live', 'async', 'hotseat')),
  status text not null default 'lobby',
  visibility text not null default 'private' check (visibility in ('public', 'private')),
  min_players int not null default 2,
  max_players int not null default 4,
  settings jsonb not null default '{}'::jsonb,
  config_version int not null default 0,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_status_check check (status in ('lobby', 'active', 'completed', 'canceled')),
  constraint games_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint games_game_type_format check (game_type ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);

comment on table public.games is
  'One row per room. room_code is the short code players use to join; name is owner-chosen and immutable.';
comment on column public.games.name is
  'Owner-chosen at creation, immutable afterward (games_enforce_name_immutable trigger, which also guards game_type).';
comment on column public.games.game_type is
  'Which game the room plays: a GameDefinition.id registered in the app (src/games/registry.ts). Immutable (games_enforce_name_immutable trigger).';
comment on column public.games.visibility is
  'public rooms are listed on the Public Rooms screen; private rooms are reachable only via their room code/link. Owner-only to change.';
comment on column public.games.settings is
  'Per-game, creation-time configuration (src/lib/dbTypes.ts GameSettings). Add new keys here instead of new columns. SQL reads only ruleEnforcementEnabled and hiddenInformationEnabled (absent = false). A running game reads its settings off GameState, not this column.';
comment on column public.games.config_version is
  'Bumped by games_bump_config_version whenever settings or the player-count bounds change. A player is ready iff their ready_for_version matches this.';

-- Speeds up the Public Rooms listing without indexing the (much more
-- common) private rows.
create index if not exists games_public_idx
  on public.games (updated_at desc)
  where visibility = 'public';

drop trigger if exists games_set_updated_at on public.games;
create trigger games_set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

-- Room name and game type are immutable once created.
create or replace function public.enforce_game_name_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.game_type is distinct from new.game_type then
    raise exception 'A room''s game cannot be changed after creation';
  end if;
  raise exception 'Room name cannot be changed after creation';
end;
$$;

drop trigger if exists games_enforce_name_immutable on public.games;
create trigger games_enforce_name_immutable
  before update on public.games
  for each row
  when (old.name is distinct from new.name or old.game_type is distinct from new.game_type)
  execute function public.enforce_game_name_immutable();

-- Legal status transitions, enforced whichever client/policy is writing.
--
-- Start-game lockdown: for a rule-enforced game (settings.
-- ruleEnforcementEnabled) the lobby -> active flip may only be made by the
-- start-game Edge Function, which builds and inserts the genesis game_state
-- itself under the service role. This can't be a plain RLS policy — a WITH
-- CHECK clause only sees the new row, and the owner must still be able to
-- make other updates to an already-active row — so it lives in this trigger,
-- which sees both old and new. current_setting('role') is 'service_role'
-- for the Edge Functions' service-role client and 'authenticated' for an
-- ordinary signed-in PostgREST session. The matching game_state INSERT
-- lockdown is in section 7.
create or replace function public.enforce_game_status_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if (old.status, new.status) not in (
    ('lobby', 'active'),
    ('lobby', 'canceled'),
    ('active', 'canceled')
  ) then
    raise exception 'Invalid room status transition: % -> %', old.status, new.status;
  end if;

  if old.status = 'lobby' and new.status = 'active'
     and coalesce((new.settings ->> 'ruleEnforcementEnabled')::boolean, false)
     and current_setting('role') <> 'service_role' then
    raise exception 'An enforced game can only be started via the start-game Edge Function.';
  end if;

  return new;
end;
$$;

drop trigger if exists games_enforce_status_transition on public.games;
create trigger games_enforce_status_transition
  before update on public.games
  for each row
  when (old.status is distinct from new.status)
  execute function public.enforce_game_status_transition();

-- Editing settings or the player-count bounds is only allowed pre-start, and
-- bumps config_version so every player has to re-confirm Ready.
create or replace function public.bump_config_version_on_settings_change()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'lobby' then
    raise exception 'Configuration can only change while the room is Active - Not Started';
  end if;
  new.config_version = old.config_version + 1;

  return new;
end;
$$;

drop trigger if exists games_bump_config_version on public.games;
create trigger games_bump_config_version
  before update on public.games
  for each row
  when (
    old.settings is distinct from new.settings
    or old.min_players is distinct from new.min_players
    or old.max_players is distinct from new.max_players
  )
  execute function public.bump_config_version_on_settings_change();

alter table public.games enable row level security;

drop policy if exists "games are readable by any signed-in user" on public.games;
create policy "games are readable by any signed-in user"
  on public.games for select
  to authenticated
  using (true);

drop policy if exists "signed-in users can create a game" on public.games;
create policy "signed-in users can create a game"
  on public.games for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "room owner can update their game" on public.games;
create policy "room owner can update their game"
  on public.games for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "room owner can delete their room in a deletable state" on public.games;
create policy "room owner can delete their room in a deletable state"
  on public.games for delete
  to authenticated
  using (created_by = auth.uid() and status in ('lobby', 'canceled'));

-- Additive to the owner policy above (permissive policies are OR'd).
drop policy if exists "admins can delete any game" on public.games;
create policy "admins can delete any game"
  on public.games for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin
    )
  );


-- ===========================================================================
-- 4. players
--
-- One row per seat. Identity comes from auth.users. There is deliberately
-- no unique (game_id, user_id): in hotseat mode one signed-in host seats
-- several local players under their own user_id and passes the device;
-- unique (game_id, seat_index) still keeps seats distinct. A user may
-- delete their own player rows (e.g. the host removing a local player
-- before the game starts).
--
-- Readiness: `ready_for_version` is the games.config_version this player
-- last confirmed Ready for. It is set automatically on insert (a new player
-- is implicitly ready for the config as it stood when they joined), and a
-- player may only ever mark themselves ready for the room's *current*
-- config_version. The owner's exemption from readiness is client-side.
-- ===========================================================================

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  display_name text not null,
  avatar_url text,
  seat_index int not null,
  color text not null,
  is_active boolean not null default true,
  ready_for_version int not null default 0,
  joined_at timestamptz not null default now(),
  unique (game_id, seat_index)
);

comment on table public.players is
  'One row per seated player. Identity comes from auth.users; in hotseat mode several seats can share one user_id (one signed-in host, several local players passing the device).';
comment on column public.players.ready_for_version is
  'The games.config_version this player last confirmed Ready for. Set automatically on insert to the game''s current config_version.';

create or replace function public.set_initial_ready_for_version()
returns trigger
language plpgsql
as $$
begin
  select config_version into new.ready_for_version
  from public.games
  where id = new.game_id;

  return new;
end;
$$;

drop trigger if exists players_set_initial_ready_for_version on public.players;
create trigger players_set_initial_ready_for_version
  before insert on public.players
  for each row
  execute function public.set_initial_ready_for_version();

create or replace function public.enforce_ready_for_version()
returns trigger
language plpgsql
as $$
declare
  current_version int;
begin
  select config_version into current_version
  from public.games
  where id = new.game_id;

  if new.ready_for_version <> current_version then
    raise exception 'ready_for_version must match the room''s current config_version (%), got %', current_version, new.ready_for_version;
  end if;

  return new;
end;
$$;

drop trigger if exists players_enforce_ready_for_version on public.players;
create trigger players_enforce_ready_for_version
  before update on public.players
  for each row
  when (old.ready_for_version is distinct from new.ready_for_version)
  execute function public.enforce_ready_for_version();

alter table public.players enable row level security;

-- Readable by anyone signed in (the lobby roster is shown before joining).
drop policy if exists "players are readable by any signed-in user" on public.players;
create policy "players are readable by any signed-in user"
  on public.players for select
  to authenticated
  using (true);

drop policy if exists "users can seat themselves" on public.players;
create policy "users can seat themselves"
  on public.players for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users can update their own player row" on public.players;
create policy "users can update their own player row"
  on public.players for update
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can delete their own player row" on public.players;
create policy "users can delete their own player row"
  on public.players for delete
  to authenticated
  using (user_id = auth.uid());


-- ===========================================================================
-- 5. game_state
--
-- The single source of truth for a running game: the full GameState JSON
-- (current state = genesis replayed through its append-only action
-- history). Stored either as plain JSON, or compressed as
-- {"__gz": <gzip+base64>, ...} with the generic top-level fields (status,
-- phase, turn, pendingPlayerIds, activePlayerId, turnOrder) duplicated in
-- plaintext so section 6's trigger can still read them.
--
-- `version` is incremented on every write and used for optimistic
-- concurrency (compare-and-swap: read version, write `where version =
-- <expected>`), both by client-trusted writers and by the Edge Functions.
--
-- Who may read/write it is decided in sections 7 and 8.
-- ===========================================================================

create table if not exists public.game_state (
  game_id uuid primary key references public.games (id) on delete cascade,
  state jsonb not null,
  turn int not null default 0,
  active_player_id uuid references public.players (id),
  version int not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.game_state is
  'Single source of truth for a game''s full GameState JSON (plain, or gzip+base64 under __gz with generic fields duplicated in plaintext). Written only with rules-engine output.';
comment on column public.game_state.version is
  'Incremented on every write; the optimistic-concurrency (compare-and-swap) token.';

drop trigger if exists game_state_set_updated_at on public.game_state;
create trigger game_state_set_updated_at
  before update on public.game_state
  for each row execute function public.set_updated_at();

alter table public.game_state enable row level security;


-- ===========================================================================
-- 6. game_state_meta
--
-- Slim public projection of game_state: status/phase/turn/version plus who
-- is owed a move. Listing screens read it instead of the full state blob,
-- and it is the Realtime "something changed, refetch your view" signal for
-- games whose game_state row can't be broadcast as-is (section 8). It never
-- carries hidden information: only which players still have to act, never
-- what anyone chose.
--
-- Written only by the security-definer game_state_sync_meta trigger on
-- every game_state insert/update; `authenticated` has no write policy.
-- ===========================================================================

create table if not exists public.game_state_meta (
  game_id uuid primary key references public.games (id) on delete cascade,
  status text not null,
  phase text,
  turn int not null default 0,
  version int not null default 0,
  pending_player_ids jsonb not null default '[]'::jsonb,
  active_player_id uuid references public.players (id),
  updated_at timestamptz not null default now()
);

comment on table public.game_state_meta is
  'Slim public projection of game_state (status/phase/turn/version/pending players). Kept in sync by the game_state_sync_meta trigger; never written directly.';
comment on column public.game_state_meta.phase is
  'state.phase: the game''s own phase label, opaque to SQL. Null when the game has none.';
comment on column public.game_state_meta.pending_player_ids is
  'state.pendingPlayerIds while the game is active (every player still owed a move, e.g. during a simultaneous phase), [] otherwise. Kept in sync by game_state_sync_meta.';
comment on column public.game_state_meta.active_player_id is
  'Mirrors game_state.active_player_id (whose turn it is in a turn-order phase). Never hidden information. Kept in sync by game_state_sync_meta.';

-- security definer: the writing role (`authenticated`, or the Edge
-- Functions' service role) needs no grant on game_state_meta itself.
create or replace function public.game_state_sync_meta()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_pending jsonb;
begin
  -- status should always be present; fall back rather than fail the write.
  v_status := coalesce(new.state ->> 'status', 'unknown');

  if v_status = 'active' and jsonb_typeof(new.state -> 'pendingPlayerIds') = 'array' then
    v_pending := new.state -> 'pendingPlayerIds';
  else
    v_pending := '[]'::jsonb;
  end if;

  insert into public.game_state_meta (game_id, status, phase, turn, version, pending_player_ids, active_player_id, updated_at)
  values (
    new.game_id,
    v_status,
    new.state ->> 'phase',
    coalesce((new.state ->> 'turn')::int, 0),
    new.version,
    v_pending,
    new.active_player_id,
    now()
  )
  on conflict (game_id) do update set
    status = excluded.status,
    phase = excluded.phase,
    turn = excluded.turn,
    version = excluded.version,
    pending_player_ids = excluded.pending_player_ids,
    active_player_id = excluded.active_player_id,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists game_state_sync_meta on public.game_state;
create trigger game_state_sync_meta
  after insert or update on public.game_state
  for each row execute function public.game_state_sync_meta();

alter table public.game_state_meta enable row level security;

-- Same audience game_state has for a game without hidden information:
-- seated players, any signed-in user once the game has left the lobby, or
-- an admin. Deliberately NOT narrowed by hiddenInformationEnabled — nothing
-- here is secret.
drop policy if exists "seated players and viewers of started games can read meta" on public.game_state_meta;
create policy "seated players and viewers of started games can read meta"
  on public.game_state_meta for select
  to authenticated
  using (
    exists (
      select 1 from public.players
      where players.game_id = game_state_meta.game_id
        and players.user_id = auth.uid()
    )
    or exists (
      select 1 from public.games
      where games.id = game_state_meta.game_id
        and games.status <> 'lobby'
    )
  );

drop policy if exists "admins can read any game state meta" on public.game_state_meta;
create policy "admins can read any game state meta"
  on public.game_state_meta for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin
    )
  );


-- ===========================================================================
-- 7. Rule-enforcement lockdown (game_state writes)
--
-- Per-game opt-in via games.settings.ruleEnforcementEnabled (absent =
-- false). A client-trusted game is written directly by its seated players'
-- clients. A rule-enforced game's game_state is service-role-write-only:
-- the genesis insert comes from the start-game Edge Function (see also the
-- lobby -> active guard in section 3), every later write from
-- apply-action / undo-action / redo-action. The service role bypasses RLS,
-- so those functions are unaffected by these policies.
--
-- These replace, rather than add to, a plain "seated players can write"
-- policy: permissive policies are OR'd, so an extra policy could only ever
-- widen access.
-- ===========================================================================

drop policy if exists "seated players can insert game state when enforcement is off" on public.game_state;
create policy "seated players can insert game state when enforcement is off"
  on public.game_state for insert
  to authenticated
  with check (
    exists (
      select 1 from public.players
      where players.game_id = game_state.game_id
        and players.user_id = auth.uid()
    )
    and not coalesce(
      (select (games.settings ->> 'ruleEnforcementEnabled')::boolean from public.games where games.id = game_state.game_id),
      false
    )
  );

drop policy if exists "seated players can update game state when enforcement is off" on public.game_state;
create policy "seated players can update game state when enforcement is off"
  on public.game_state for update
  to authenticated
  using (
    exists (
      select 1 from public.players
      where players.game_id = game_state.game_id
        and players.user_id = auth.uid()
    )
    and not coalesce(
      (select (games.settings ->> 'ruleEnforcementEnabled')::boolean from public.games where games.id = game_state.game_id),
      false
    )
  );


-- ===========================================================================
-- 8. Hidden-information lockdown (game_state reads)
--
-- A game without hidden information: its game_state is readable by its
-- seated players, and by any signed-in user once it has left the lobby.
--
-- A game with games.settings.hiddenInformationEnabled (only ever set
-- alongside ruleEnforcementEnabled) loses direct SELECT for everyone,
-- seated players included: RLS is row-granular and this one row holds
-- every seat's secrets at once, so there is no USING clause that hands a
-- player their own secrets without everyone else's. Such games are read
-- through the get-game-state Edge Function (service role), which redacts
-- per viewer; clients follow changes via game_state_meta (section 6).
--
-- Admins keep full access through the separate additive policy below.
-- ===========================================================================

drop policy if exists "read game state when hidden information is off" on public.game_state;
create policy "read game state when hidden information is off"
  on public.game_state for select
  to authenticated
  using (
    not coalesce(
      (select (games.settings ->> 'hiddenInformationEnabled')::boolean from public.games where games.id = game_state.game_id),
      false
    )
    and (
      exists (
        select 1 from public.players
        where players.game_id = game_state.game_id
          and players.user_id = auth.uid()
      )
      or exists (
        select 1 from public.games
        where games.id = game_state.game_id
          and games.status <> 'lobby'
      )
    )
  );

drop policy if exists "admins can read any game state" on public.game_state;
create policy "admins can read any game state"
  on public.game_state for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.user_id = auth.uid()
        and profiles.is_admin
    )
  );


-- ===========================================================================
-- 9. push_subscriptions
--
-- Web Push subscriptions, one row per browser/device (a user may have
-- several), keyed by the endpoint the browser's PushManager returns.
-- Notifications are sent by the notify-web-push* Edge Functions under the
-- service role, so users only ever read or manage their own rows.
-- ===========================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'Web Push subscriptions (one per browser/device) used to send notifications server-side.';

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "users can read their own push subscriptions" on public.push_subscriptions;
create policy "users can read their own push subscriptions"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can insert their own push subscriptions" on public.push_subscriptions;
create policy "users can insert their own push subscriptions"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users can delete their own push subscriptions" on public.push_subscriptions;
create policy "users can delete their own push subscriptions"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());


-- ===========================================================================
-- 10. Chat
--
-- Site-wide chat (chat_messages.game_id null) and per-game chat (game_id
-- set) share one table. Everything is gated end-to-end in RLS by the
-- app_config.chat_enabled kill switch — a DB row rather than a build-time
-- env var because RLS can't see an env var, and a row can be flipped per
-- project without a redeploy. The row is seeded `false`; pre-production
-- turns it on automatically (scripts/supabase/set-chat-enabled.sh from
-- deploy-supabase.yml), production only by a hand-run
-- `update public.app_config set chat_enabled = true;`.
-- ===========================================================================

-- --- app_config: site-wide singleton, holds the chat kill switch ----------

create table if not exists public.app_config (
  id boolean primary key default true check (id),
  chat_enabled boolean not null default false
);

comment on table public.app_config is
  'Site-wide config, exactly one row (id is always true). chat_enabled is the chat kill switch. No write policy exists, so nothing in the app can flip it — only hand-run SQL or the pre-production deploy step. Defaults false.';

insert into public.app_config (id, chat_enabled)
values (true, false)
on conflict (id) do nothing;

alter table public.app_config enable row level security;

-- Read-only to clients (they need it to decide whether to render chat).
-- Deliberately no insert/update/delete policy.
drop policy if exists "anyone can read app_config" on public.app_config;
create policy "anyone can read app_config"
  on public.app_config for select
  to authenticated
  using (true);

-- security definer so chat policies can call it without depending on the
-- caller's own access to app_config.
create or replace function public.chat_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select chat_enabled from public.app_config limit 1
$$;

-- --- chat_messages --------------------------------------------------------

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  game_id uuid references public.games (id) on delete cascade,
  sender_id uuid not null references auth.users (id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is
  'One row per chat message. game_id null = site-wide chat; set = that game''s chat. Append-only (no update/delete policy). Gated end-to-end by chat_enabled().';

create index if not exists chat_messages_game_id_created_at_idx
  on public.chat_messages (game_id, created_at);

-- Serves the rate-limit trigger's per-sender lookup.
create index if not exists chat_messages_sender_id_created_at_idx
  on public.chat_messages (sender_id, created_at);

alter table public.chat_messages enable row level security;

-- Site-wide: any signed-in user may read.
drop policy if exists "read site-wide chat" on public.chat_messages;
create policy "read site-wide chat"
  on public.chat_messages for select
  to authenticated
  using (game_id is null and public.chat_enabled());

-- In-game: seated players, plus any signed-in visitor of a public room.
drop policy if exists "read game chat" on public.chat_messages;
create policy "read game chat"
  on public.chat_messages for select
  to authenticated
  using (
    game_id is not null
    and public.chat_enabled()
    and exists (
      select 1 from public.games
      where games.id = chat_messages.game_id
        and (
          games.visibility = 'public'
          or exists (
            select 1 from public.players
            where players.game_id = games.id and players.user_id = auth.uid()
          )
        )
    )
  );

-- Posting: site-wide needs only a session; in-game needs a seat. A public
-- room's non-seated visitor can read that game's chat but not post to it.
drop policy if exists "post chat" on public.chat_messages;
create policy "post chat"
  on public.chat_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.chat_enabled()
    and (
      game_id is null
      or exists (
        select 1 from public.players
        where players.game_id = chat_messages.game_id and players.user_id = auth.uid()
      )
    )
  );

-- Rate limit: at most 10 messages per sender per trailing 10 seconds,
-- site-wide and in-game combined (so switching channels can't dodge it).
-- A trigger rather than an RLS clause so the rejection is a readable
-- exception instead of a generic RLS violation.
create or replace function public.chat_messages_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.chat_messages
  where sender_id = new.sender_id
    and created_at > now() - interval '10 seconds';

  if recent_count >= 10 then
    raise exception 'You are sending messages too fast. Wait a few seconds and try again.';
  end if;

  return new;
end;
$$;

comment on function public.chat_messages_rate_limit() is
  'Chat flood defense: rejects an insert once its sender has posted 10+ messages (site-wide and in-game combined) in the trailing 10 seconds.';

drop trigger if exists chat_messages_rate_limit_trigger on public.chat_messages;
create trigger chat_messages_rate_limit_trigger
  before insert on public.chat_messages
  for each row execute function public.chat_messages_rate_limit();

-- --- chat_read_status: per-user, per-game unread cursor -------------------
--
-- In-game chat only (game_id is never null). last_read_id is a cursor into
-- chat_messages.id (strictly increasing identity), not a timestamp, so
-- clock skew can't affect it.

create table if not exists public.chat_read_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  last_read_id bigint not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.chat_read_status is
  'How far each user has read one game''s chat (in-game chat only). last_read_id is a cursor into chat_messages.id. One row per (user, game).';

create unique index if not exists chat_read_status_game_uidx
  on public.chat_read_status (user_id, game_id);

alter table public.chat_read_status enable row level security;

drop policy if exists "read own chat read status" on public.chat_read_status;
create policy "read own chat read status"
  on public.chat_read_status for select
  to authenticated
  using (user_id = auth.uid());

-- Only for a game whose chat the user could read in the first place.
drop policy if exists "insert own chat read status" on public.chat_read_status;
create policy "insert own chat read status"
  on public.chat_read_status for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.chat_enabled()
    and exists (
      select 1 from public.games
      where games.id = chat_read_status.game_id
        and (
          games.visibility = 'public'
          or exists (
            select 1 from public.players
            where players.game_id = games.id and players.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "update own chat read status" on public.chat_read_status;
create policy "update own chat read status"
  on public.chat_read_status for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No delete policy: rows go away with their game via on delete cascade.

-- --- chat_sender_display_names: name lookup for site-wide chat ------------
--
-- Site-wide chat has no seats to take a sender's name from, and profiles is
-- own-row-only (RLS is row-scoped, so widening it would expose
-- discord_webhook_url too). This security-definer function exposes only
-- (user_id, display_name), and only to signed-in callers.

create or replace function public.chat_sender_display_names(sender_ids uuid[])
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select profiles.user_id, profiles.display_name
  from public.profiles
  where profiles.user_id = any(sender_ids)
    and profiles.display_name is not null
$$;

comment on function public.chat_sender_display_names(uuid[]) is
  'Chat name lookup: exposes only (user_id, display_name) to any signed-in caller, deliberately narrower than the profiles row so discord_webhook_url stays owner-only.';

-- New functions are executable by PUBLIC (incl. anon) by default.
revoke all on function public.chat_sender_display_names(uuid[]) from public;
grant execute on function public.chat_sender_display_names(uuid[]) to authenticated;


-- ===========================================================================
-- 11. Realtime publication
--
-- Guarded so re-running doesn't fail with "relation is already member of
-- publication". game_state is published for games without hidden
-- information; hidden-information games are followed via game_state_meta.
-- ===========================================================================

do $$
declare
  t text;
begin
  foreach t in array array['games', 'players', 'game_state', 'game_state_meta', 'chat_messages'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
