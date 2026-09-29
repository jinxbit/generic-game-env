-- game_assets: reusable things a game can start from (a saved map, say)
--
-- An asset is a named payload of some kind a game defines
-- (GameDefinition.assetKinds, packages/sdk/src/gameDefinition.ts) — for Rise
-- & Fall, kind 'map', a terrain-only board. The platform never reads `data`:
-- it stores, lists and copies it, and the game validates it
-- (AssetKind.normalize) wherever it's used. `min_players`/`max_players` are
-- the game's own AssetKind.playerRange of the payload, kept as columns so a
-- picker (and start-game's random pick) can filter by the seated count in
-- SQL.
--
-- Visibility: 'private' assets are their creator's own; 'public' ones are
-- readable by every signed-in user and are the pool "a random <kind>" is
-- drawn from at Start. Only an admin may publish (insert or update to
-- 'public'), so the random pool is curated.
--
-- games.assets: the assets a room was set up with, keyed by kind —
--   { "<kind>": { "mode": "chosen", "assetId": ..., "name": ..., "data": ... } }
--   { "<kind>": { "mode": "random" } }            until Start resolves it,
--   { "<kind>": { "mode": "random", "assetId": ..., "name": ..., "data": ... } } after.
-- The payload is COPIED into the room rather than referenced by id, so a
-- room's genesis stays a function of its own row (src/lib/gameGenesis.ts):
-- editing or deleting the asset later can't change a game already set up.
-- It's a column of its own, not a key of `settings`, so the game-listing
-- queries (gameApi.ts's GAME_LIST_COLUMNS) never carry a whole board per
-- room. Like `settings`, it may only change in the lobby and a change bumps
-- config_version, so players re-confirm Ready — games_bump_config_version
-- is re-created below to watch it too.
--
-- Re-runnable, like the baseline, for audit-and-fix-migrations.yml.

create table if not exists public.game_assets (
  id uuid primary key default gen_random_uuid(),
  game_type text not null,
  kind text not null,
  name text not null,
  visibility text not null default 'private',
  min_players int not null,
  max_players int not null,
  data jsonb not null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_assets_game_type_format check (game_type ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint game_assets_kind_format check (kind ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint game_assets_name_length check (char_length(name) between 1 and 80),
  constraint game_assets_visibility_check check (visibility in ('private', 'public')),
  constraint game_assets_player_range check (min_players >= 1 and max_players >= min_players),
  constraint game_assets_data_size check (octet_length(data::text) <= 262144)
);

comment on table public.game_assets is
  'Reusable payloads a game can start from (a saved map, ...), of a kind the game defines. data is opaque to the platform. Public ones are the pool random picks draw from.';

create index if not exists game_assets_lookup_idx on public.game_assets (game_type, kind, visibility);

drop trigger if exists game_assets_set_updated_at on public.game_assets;
create trigger game_assets_set_updated_at
  before update on public.game_assets
  for each row execute function public.set_updated_at();

alter table public.game_assets enable row level security;

drop policy if exists "read public game assets and your own" on public.game_assets;
create policy "read public game assets and your own"
  on public.game_assets for select
  to authenticated
  using (
    visibility = 'public'
    or created_by = auth.uid()
    or exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin)
  );

drop policy if exists "create your own game assets, public only as an admin" on public.game_assets;
create policy "create your own game assets, public only as an admin"
  on public.game_assets for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      visibility = 'private'
      or exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin)
    )
  );

drop policy if exists "update your own game assets, public only as an admin" on public.game_assets;
create policy "update your own game assets, public only as an admin"
  on public.game_assets for update
  to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin)
  )
  with check (
    (created_by = auth.uid() and visibility = 'private')
    or exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin)
  );

drop policy if exists "delete your own game assets, or any as an admin" on public.game_assets;
create policy "delete your own game assets, or any as an admin"
  on public.game_assets for delete
  to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.profiles where profiles.user_id = auth.uid() and profiles.is_admin)
  );

-- ---------------------------------------------------------------------------
-- games.assets

alter table public.games add column if not exists assets jsonb not null default '{}'::jsonb;

comment on column public.games.assets is
  'The assets this room was set up with, by kind: a copied payload ({mode: chosen|random, assetId, name, data}) or {mode: random} until Start picks one. Lobby-only, bumps config_version.';

drop trigger if exists games_bump_config_version on public.games;
create trigger games_bump_config_version
  before update on public.games
  for each row
  when (
    old.settings is distinct from new.settings
    or old.assets is distinct from new.assets
    or old.min_players is distinct from new.min_players
    or old.max_players is distinct from new.max_players
  )
  execute function public.bump_config_version_on_settings_change();
