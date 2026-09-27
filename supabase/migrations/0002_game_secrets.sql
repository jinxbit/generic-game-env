-- game_secrets: per-game values only the server may read
--
-- A game's rules may draw random numbers (a die roll, a card dealt). The
-- numbers a move draws are recorded in its log entry so every client can
-- replay the game without rolling again (packages/sdk/src/random.ts), but
-- the numbers still to come must stay unpredictable, so a rule-enforced
-- game's draws are derived from a seed no player can read. This table holds
-- that seed.
--
-- RLS is on and there is deliberately no policy at all, so neither `anon`
-- nor `authenticated` can select, insert, update or delete a row; the
-- grants are revoked too, so that stays true even if a policy is added by
-- mistake later. Only the Edge Functions' service role reads and writes it
-- (loadRandomSeed in supabase/functions/_shared/gameEnforcement.ts, which
-- creates a game's row the first time it needs one — at Start, or on the
-- first move of a room that was copied rather than started).
--
-- Not in the Realtime publication: nothing here is ever broadcast.
--
-- Re-runnable, like the baseline, for audit-and-fix-migrations.yml.

create table if not exists public.game_secrets (
  game_id uuid primary key references public.games (id) on delete cascade,
  random_seed text not null,
  created_at timestamptz not null default now()
);

comment on table public.game_secrets is
  'Server-only per-game secrets (the seed a rule-enforced game''s random draws derive from). RLS on with no policies: only the service role can touch it.';
comment on column public.game_secrets.random_seed is
  '128 random bits as hex, rolled once by the Edge Functions. Never sent to a client.';

alter table public.game_secrets enable row level security;
revoke all on table public.game_secrets from anon, authenticated;
