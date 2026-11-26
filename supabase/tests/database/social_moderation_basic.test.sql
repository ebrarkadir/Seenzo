-- Security Phase 4 moderation gates (pgTAP). Do not run against production.
begin;
select plan(17);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com')
on conflict (id) do nothing;

insert into public.profiles (
  user_id, username, display_name, is_public, allow_profile_discovery, share_activity_with_followers
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, true, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, true, true)
on conflict (user_id) do update
set username = excluded.username,
    is_public = true,
    allow_profile_discovery = true,
    share_activity_with_followers = true;

insert into public.profile_follows (follower_id, following_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
on conflict do nothing;

insert into public.social_activity_events (
  id, actor_id, activity_type, media_type, media_id, rating, created_at
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie_rated',
  'movie',
  'trakt-movie-701',
  8,
  now() - interval '1 hour'
)
on conflict (id) do nothing;

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'movie',
  'trakt-movie-701',
  'Moderation fixture review',
  false
)
on conflict do nothing;

insert into public.social_review_comments (
  id, activity_id, author_id, comment_text, contains_spoilers
)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Fixture comment',
  false
)
on conflict (id) do nothing;

insert into public.social_content_reports (
  id, reporter_id, target_type, target_id, reason
)
values (
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'social_activity',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'spam'
)
on conflict do nothing;

select ok(
  (select relrowsecurity from pg_class where oid = 'public.moderation_actions'::regclass),
  'moderation_actions has RLS'
);

select ok(
  (
    select count(*) = 0
    from pg_policies
    where schemaname = 'public' and tablename = 'moderation_actions'
  ),
  'moderation_actions has no authenticated policies'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
set local request.jwt.claim.role = 'authenticated';

select throws_ok(
  $$select public.moderate_hide_social_activity(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'attacker@example.com',
      'nope'
    )$$,
  '42501',
  'authenticated cannot execute moderate_hide_social_activity'
);

select throws_ok(
  $$select public.list_moderation_reports('open', 10, 0)$$,
  '42501',
  'authenticated cannot list moderation reports'
);

select throws_ok(
  $$insert into public.moderation_actions (
      operator_label, action, target_type, target_id
    ) values (
      'attacker@example.com', 'hide_activity', 'social_activity',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    )$$,
  '42501',
  'authenticated cannot insert audit rows'
);

select lives_ok(
  $$select public.get_review_interaction_summary('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  'follower can open discussion before hide'
);

reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';

select lives_ok(
  $$select public.moderate_hide_social_activity(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ops@seenzo.example',
      'fixture hide'
    )$$,
  'service_role can hide activity'
);

select results_eq(
  $$select count(*)::int from public.moderation_actions
    where action = 'hide_activity'
      and target_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'$$,
  array[1],
  'hide writes audit row'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
set local request.jwt.claim.role = 'authenticated';

select results_eq(
  $$select count(*)::int from public.list_following_activity(20, null, null)
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'$$,
  array[0],
  'hidden activity absent from feed'
);

select throws_ok(
  $$select public.get_review_interaction_summary('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  'P0001',
  'activity_unavailable',
  'discussion summary rejects hidden activity'
);

select throws_ok(
  $$select public.resolve_review_discussion_target(
      'social_activity',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
    )$$,
  'P0001',
  'activity_unavailable',
  'notification deep link cannot open hidden activity'
);

select throws_ok(
  $$select public.report_social_content(
      'social_activity',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'spam'
    )$$,
  'P0001',
  'activity_unavailable',
  'cannot report already-hidden activity'
);

reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';

select lives_ok(
  $$select public.moderate_hide_review_comment(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'ops@seenzo.example',
      'hide comment fixture',
      true
    )$$,
  'service_role can hide comment'
);

select lives_ok(
  $$select public.moderate_review_report(
      'cccccccc-cccc-cccc-cccc-ccccccccccc1',
      'actioned',
      'ops@seenzo.example',
      'hidden activity'
    )$$,
  'service_role can triage report'
);

select results_eq(
  $$select status from public.social_content_reports
    where id = 'cccccccc-cccc-cccc-cccc-ccccccccccc1'$$,
  array['actioned'::text],
  'report status transitions to actioned'
);

select lives_ok(
  $$select public.moderate_unhide_social_activity(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'ops@seenzo.example',
      'restore'
    )$$,
  'service_role can unhide activity'
);

set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
set local request.jwt.claim.role = 'authenticated';

select lives_ok(
  $$select public.get_review_interaction_summary('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')$$,
  'unhide restores discussion access'
);

select * from finish();
rollback;
