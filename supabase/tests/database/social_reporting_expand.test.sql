begin;
select plan(18);

insert into auth.users (id, email)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma@example.com'),
  ('00000000-0000-0000-0000-000000000001', 'rate1@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'rate2@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'rate3@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'rate4@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'rate5@example.com'),
  ('00000000-0000-0000-0000-000000000006', 'rate6@example.com')
on conflict (id) do nothing;

insert into public.profiles (
  user_id, username, display_name, is_public, allow_profile_discovery,
  share_activity_with_followers
)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alpha_one', 'Alpha', true, true, true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_two', 'Beta', true, true, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'gamma_hide', 'Gamma', false, false, true),
  ('00000000-0000-0000-0000-000000000001', 'rate_user_1', 'R1', true, true, true),
  ('00000000-0000-0000-0000-000000000002', 'rate_user_2', 'R2', true, true, true),
  ('00000000-0000-0000-0000-000000000003', 'rate_user_3', 'R3', true, true, true),
  ('00000000-0000-0000-0000-000000000004', 'rate_user_4', 'R4', true, true, true),
  ('00000000-0000-0000-0000-000000000005', 'rate_user_5', 'R5', true, true, true),
  ('00000000-0000-0000-0000-000000000006', 'rate_user_6', 'R6', true, true, true)
on conflict (user_id) do update
set username = excluded.username,
    display_name = excluded.display_name,
    is_public = excluded.is_public,
    allow_profile_discovery = excluded.allow_profile_discovery,
    share_activity_with_followers = excluded.share_activity_with_followers;

-- Follow must predate activity for follow-since access checks.
insert into public.profile_follows (follower_id, following_id, created_at)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  now() - interval '2 hours'
)
on conflict (follower_id, following_id) do update
set created_at = excluded.created_at;

insert into public.social_activity_events (
  id, actor_id, activity_type, media_type, media_id, rating, created_at
)
values (
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'movie_rated',
  'movie',
  'trakt-movie-42',
  8,
  now() - interval '1 hour'
)
on conflict (id) do nothing;

insert into public.user_media_reviews (
  user_id, media_type, media_id, review_text, contains_spoilers
)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'movie',
  'trakt-movie-42',
  'Solid film.',
  false
)
on conflict do nothing;

insert into public.social_review_comments (
  id, activity_id, author_id, comment_text, contains_spoilers
)
values (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Agree.',
  false
)
on conflict (id) do nothing;

select ok(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'social_content_reports_target_type_check'
  ) like '%profile%',
  'target_type check includes profile'
);

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select public.report_social_content(
      'profile',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'spam'
    )$$,
  'A can report B profile'
);

select throws_ok(
  $$select public.report_social_content(
      'profile',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'spam'
    )$$,
  'P0001',
  'already_reported',
  'duplicate profile report is already_reported'
);

select throws_ok(
  $$select public.report_social_content(
      'profile',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'spam'
    )$$,
  'P0001',
  'cannot_report_self',
  'self profile report is rejected'
);

select throws_ok(
  $$select public.report_social_content(
      'profile',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'spam'
    )$$,
  'P0001',
  'profile_not_found',
  'hidden private profile cannot be reported'
);

select lives_ok(
  $$select public.report_social_content(
      'social_activity',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'inappropriate'
    )$$,
  'follower can report shared review activity'
);

select lives_ok(
  $$select public.report_social_content(
      'review_comment',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'harassment'
    )$$,
  'follower can report review comment'
);

select throws_ok(
  $$select public.report_social_content(
      'review_comment',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'harassment'
    )$$,
  'P0001',
  'already_reported',
  'duplicate comment report is already_reported'
);

select lives_ok(
  $$select public.block_user('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  'A blocks B before blocked-report checks'
);

select throws_ok(
  $$select public.report_social_content(
      'profile',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'spam'
    )$$,
  'P0001',
  'profile_not_found',
  'blocked profile report is opaque'
);

select throws_ok(
  $$select public.report_social_content(
      'social_activity',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'spam'
    )$$,
  'P0001',
  'activity_unavailable',
  'blocked review activity cannot be reported'
);

select throws_ok(
  $$insert into public.social_content_reports (
      reporter_id, target_type, target_id, reason
    ) values (
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'profile',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'spam'
    )$$,
  '42501',
  null,
  'direct insert into social_content_reports is denied'
);

-- Clean slate for rate-limit window (5/minute).
reset role;
delete from public.user_blocks
where blocker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.social_content_reports
where reporter_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select lives_ok(
  $$select public.report_social_content('profile','00000000-0000-0000-0000-000000000001','other')$$,
  'rate window 1'
);
select lives_ok(
  $$select public.report_social_content('profile','00000000-0000-0000-0000-000000000002','other')$$,
  'rate window 2'
);
select lives_ok(
  $$select public.report_social_content('profile','00000000-0000-0000-0000-000000000003','other')$$,
  'rate window 3'
);
select lives_ok(
  $$select public.report_social_content('profile','00000000-0000-0000-0000-000000000004','other')$$,
  'rate window 4'
);
select lives_ok(
  $$select public.report_social_content('profile','00000000-0000-0000-0000-000000000005','other')$$,
  'rate window 5'
);

select throws_ok(
  $$select public.report_social_content('profile','00000000-0000-0000-0000-000000000006','other')$$,
  'P0001',
  'report_rate_limited',
  'sixth report within a minute is rate limited'
);

select * from finish();
rollback;
