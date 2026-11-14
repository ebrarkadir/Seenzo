-- Seenzo episode performance votes.
-- Clients never write this table directly. Votes go through the
-- performance-vote Edge Function, which checks auth, watched state,
-- and Trakt episode credits. Aggregates stay on performance_vote_stats.

create table public.performance_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  show_trakt_id bigint not null,
  season_number integer not null,
  episode_number integer not null,
  person_trakt_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_votes_user_episode_key unique (user_id, show_trakt_id, season_number, episode_number),
  constraint performance_votes_show_id_check check (show_trakt_id > 0),
  constraint performance_votes_person_id_check check (person_trakt_id > 0),
  constraint performance_votes_season_check check (season_number >= 0),
  constraint performance_votes_episode_check check (episode_number >= 1)
);

create index performance_votes_episode_idx
  on public.performance_votes (show_trakt_id, season_number, episode_number);

create trigger set_performance_votes_updated_at
  before update on public.performance_votes
  for each row execute function public.set_updated_at();

revoke all on table public.performance_votes from public, anon, authenticated;
grant select, insert, update, delete on table public.performance_votes to service_role;

alter table public.performance_votes enable row level security;

-- No policies for anon/authenticated: table DML is service_role only via Edge Function.
-- Defense in depth if grants are ever widened.

create or replace function public.performance_vote_stats(
  p_show_trakt_id bigint,
  p_season_number integer,
  p_episode_number integer
)
returns table (
  person_trakt_id bigint,
  vote_count bigint,
  total_votes bigint,
  my_person_trakt_id bigint
)
language sql
security definer
set search_path = ''
as $$
  with scoped as (
    select votes.person_trakt_id, votes.user_id
    from public.performance_votes as votes
    where votes.show_trakt_id = p_show_trakt_id
      and votes.season_number = p_season_number
      and votes.episode_number = p_episode_number
  ),
  counted as (
    select scoped.person_trakt_id, count(*)::bigint as vote_count
    from scoped
    group by scoped.person_trakt_id
  ),
  totals as (
    select coalesce((select sum(counted.vote_count) from counted), 0)::bigint as total_votes
  ),
  mine as (
    select scoped.person_trakt_id
    from scoped
    where scoped.user_id = (select auth.uid())
    limit 1
  )
  select
    counted.person_trakt_id,
    counted.vote_count,
    totals.total_votes,
    mine.person_trakt_id as my_person_trakt_id
  from totals
  left join counted on totals.total_votes > 0
  left join mine on true
  where totals.total_votes = 0
     or counted.person_trakt_id is not null;
$$;

revoke all on function public.performance_vote_stats(bigint, integer, integer) from public;
grant execute on function public.performance_vote_stats(bigint, integer, integer) to anon, authenticated, service_role;

comment on table public.performance_votes is
  'Per-user best performance votes. Writes only via performance-vote Edge Function; aggregates via performance_vote_stats.';

comment on function public.performance_vote_stats(bigint, integer, integer) is
  'Aggregate vote counts for an episode. Never returns other users identities.';
