-- Seenzo movie performance votes.
-- Separate from episode performance_votes. Clients never write this table
-- directly. Votes go through the movie-performance-vote Edge Function, which
-- checks auth, watched movie state in media_entries, and Trakt movie cast.
-- Aggregates stay on movie_performance_vote_stats.

create table public.movie_performance_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  movie_trakt_id bigint not null,
  person_trakt_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint movie_performance_votes_user_movie_key unique (user_id, movie_trakt_id),
  constraint movie_performance_votes_movie_id_check check (movie_trakt_id > 0),
  constraint movie_performance_votes_person_id_check check (person_trakt_id > 0)
);

create index movie_performance_votes_movie_idx
  on public.movie_performance_votes (movie_trakt_id);

create trigger set_movie_performance_votes_updated_at
  before update on public.movie_performance_votes
  for each row execute function public.set_updated_at();

revoke all on table public.movie_performance_votes from public, anon, authenticated;
grant select, insert, update, delete on table public.movie_performance_votes to service_role;

alter table public.movie_performance_votes enable row level security;

-- No policies for anon/authenticated: table DML is service_role only via Edge Function.

create or replace function public.movie_performance_vote_stats(
  p_movie_trakt_id bigint
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
    from public.movie_performance_votes as votes
    where votes.movie_trakt_id = p_movie_trakt_id
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

revoke all on function public.movie_performance_vote_stats(bigint) from public;
grant execute on function public.movie_performance_vote_stats(bigint) to anon, authenticated, service_role;

comment on table public.movie_performance_votes is
  'Per-user best performance votes for movies. Writes only via movie-performance-vote Edge Function; aggregates via movie_performance_vote_stats.';

comment on function public.movie_performance_vote_stats(bigint) is
  'Aggregate vote counts for a movie. Never returns other users identities.';
