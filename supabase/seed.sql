-- F-01 dev seed: two boards + shared contributor so role flip is observable.
-- Passwords: "password" (bcrypt).
-- Login via: supervisor-1@example.test / supervisor-2@example.test / contributor-1@example.test

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  (
    'aaaaaaaa-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'supervisor-1@example.test',
    crypt('password', gen_salt('bf')),
    now(), now(), now(), '{}',
    -- Real GitHub identity (supabase/supabase contributor) so dev seed avatars/logins are legit.
    jsonb_build_object(
      'github_id', 19742402, 'github_login', 'joshenlim',
      'avatar_url', 'https://avatars.githubusercontent.com/u/19742402?v=4'
    ),
    '', '', '', ''
  ),
  (
    'bbbbbbbb-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'supervisor-2@example.test',
    crypt('password', gen_salt('bf')),
    now(), now(), now(), '{}',
    jsonb_build_object(
      'github_id', 10214025, 'github_login', 'kiwicopple',
      'avatar_url', 'https://avatars.githubusercontent.com/u/10214025?v=4'
    ),
    '', '', '', ''
  ),
  (
    'cccccccc-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'contributor-1@example.test',
    crypt('password', gen_salt('bf')),
    now(), now(), now(), '{}',
    jsonb_build_object(
      'github_id', 8291514, 'github_login', 'MildTomato',
      'avatar_url', 'https://avatars.githubusercontent.com/u/8291514?v=4'
    ),
    '', '', '', ''
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (provider, provider_id, user_id, identity_data, created_at, updated_at)
VALUES
  (
    'email', 'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000001',
    jsonb_build_object('sub', 'aaaaaaaa-0000-0000-0000-000000000001', 'email', 'supervisor-1@example.test'),
    now(), now()
  ),
  (
    'email', 'bbbbbbbb-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000001',
    jsonb_build_object('sub', 'bbbbbbbb-0000-0000-0000-000000000001', 'email', 'supervisor-2@example.test'),
    now(), now()
  ),
  (
    'email', 'cccccccc-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000001',
    jsonb_build_object('sub', 'cccccccc-0000-0000-0000-000000000001', 'email', 'contributor-1@example.test'),
    now(), now()
  )
ON CONFLICT (provider, provider_id) DO NOTHING;

INSERT INTO public.boards (id, name, owner_user_id)
VALUES
  ('11111111-aaaa-0000-0000-000000000001', 'Board Alpha', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-bbbb-0000-0000-000000000001', 'Board Beta',  'bbbbbbbb-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Owners (supervisor-1, supervisor-2) get board access via boards.owner_user_id —
-- no row needed. contributor-1's user_profiles row is created by the
-- handle_new_user trigger from their raw_user_meta_data above; link their
-- github_id to both boards via board_contributors so derived access applies.
INSERT INTO public.board_contributors (board_id, github_id, github_login, avatar_url)
VALUES
  ('11111111-aaaa-0000-0000-000000000001', 8291514, 'MildTomato', 'https://avatars.githubusercontent.com/u/8291514?v=4'),
  ('22222222-bbbb-0000-0000-000000000001', 8291514, 'MildTomato', 'https://avatars.githubusercontent.com/u/8291514?v=4')
ON CONFLICT (board_id, github_id) DO NOTHING;

-- F-02 seed: test GitHub repo connection for Board Alpha (no PAT — provide manually during dev)
INSERT INTO public.github_repos (id, board_id, repo_owner, repo_name, connected_by)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  '11111111-aaaa-0000-0000-000000000001',
  'octocat',
  'Hello-World',
  'aaaaaaaa-0000-0000-0000-000000000001'
)
ON CONFLICT (board_id, repo_owner, repo_name) DO NOTHING;

-- profile-classified-comments: rich dev dataset sourced from real supabase/supabase PR review
-- threads, for manually verifying the Threads page (badges, filters, pagination, contributor
-- switching, deep-linking). Intent/domain labels assigned by hand following the classification
-- system prompt's rules (src/lib/services/classification.ts) against the real comment text.

INSERT INTO public.github_repos (id, board_id, repo_owner, repo_name, connected_by)
VALUES ('dddddddd-0000-0000-0000-000000000002', '11111111-aaaa-0000-0000-000000000001', 'supabase', 'supabase', 'aaaaaaaa-0000-0000-0000-000000000001')
ON CONFLICT (board_id, repo_owner, repo_name) DO NOTHING;

INSERT INTO public.board_contributors (board_id, github_id, github_login, avatar_url)
VALUES
  ('11111111-aaaa-0000-0000-000000000001', 23711156, 'czenko', 'https://avatars.githubusercontent.com/u/23711156?v=4'),
  ('11111111-aaaa-0000-0000-000000000001', 3104761, 'dnywh', 'https://avatars.githubusercontent.com/u/3104761?v=4'),
  ('11111111-aaaa-0000-0000-000000000001', 15148011, 'nrichers', 'https://avatars.githubusercontent.com/u/15148011?v=4'),
  ('11111111-aaaa-0000-0000-000000000001', 42080, 'ChrisChinchilla', 'https://avatars.githubusercontent.com/u/42080?v=4'),
  ('11111111-aaaa-0000-0000-000000000001', 25671831, 'fsansalvadore', 'https://avatars.githubusercontent.com/u/25671831?v=4'),
  ('11111111-aaaa-0000-0000-000000000001', 10985857, 'alaister', 'https://avatars.githubusercontent.com/u/10985857?v=4'),
  ('11111111-aaaa-0000-0000-000000000001', 534841, 'alexhall', 'https://avatars.githubusercontent.com/u/534841?v=4')
ON CONFLICT (board_id, github_id) DO NOTHING;

INSERT INTO public.github_pull_requests (id, repo_id, number, title, state, author_login, author_github_id, created_at, updated_at, merged_at, additions, deletions, changed_files)
VALUES
  (3923614439, 'dddddddd-0000-0000-0000-000000000002', 47251, 'refactor(studio): unify snippet save + persistence into SnippetStatus (3/9)', 'merged', 'charislam', 26616127, '2026-06-23T22:52:34Z', '2026-06-23T22:52:34Z', '2026-06-24T12:56:39Z', 297, 74, 23),
  (3919928423, 'dddddddd-0000-0000-0000-000000000002', 47225, 'Include `postgrest_logs` as source for Postgrest logs', 'merged', 'joshenlim', 19742402, '2026-06-23T12:35:59Z', '2026-06-23T12:35:59Z', '2026-06-24T06:55:16Z', 37, 33, 6),
  (3896845411, 'dddddddd-0000-0000-0000-000000000002', 47107, 'build(studio): Vite/TanStack-Start build pipeline behind flag (stack 1/6)', 'merged', 'alaister', 10985857, '2026-06-19T07:21:47Z', '2026-06-19T07:21:47Z', '2026-06-24T09:55:22Z', 2756, 574, 38),
  (3877897839, 'dddddddd-0000-0000-0000-000000000002', 47004, 'feat(studio): marketplace preview listings', 'merged', 'alexhall', 534841, '2026-06-16T18:25:02Z', '2026-06-16T18:25:02Z', '2026-06-23T15:16:58Z', 129, 38, 4),
  (3913498452, 'dddddddd-0000-0000-0000-000000000002', 47190, 'chore: add audit logs drains to documentation', 'merged', 'Ellba', 44750366, '2026-06-22T16:11:04Z', '2026-06-22T16:11:04Z', '2026-06-23T17:55:10Z', 8, 2, 2),
  (3915640692, 'dddddddd-0000-0000-0000-000000000002', 47202, 'fix(docs) Remove unneeded double border on docs Accordion', 'merged', 'czenko', 23711156, '2026-06-22T22:07:11Z', '2026-06-22T22:07:11Z', '2026-06-23T17:38:47Z', 44, 98, 12),
  (3920100885, 'dddddddd-0000-0000-0000-000000000002', 47226, 'www: standardize container width', 'merged', 'fsansalvadore', 25671831, '2026-06-23T13:00:52Z', '2026-06-23T13:00:52Z', '2026-06-24T10:26:39Z', 120, 128, 31),
  (3914902955, 'dddddddd-0000-0000-0000-000000000002', 47199, 'docs(security): document log_connections=off default and re-enable path', 'merged', 'nrichers', 15148011, '2026-06-22T19:48:52Z', '2026-06-22T19:48:52Z', '2026-06-23T15:14:56Z', 105, 0, 9),
  (3914774466, 'dddddddd-0000-0000-0000-000000000002', 47198, 'docs: Add troubleshooting guide for Kong under heavy load', 'merged', 'avallete', 8771783, '2026-06-22T19:26:32Z', '2026-06-22T19:26:32Z', '2026-06-23T15:11:57Z', 62, 0, 1),
  (3920725060, 'dddddddd-0000-0000-0000-000000000002', 47236, 'www: blog', 'open', 'fsansalvadore', 25671831, '2026-06-23T14:29:01Z', '2026-06-23T14:29:01Z', NULL, 1104, 644, 20),
  (3920130648, 'dddddddd-0000-0000-0000-000000000002', 47228, 'www: homepage', 'open', 'fsansalvadore', 25671831, '2026-06-23T13:05:05Z', '2026-06-23T13:05:05Z', NULL, 2739, 131, 38),
  (3913092420, 'dddddddd-0000-0000-0000-000000000002', 47188, 'docs: fix ltree reindex detection + specify Postgres version in upgrade guide', 'merged', 'utkarash2991', 28870713, '2026-06-22T15:13:40Z', '2026-06-22T15:13:40Z', '2026-06-23T11:07:23Z', 45, 21, 1),
  (3885556573, 'dddddddd-0000-0000-0000-000000000002', 47055, 'feat: update the docs for edge function testing', 'merged', 'mansueli', 5036432, '2026-06-17T17:39:26Z', '2026-06-17T17:39:26Z', '2026-06-19T10:13:00Z', 642, 121, 9),
  (3886826319, 'dddddddd-0000-0000-0000-000000000002', 47061, 'chore(docs) Demote h1s in the doc body to avoid multiple h1s', 'merged', 'czenko', 23711156, '2026-06-17T21:14:33Z', '2026-06-17T21:14:33Z', '2026-06-19T03:42:45Z', 181, 181, 16),
  (3887228930, 'dddddddd-0000-0000-0000-000000000002', 47064, 'fix(docs) Format MDX note in one paragraph', 'merged', 'czenko', 23711156, '2026-06-17T22:45:04Z', '2026-06-17T22:45:04Z', '2026-06-18T10:00:02Z', 79, 4, 2),
  (3879332890, 'dddddddd-0000-0000-0000-000000000002', 47013, 'chore(docs) Remove instances of let''s to resolve mdx lint warnings', 'merged', 'czenko', 23711156, '2026-06-16T22:48:44Z', '2026-06-16T22:48:44Z', '2026-06-17T18:25:00Z', 105, 104, 54),
  (3879069339, 'dddddddd-0000-0000-0000-000000000002', 47010, 'chore(docs) Replace utilize with use', 'merged', 'czenko', 23711156, '2026-06-16T21:50:49Z', '2026-06-16T21:50:49Z', '2026-06-17T16:28:10Z', 39, 39, 34),
  (3875766697, 'dddddddd-0000-0000-0000-000000000002', 46990, 'docs: Track 404 recommendation clicked', 'merged', 'ChrisChinchilla', 42080, '2026-06-16T12:59:36Z', '2026-06-16T12:59:36Z', '2026-06-17T14:56:53Z', 37, 5, 3),
  (3872322339, 'dddddddd-0000-0000-0000-000000000002', 46966, 'chore(docs) Resolve ''simple'' style warnings where applicable', 'merged', 'czenko', 23711156, '2026-06-16T02:01:48Z', '2026-06-16T02:01:48Z', '2026-06-16T21:45:56Z', 95, 88, 61),
  (3877703145, 'dddddddd-0000-0000-0000-000000000002', 47002, 'fix(docs): remove redundant icons', 'merged', 'dnywh', 3104761, '2026-06-16T17:52:17Z', '2026-06-16T17:52:17Z', '2026-06-16T18:59:38Z', 15, 22, 2),
  (3872134170, 'dddddddd-0000-0000-0000-000000000002', 46965, 'chore(docs) Resolve all mdx lint errors', 'open', 'czenko', 23711156, '2026-06-16T01:09:10Z', '2026-06-16T01:09:10Z', NULL, 513, 513, 263)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.github_reviews (id, pull_request_id, reviewer_login, reviewer_github_id, state, submitted_at)
VALUES
  (9000000001, 3872322339, 'ChrisChinchilla', 42080, 'CHANGES_REQUESTED', '2026-06-16T07:30:36Z'),
  (9000000002, 3872322339, 'nrichers', 15148011, 'CHANGES_REQUESTED', '2026-06-16T19:02:53Z'),
  (9000000003, 3875766697, 'pamelachia', 26612111, 'COMMENTED', '2026-06-16T14:52:08Z'),
  (9000000004, 3877703145, 'czenko', 23711156, 'COMMENTED', '2026-06-16T18:14:39Z'),
  (9000000005, 3877897839, 'awaseem', 8704380, 'COMMENTED', '2026-06-22T20:40:36Z'),
  (9000000006, 3879332890, 'nrichers', 15148011, 'CHANGES_REQUESTED', '2026-06-17T14:02:19Z'),
  (9000000007, 3885556573, 'czenko', 23711156, 'CHANGES_REQUESTED', '2026-06-17T23:19:48Z'),
  (9000000008, 3885556573, 'kallebysantos', 105971119, 'COMMENTED', '2026-06-18T21:37:00Z'),
  (9000000009, 3886826319, 'nrichers', 15148011, 'CHANGES_REQUESTED', '2026-06-18T19:00:08Z'),
  (9000000010, 3896845411, 'ivasilov', 568291, 'COMMENTED', '2026-06-22T14:47:58Z'),
  (9000000011, 3913092420, 'czenko', 23711156, 'CHANGES_REQUESTED', '2026-06-22T22:38:29Z'),
  (9000000012, 3913498452, 'czenko', 23711156, 'COMMENTED', '2026-06-22T21:30:00Z'),
  (9000000013, 3914774466, 'ChrisChinchilla', 42080, 'CHANGES_REQUESTED', '2026-06-23T13:56:45Z'),
  (9000000014, 3914902955, 'ChrisChinchilla', 42080, 'CHANGES_REQUESTED', '2026-06-23T10:48:14Z'),
  (9000000015, 3915640692, 'dnywh', 3104761, 'COMMENTED', '2026-06-23T15:45:05Z'),
  (9000000016, 3919928423, 'jordienr', 37541088, 'CHANGES_REQUESTED', '2026-06-23T12:42:26Z'),
  (9000000017, 3920100885, 'dnywh', 3104761, 'COMMENTED', '2026-06-23T18:32:36Z'),
  (9000000018, 3920100885, 'czenko', 23711156, 'COMMENTED', '2026-06-23T21:49:02Z'),
  (9000000019, 3920130648, 'dnywh', 3104761, 'COMMENTED', '2026-06-23T18:48:21Z'),
  (9000000020, 3920725060, 'dnywh', 3104761, 'COMMENTED', '2026-06-23T18:54:37Z'),
  (9000000021, 3923614439, 'djhi', 1122076, 'COMMENTED', '2026-06-24T08:24:51Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.github_review_comments (id, pull_request_id, commenter_login, commenter_github_id, body, in_reply_to_id, created_at, updated_at)
VALUES
  (3465623734, 3923614439, 'djhi', 1122076, $body$Same, can probably be in `apps/studio/state/sql-editor/types.ts`$body$, NULL, '2026-06-24T08:24:51Z', '2026-06-24T08:25:05Z'),
  (3459789497, 3919928423, 'jordienr', 37541088, $body$I think something like this is a bit cleaner type-wise
```suggestion
  edge: 'API Gateway',
  postgres: 'Postgres',
  postgrest: 'PostgREST',
  auth: 'Auth',
  storage: 'Storage',
  'edge function': 'Edge Function',
  realtime: 'Realtime',
  supavisor: 'Supavisor',
  pgbouncer: 'PgBouncer',
} as const

export type LogType = keyof typeof LOG_TYPES_LABELS

export const LOG_TYPES = Object.keys(LOG_TYPES_LABELS) as LogType[]
```$body$, NULL, '2026-06-23T12:42:26Z', '2026-06-23T12:43:55Z'),
  (3460004287, 3919928423, 'joshenlim', 19742402, $body$ahh i needed to do this cause of some TS issue with z.enum asserting against a plain string array
although i'll clean this up a bit using `LogType`$body$, 3459789497, '2026-06-23T13:14:31Z', '2026-06-23T13:14:31Z'),
  (3441359337, 3896845411, 'alaister', 10985857, $body$I think this is a false positive – `turbo.jsonc` is JSONC, so trailing commas are valid here and turbo parses it fine. They're used consistently throughout this file too (e.g. the `globalEnv`/`passThroughEnv` arrays and the task object right below this), and the Next build passes. The error only shows up because Biome is parsing it as strict JSON. Removing just this one would make it inconsistent with the rest of the file, so leaving it as-is.$body$, NULL, '2026-06-19T08:55:17Z', '2026-06-19T08:55:17Z'),
  (3453147479, 3896845411, 'ivasilov', 568291, $body$Not sure why we need this config, but don't we need to follow this guide https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro?$body$, NULL, '2026-06-22T14:47:58Z', '2026-06-22T14:47:58Z'),
  (3453312031, 3896845411, 'ivasilov', 568291, $body$We should just use `dotenv` here, no need for this magic. I tried adding the env var in `.env` first, so got confused why it didn't work.$body$, NULL, '2026-06-22T15:08:27Z', '2026-06-22T15:08:27Z'),
  (3460654154, 3896845411, 'alaister', 10985857, $body$Yeah makes sense – the real issue was `dispatch.js` only reading `.env.local`, while `serve.js` reads `.env` too, so anything in `.env` got silently ignored. Fixed it to read both now (shell > `.env.local` > `.env`, same as serve.js/vite).

On dotenv – I actually started this PR by loading the whole env in, but that's exactly what caused problems: it clobbers the dispatcher-set values like the e2e `NEXT_PUBLIC_IS_PLATFORM` override, which is why it ended up only pulling the one key.$body$, 3453312031, '2026-06-23T14:46:10Z', '2026-06-23T14:46:10Z'),
  (3461519776, 3896845411, 'alaister', 10985857, $body$If we use nitro we'll be running a Vercel function on every request – so I've opted for a simpler, pure SPA approach$body$, 3453147479, '2026-06-23T17:02:30Z', '2026-06-23T17:02:30Z'),
  (3423140605, 3877897839, 'alexhall', 534841, $body$The logic is correct as is.$body$, NULL, '2026-06-16T18:36:59Z', '2026-06-16T18:36:59Z'),
  (3455303324, 3877897839, 'awaseem', 8704380, $body$I'd rather move all this logic to its own dedicated hook, don't pass in values from its dependencies `useFeatureFlags` rather just call them in the new hook and use the values in this component. Its easier to test and much cleaner than what we have right now $body$, NULL, '2026-06-22T20:40:36Z', '2026-06-22T20:41:41Z'),
  (3455308352, 3877897839, 'awaseem', 8704380, $body$The comment can be reduced, seems AI left over$body$, NULL, '2026-06-22T20:41:37Z', '2026-06-22T20:41:41Z'),
  (3455554267, 3913498452, 'czenko', 23711156, $body$Looks like this is the product name, so does not apply. Hitting 'resolve'$body$, NULL, '2026-06-22T21:30:00Z', '2026-06-22T21:30:00Z'),
  (3455587273, 3913498452, 'czenko', 23711156, $body$Overall, I'm a little confused about what this page topic is and how all of the sections tie together cohesively. Maybe there can be some glue here or some mention of the Audit Log Drains in the introduction so that it's not a surprise lower in the page.$body$, NULL, '2026-06-22T21:37:22Z', '2026-06-22T21:43:28Z'),
  (3455590733, 3913498452, 'czenko', 23711156, $body$It is normal to include a first sentence of a document that begins:
```
This topic covers...
```$body$, 3455587273, '2026-06-22T21:38:13Z', '2026-06-22T21:50:02Z'),
  (3455601547, 3913498452, 'czenko', 23711156, $body$I'm wondering how this ties into the other sections.
The previous section is dedicated to explaining how to Access logs (procedural), but this section explains what Audit Log Drains are (contexual).

I'm wondering if this is the correct and intuitive place for this section.$body$, NULL, '2026-06-22T21:40:42Z', '2026-06-22T21:43:28Z'),
  (3455623053, 3913498452, 'czenko', 23711156, $body$Oh wait. I realize that it is set to Error. You need to add "Audit Log Drains" to `supa-mdx-lint/Rule001HeadingCase.toml` in this PR.$body$, NULL, '2026-06-22T21:45:06Z', '2026-06-22T21:46:22Z'),
  (3455636200, 3913498452, 'czenko', 23711156, $body$A more intuitive section might be `## Accessing Audit Log Drains` using a similar convention as the previous section.$body$, 3455601547, '2026-06-22T21:48:16Z', '2026-06-22T21:48:16Z'),
  (3455731012, 3915640692, 'czenko', 23711156, $body$I wonder why this was put here in the first place. 🤔 The Accordion elements look fine without it.$body$, NULL, '2026-06-22T22:08:29Z', '2026-06-22T22:08:29Z'),
  (3455823983, 3915640692, 'czenko', 23711156, $body$Added `cn()` for more readability on the classes.$body$, NULL, '2026-06-22T22:28:20Z', '2026-06-22T22:28:20Z'),
  (3455825710, 3915640692, 'czenko', 23711156, $body$Add reduce-motion for a11y.$body$, NULL, '2026-06-22T22:28:44Z', '2026-06-22T22:28:44Z'),
  (3455829100, 3915640692, 'czenko', 23711156, $body$Add reduce-motion for a11y.$body$, NULL, '2026-06-22T22:29:30Z', '2026-06-22T22:29:30Z'),
  (3455833399, 3915640692, 'czenko', 23711156, $body$`aria-hidden` is added for a11y.
This is a decorative icon that should not be read aloud by a screenreader.$body$, NULL, '2026-06-22T22:30:24Z', '2026-06-22T22:30:25Z'),
  (3461033762, 3915640692, 'dnywh', 3104761, $body$Minor nit: you might have a formatting setup that differs from the team? I think everyone else’s organises alphabetically.$body$, NULL, '2026-06-23T15:45:05Z', '2026-06-23T15:45:05Z'),
  (3461054431, 3915640692, 'dnywh', 3104761, $body$The `hover:bg-200` looks a bit funny in preview, as there is no border/defining shape to the element. The underlined text on hover could be enough to suggest interactivity. What do you think?

Alternatively we could add a border to the container.$body$, NULL, '2026-06-23T15:48:27Z', '2026-06-23T15:48:27Z'),
  (3461059014, 3915640692, 'dnywh', 3104761, $body$Then we could drop the underline$body$, 3461054431, '2026-06-23T15:49:10Z', '2026-06-23T15:49:11Z'),
  (3461440171, 3915640692, 'czenko', 23711156, $body$I can remove this hover if it is funky looking.$body$, 3461054431, '2026-06-23T16:49:00Z', '2026-06-23T16:49:00Z'),
  (3461459515, 3915640692, 'czenko', 23711156, $body$Appreciate this. Adding a config setting on Prettier.$body$, 3461033762, '2026-06-23T16:52:18Z', '2026-06-23T16:52:18Z'),
  (3461696317, 3915640692, 'czenko', 23711156, $body$I think mine is working to sort the packages in alphabetical order. 😅 $body$, 3461033762, '2026-06-23T17:32:07Z', '2026-06-23T17:32:07Z'),
  (3462049018, 3920100885, 'dnywh', 3104761, $body$Just curious, why do we need the `!` utility for `important`? Shouldn’t these overrides cascade on top of the defaults anyway?$body$, NULL, '2026-06-23T18:32:36Z', '2026-06-23T18:32:36Z'),
  (3463150276, 3920100885, 'czenko', 23711156, $body$I had the same thought. According to Claude, there is a `SectionContainerWithCn` component that will give the overrides.$body$, 3462049018, '2026-06-23T21:49:02Z', '2026-06-23T21:54:01Z'),
  (3463151920, 3920100885, 'czenko', 23711156, $body$Recommend avoiding `!` as a best practice.$body$, NULL, '2026-06-23T21:49:22Z', '2026-06-23T21:54:01Z'),
  (3463164616, 3920100885, 'czenko', 23711156, $body$I don't know if we have guidelines around using square bracket `[]` overrides. If 150 and 300 are standard container sizes, maybe they should be given a name.$body$, NULL, '2026-06-23T21:52:17Z', '2026-06-23T21:54:01Z'),
  (3465839093, 3920100885, 'fsansalvadore', 25671831, $body$the `!` here was just to not need to override all the breakpoints inside the SectionContainer `py-16 sm:py-18 md:py-24` and be more concise. It would need to be `py-8 sm:py-8 md:py-8 xl:py-24`.

But can try to reuse the SectionContainerWithCn more.$body$, 3462049018, '2026-06-24T09:00:47Z', '2026-06-24T09:00:47Z'),
  (3466107578, 3920100885, 'fsansalvadore', 25671831, $body$ok swapped this with SectionContainerWithCn 👍$body$, 3462049018, '2026-06-24T09:46:12Z', '2026-06-24T09:46:12Z'),
  (3466115053, 3920100885, 'fsansalvadore', 25671831, $body$yeah square brackets usually if defining one-offs, like in this case.$body$, 3463164616, '2026-06-24T09:47:33Z', '2026-06-24T09:47:33Z'),
  (3459066530, 3914902955, 'ChrisChinchilla', 42080, $body$```suggestion
- Keeping [Postgres connection logging](/docs/guides/platform/postgres-connection-logging) enabled. Supabase sets `log_connections` to off by default for new projects. Projects that need HIPAA compliance should keep connection logging on for audit trails, and the Security Advisor warns if it is disabled.
```$body$, NULL, '2026-06-23T10:48:14Z', '2026-06-23T10:48:14Z'),
  (3459118802, 3914902955, 'ChrisChinchilla', 42080, $body$```suggestion
You can configure connection logging  from the **Log connections** setting in the [Database Settings](/dashboard/project/_/database/settings) section of the Dashboard.
```$body$, NULL, '2026-06-23T10:55:00Z', '2026-06-23T10:56:38Z'),
  (3462178468, 3920725060, 'dnywh', 3104761, $body$Yeah, I experienced this accidentally before realising CodeRabbit found it too.$body$, NULL, '2026-06-23T18:54:37Z', '2026-06-23T18:54:38Z'),
  (3462185175, 3920725060, 'dnywh', 3104761, $body$Some random whitespace probably caused by this component:

<img width="2836" height="684" alt="Image" src="https://github.com/user-attachments/assets/4f9ad4ad-ad3c-40b9-805a-b2a0098e60c2" />$body$, NULL, '2026-06-23T18:55:44Z', '2026-06-23T18:58:59Z'),
  (3462140073, 3920130648, 'dnywh', 3104761, $body$This and a lot of other of the SVGs—maybe all of the framework ones—are already available in the docs directory. Should we just reuse?$body$, NULL, '2026-06-23T18:48:21Z', '2026-06-23T18:48:21Z'),
  (3462151609, 3920130648, 'dnywh', 3104761, $body$This GitHub stars count is wrong. And it’s always growing. Could we make it dynamic?$body$, NULL, '2026-06-23T18:50:03Z', '2026-06-23T18:51:35Z'),
  (3462156134, 3920130648, 'dnywh', 3104761, $body$`'use client'` on a layout? Is that normal?

Either way, shouldn’t this render statically for SEO?$body$, NULL, '2026-06-23T18:50:45Z', '2026-06-23T18:51:35Z'),
  (3462158440, 3920130648, 'dnywh', 3104761, $body$As in, the solution being to nest the client stuff in imported components.$body$, 3462156134, '2026-06-23T18:51:06Z', '2026-06-23T18:51:35Z'),
  (3455869305, 3913092420, 'czenko', 23711156, $body$```suggestion
After upgrading, indexes on `ltree` columns that were built under the previous version can return incomplete results until the index is rebuilt. For example, label searches silently miss rows that are present. This affects databases using a multibyte encoding, such as UTF-8, or a non-`libc` collation provider such as ICU or builtin.
```

See suggestions:
- **Remove em-dashed section** for sentence simplicity. Simple sentence structures are good for localization and clarity.
- **Remove parenthesis** as parenthetical in technical writing are for acronyms. $body$, NULL, '2026-06-22T22:38:29Z', '2026-06-22T22:46:43Z'),
  (3455875197, 3913092420, 'czenko', 23711156, $body$I think this is redundant. 

> This is silent: no error is raised. Affected queries return fewer rows than expected until the indexes are reindexed.

Silent erroring is mentioned in the paragraph above.
$body$, NULL, '2026-06-22T22:39:47Z', '2026-06-22T22:47:16Z'),
  (3455886666, 3913092420, 'czenko', 23711156, $body$```suggestion
You are affected only if you have indexes on `ltree` columns and your database uses a multibyte encoding or a non-`libc` collation provider.
```

Removed emphasis on the 'and' since bold is not used for that purpose. However, this section is very important. Somebody could have already read the first couple paragraphs to only now find that they're not affected.

Maybe move this up into a warning, directly underneath the _Applied when upgrading..._$body$, NULL, '2026-06-22T22:42:37Z', '2026-06-22T22:46:05Z'),
  (3455892625, 3913092420, 'czenko', 23711156, $body$Try "To X, do Y" convention.

```suggestion
To mitigate this issue, check whether your database needs reindexing:
```$body$, NULL, '2026-06-22T22:44:01Z', '2026-06-22T22:46:05Z'),
  (3455894524, 3913092420, 'czenko', 23711156, $body$I recommend putting procedures in a numbered list so that it's clear the reader must take an action.$body$, NULL, '2026-06-22T22:44:26Z', '2026-06-22T22:46:05Z'),
  (3455895966, 3913092420, 'czenko', 23711156, $body$Remove parenthesis.$body$, NULL, '2026-06-22T22:44:45Z', '2026-06-22T22:46:05Z'),
  (3455914809, 3913092420, 'czenko', 23711156, $body$Additionally, if you say "First," it's good to always write "Second," otherwise it is a numbered list of one. I recommend using an ordered list instead.$body$, 3455894524, '2026-06-22T22:48:52Z', '2026-06-22T22:48:52Z'),
  (3432027745, 3885556573, 'czenko', 23711156, $body$Since `title` adds the `h1`, I recommend making this an `h2` and so on.$body$, NULL, '2026-06-17T23:19:48Z', '2026-06-17T23:31:48Z'),
  (3432030023, 3885556573, 'czenko', 23711156, $body$Additionally, this duplicates the title. You can name this "Overview" instead.$body$, 3432027745, '2026-06-17T23:20:35Z', '2026-06-17T23:31:48Z'),
  (3432034078, 3885556573, 'czenko', 23711156, $body$Parenthetical is typically reserved for defining acronyms. 
```suggestion
- **Unit tests** for pure business logic such as pricing rules, calculations, etc.
```$body$, NULL, '2026-06-17T23:21:56Z', '2026-06-17T23:31:48Z'),
  (3432043150, 3885556573, 'czenko', 23711156, $body$- Use present tense
- Use 2nd person singular

For example:
```suggestion
You can use a realistic Edge Function called `process-ticket` that calculates the final price of a ticket based on the authenticated user's age (loaded from the `profiles` table).
```$body$, NULL, '2026-06-17T23:25:01Z', '2026-06-17T23:31:48Z'),
  (3432048558, 3885556573, 'czenko', 23711156, $body$I'm unsure about this parenthetical here. Headers typically direct the eye but does not give information directly.$body$, NULL, '2026-06-17T23:26:52Z', '2026-06-17T23:31:48Z'),
  (3432051839, 3885556573, 'czenko', 23711156, $body$Keep headings short. Should probably not include an `:`$body$, NULL, '2026-06-17T23:28:03Z', '2026-06-17T23:31:48Z'),
  (3432052885, 3885556573, 'czenko', 23711156, $body$Again, avoid parenthetical$body$, NULL, '2026-06-17T23:28:24Z', '2026-06-17T23:31:48Z'),
  (3432055164, 3885556573, 'czenko', 23711156, $body$Avoid marketing language such as "especially useful". Just say what it does.$body$, NULL, '2026-06-17T23:29:09Z', '2026-06-17T23:31:48Z'),
  (3432056340, 3885556573, 'czenko', 23711156, $body$Keep Short. Maybe just "Best practices"$body$, NULL, '2026-06-17T23:29:32Z', '2026-06-17T23:31:48Z'),
  (3432083045, 3885556573, 'czenko', 23711156, $body$A bit verbose. Can be simplified.

```suggestion
You can also find the examples in this example repository: [play.supabase.unit-tests](https://github.com/kallebysantos/play.supabase.unit-tests)
```

To "by Supabase's Edge Functions team," it should be implied to be official when this merges in the Supabase org, hopefully.$body$, NULL, '2026-06-17T23:38:20Z', '2026-06-17T23:38:20Z'),
  (3432085828, 3885556573, 'czenko', 23711156, $body$I think we have a convention for this.

!!! note$body$, NULL, '2026-06-17T23:39:15Z', '2026-06-17T23:39:15Z'),
  (3439022496, 3885556573, 'kallebysantos', 105971119, $body$solved at ea9988d5fea4$body$, 3432056340, '2026-06-18T21:37:00Z', '2026-06-18T21:37:01Z'),
  (3439023084, 3885556573, 'kallebysantos', 105971119, $body$Solved at 8a22d2276c39$body$, 3432051839, '2026-06-18T21:37:10Z', '2026-06-18T21:37:11Z'),
  (3439024677, 3885556573, 'kallebysantos', 105971119, $body$Solved at 1ba749e9a59b$body$, 3432048558, '2026-06-18T21:37:34Z', '2026-06-18T21:37:34Z'),
  (3439025570, 3885556573, 'kallebysantos', 105971119, $body$solved at 7cde06c790d0$body$, 3432043150, '2026-06-18T21:37:47Z', '2026-06-18T21:37:47Z'),
  (3439025976, 3885556573, 'kallebysantos', 105971119, $body$Solved at 136b85cff0c8$body$, 3432083045, '2026-06-18T21:37:54Z', '2026-06-18T21:37:55Z'),
  (3439026916, 3885556573, 'kallebysantos', 105971119, $body$solved at ac6d5f4c5a61$body$, 3432027745, '2026-06-18T21:38:09Z', '2026-06-18T21:38:10Z'),
  (3439027482, 3885556573, 'kallebysantos', 105971119, $body$Solved at db7251fc772b$body$, 3432034078, '2026-06-18T21:38:17Z', '2026-06-18T21:38:18Z'),
  (3441653531, 3885556573, 'kallebysantos', 105971119, $body$server sdk `withSupabase` already address RLS$body$, NULL, '2026-06-19T09:49:49Z', '2026-06-19T09:49:49Z'),
  (3441658010, 3885556573, 'kallebysantos', 105971119, $body$Such validation is not need as its a simple example use-case$body$, NULL, '2026-06-19T09:50:37Z', '2026-06-19T09:50:37Z'),
  (3431536218, 3886826319, 'czenko', 23711156, $body$This becomes hidden from the sidebar.$body$, NULL, '2026-06-17T21:19:40Z', '2026-06-17T21:19:40Z'),
  (3438237929, 3886826319, 'nrichers', 15148011, $body$This and other causes/solutions headings likely shouldn't have appeared in the sidebar in first place? As in, your PR actually fixes the table of contents on the right.$body$, 3431536218, '2026-06-18T19:00:08Z', '2026-06-18T19:50:06Z'),
  (3438270928, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Prepared statement already exists
```

(Some of these headings look like verbatim snippets of text from the error; I don't think you lose technical accuracy by formatting them in a more heading-like fashion.)$body$, NULL, '2026-06-18T19:06:05Z', '2026-06-18T19:50:06Z'),
  (3438281300, 3886826319, 'nrichers', 15148011, $body$```suggestion
Prisma couldn't establish a connection with Postgres or Supavisor before the timeout.
```

(Outside the scope of your PR, but alleviates my left eye twitching.)$body$, NULL, '2026-06-18T19:07:17Z', '2026-06-18T19:50:06Z'),
  (3438289508, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Can't reach the database server 
```

(Similar comment here, the heading can be reformatted a bit.)$body$, NULL, '2026-06-18T19:08:24Z', '2026-06-18T19:50:06Z'),
  (3438293116, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Timed out fetching a new connection from the connection pool
```

(Similar comment to other headings.)$body$, NULL, '2026-06-18T19:08:54Z', '2026-06-18T19:50:06Z'),
  (3438338186, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Back up database using the CLI
```

(This is the verb form, not the noun.)$body$, NULL, '2026-06-18T19:15:41Z', '2026-06-18T19:50:06Z'),
  (3438361507, 3886826319, 'nrichers', 15148011, $body$This topic needs a basic edit that goes beyond the scope of this PR ... 

- Heading used in lieu of a callout.
- Headings end in colons. 
- Sentences that don't end with periods.
- Etc. $body$, NULL, '2026-06-18T19:19:58Z', '2026-06-18T19:50:06Z'),
  (3438399288, 3886826319, 'nrichers', 15148011, $body$```suggestion
## Changing max database connections
```$body$, NULL, '2026-06-18T19:27:34Z', '2026-06-18T19:50:06Z'),
  (3438400721, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Process schedulers and Postgres internals
```$body$, NULL, '2026-06-18T19:27:50Z', '2026-06-18T19:50:06Z'),
  (3438403389, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Optimizing
```$body$, NULL, '2026-06-18T19:28:25Z', '2026-06-18T19:50:06Z'),
  (3438405437, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Check to see if `pg_cron scheduler` is active
```$body$, NULL, '2026-06-18T19:28:51Z', '2026-06-18T19:50:06Z'),
  (3438409323, 3886826319, 'nrichers', 15148011, $body$```suggestion
## Addressing specific errors
```$body$, NULL, '2026-06-18T19:29:42Z', '2026-06-18T19:50:06Z'),
  (3438410438, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Can't reach database server
```

(This and other headings look like verbatim text snippets. Removing the backticks makes for more legible headings and brings them in line with other topics touched by this PR.)$body$, NULL, '2026-06-18T19:29:57Z', '2026-06-18T19:50:06Z'),
  (3438411519, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Timed out fetching a new connection from the connection pool
```$body$, NULL, '2026-06-18T19:30:10Z', '2026-06-18T19:50:06Z'),
  (3438419733, 3886826319, 'nrichers', 15148011, $body$Side comment: We likely should not spend time updating deprecated content. It's either deprecated and the preferred action is to remove or we need to figure out why it's still sticking around. $body$, NULL, '2026-06-18T19:31:48Z', '2026-06-18T19:50:06Z'),
  (3438442253, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Prepared statement already exists
```$body$, NULL, '2026-06-18T19:36:14Z', '2026-06-18T19:50:06Z'),
  (3438442999, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Max client connections reached
```$body$, NULL, '2026-06-18T19:36:22Z', '2026-06-18T19:50:06Z'),
  (3438443866, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Server has closed the connection
```$body$, NULL, '2026-06-18T19:36:32Z', '2026-06-18T19:50:06Z'),
  (3438445713, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Drift detected: Your database schema is not in sync with your migration history
```$body$, NULL, '2026-06-18T19:36:52Z', '2026-06-18T19:50:06Z'),
  (3438452256, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Creating the Prisma user
```$body$, NULL, '2026-06-18T19:38:06Z', '2026-06-18T19:50:06Z'),
  (3438452849, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Give Postgres ownership of the new user
```$body$, NULL, '2026-06-18T19:38:13Z', '2026-06-18T19:50:06Z'),
  (3438453551, 3886826319, 'nrichers', 15148011, $body$```suggestion
### Optimize Prisma queries
```$body$, NULL, '2026-06-18T19:38:22Z', '2026-06-18T19:50:06Z'),
  (3438454132, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Direct connection
```$body$, NULL, '2026-06-18T19:38:28Z', '2026-06-18T19:50:06Z'),
  (3438454772, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Supavisor in session mode (port 5432)
```$body$, NULL, '2026-06-18T19:38:36Z', '2026-06-18T19:50:06Z'),
  (3438455371, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Supavisor in transaction mode (port 6543)
```$body$, NULL, '2026-06-18T19:38:43Z', '2026-06-18T19:50:06Z'),
  (3438458766, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Supabase and IPv6
```$body$, NULL, '2026-06-18T19:39:13Z', '2026-06-18T19:50:06Z'),
  (3438459670, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Working with IPv6 incompatible hosts
```$body$, NULL, '2026-06-18T19:39:22Z', '2026-06-18T19:50:06Z'),
  (3438460728, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Checking IPv6 support
```$body$, NULL, '2026-06-18T19:39:29Z', '2026-06-18T19:50:06Z'),
  (3438461422, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Finding your database's IP address
```$body$, NULL, '2026-06-18T19:39:36Z', '2026-06-18T19:50:06Z'),
  (3438462018, 3886826319, 'nrichers', 15148011, $body$```suggestion
#### Identifying your connections
```$body$, NULL, '2026-06-18T19:39:41Z', '2026-06-18T19:50:06Z'),
  (3439159454, 3886826319, 'czenko', 23711156, $body$Nice catch$body$, 3438462018, '2026-06-18T22:10:21Z', '2026-06-18T22:10:22Z'),
  (3439163640, 3886826319, 'czenko', 23711156, $body$I agree. $body$, 3431536218, '2026-06-18T22:11:24Z', '2026-06-18T22:11:24Z'),
  (3439166729, 3886826319, 'czenko', 23711156, $body$Nice$body$, 3438338186, '2026-06-18T22:12:20Z', '2026-06-18T22:12:21Z'),
  (3439176125, 3886826319, 'czenko', 23711156, $body$Could maybe run this through Hex (if that's how it works) to see how used this content is. We may have bigger fish to fry.$body$, 3438361507, '2026-06-18T22:14:38Z', '2026-06-18T22:14:39Z'),
  (3439183290, 3886826319, 'czenko', 23711156, $body$And the guide itself is deprecated? The wording is funny.$body$, 3438419733, '2026-06-18T22:16:20Z', '2026-06-18T22:16:20Z'),
  (3431908387, 3887228930, 'czenko', 23711156, $body$This is the example from DOCS-994$body$, NULL, '2026-06-17T22:46:33Z', '2026-06-17T22:46:33Z'),
  (3424488353, 3879332890, 'czenko', 23711156, $body$```suggestion
    For complex SQL operations, wrap them in database functions that you can call from the frontend using [RPC](/docs/reference/javascript/rpc).
```$body$, NULL, '2026-06-16T22:52:30Z', '2026-06-16T22:52:30Z'),
  (3424491578, 3879332890, 'czenko', 23711156, $body$```suggestion
You can run inference on images and videos.
```$body$, NULL, '2026-06-16T22:53:09Z', '2026-06-16T22:53:09Z'),
  (3424498906, 3879332890, 'czenko', 23711156, $body$```suggestion
The following example uses text embeddings. Given three phrases:
```$body$, NULL, '2026-06-16T22:54:47Z', '2026-06-16T22:54:48Z'),
  (3424501999, 3879332890, 'czenko', 23711156, $body$```suggestion
Where:
```$body$, NULL, '2026-06-16T22:55:44Z', '2026-06-16T22:55:44Z'),
  (3424504704, 3879332890, 'czenko', 23711156, $body$```suggestion
Notice the record of `owner_id` on each document. Create an RLS policy that restricts access to `document_sections` based on whether or not they own the linked document:
```$body$, NULL, '2026-06-16T22:56:31Z', '2026-06-16T22:56:32Z'),
  (3424510258, 3879332890, 'czenko', 23711156, $body$```suggestion
Pass it the sitekey we copied from the hCaptcha website as a property along with a `onVerify` property which takes a callback function. This callback function will have a token as one of its properties. Set the token in the state using `setCaptchaToken`
```$body$, NULL, '2026-06-16T22:58:07Z', '2026-06-16T22:58:07Z'),
  (3424511448, 3879332890, 'czenko', 23711156, $body$```suggestion
Pass it the sitekey we copied from the Cloudflare website as a property along with a `onSuccess` property which takes a callback function. This callback function will have a token as one of its properties. Set the token in the state using `setCaptchaToken`:
```$body$, NULL, '2026-06-16T22:58:29Z', '2026-06-16T22:58:29Z'),
  (3424515427, 3879332890, 'czenko', 23711156, $body$```suggestion
Say you have a table called `profiles` in the public schema and you only want users to be able to delete their own profile:
```$body$, NULL, '2026-06-16T22:59:40Z', '2026-06-16T22:59:41Z'),
  (3424523433, 3879332890, 'czenko', 23711156, $body$```suggestion
No, it doesn't. See why:
```$body$, NULL, '2026-06-16T23:02:20Z', '2026-06-16T23:02:21Z'),
  (3424526338, 3879332890, 'czenko', 23711156, $body$This entire paragraph needs editing, but I'm calling it out of scope.$body$, NULL, '2026-06-16T23:03:15Z', '2026-06-16T23:03:15Z'),
  (3428761748, 3879332890, 'nrichers', 15148011, $body$```suggestion
See how to make a request to the `todos` table which we created in the first step,
```

(Sentence should start with a capital letter.)$body$, NULL, '2026-06-17T14:02:19Z', '2026-06-17T14:09:14Z'),
  (3424251470, 3879069339, 'czenko', 23711156, $body$```suggestion
   - Execute 10,000 to 50,000 "warm-up" queries before each benchmark or prod. This helps to use cache and buffers more efficiently.
```$body$, NULL, '2026-06-16T21:51:37Z', '2026-06-16T21:51:37Z'),
  (3424254838, 3879069339, 'czenko', 23711156, $body$```suggestion
We are replacing the _LinkedIn_ provider with a new _LinkedIn (OIDC)_ provider to support recent changes to the LinkedIn [OAuth APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow?context=linkedin%2Fcontext&tabs=HTTPS1). The new provider uses the [Open ID Connect standard](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2#validating-id-tokens). In view of this change, we have disabled edits on the _LinkedIn_ provider and will be removing it effective 4th January 2024. Developers with LinkedIn OAuth Applications created prior to 1st August 2023 should create a new OAuth application [via the steps outlined above](/docs/guides/auth/social-login/auth-linkedin#create-a-linkedin-oauth-app) and migrate their credentials from the _LinkedIn_ provider to the _LinkedIn (OIDC)_ provider. Alternatively, you can also head to the `Products` section and add the newly release`Sign In with LinkedIn using OpenID Connect` to your existing OAuth application.
```$body$, NULL, '2026-06-16T21:52:25Z', '2026-06-16T21:52:25Z'),
  (3424259237, 3879069339, 'czenko', 23711156, $body$```suggestion
Sorting datasets from closest to farthest, sometimes called nearest-neighbor sort, is a very common use case in Geo-queries. PostGIS can handle it with the use of the [`<->`](https://postgis.net/docs/geometry_distance_knn.html) operator. `<->` operator returns the two-dimensional distance between two geometries and uses the spatial index when used within `order by` clause. You can create the following database function to sort the restaurants from closest to farthest by passing the current locations as parameters.
```$body$, NULL, '2026-06-16T21:53:26Z', '2026-06-16T21:53:27Z'),
  (3424265932, 3879069339, 'czenko', 23711156, $body$```suggestion
The [`&&`](https://postgis.net/docs/geometry_overlaps.html) operator used in the `where` statement here returns a boolean of whether the bounding box of the two geometries intersect or not. It creates a bounding box from the two points and finds those points that fall under the bounding box. It also uses a few PostGIS functions:
```$body$, NULL, '2026-06-16T21:54:53Z', '2026-06-16T21:54:53Z'),
  (3424275447, 3879069339, 'czenko', 23711156, $body$```suggestion
#### Use background tasks [utilize-background-tasks]
```$body$, NULL, '2026-06-16T21:56:45Z', '2026-06-16T21:56:46Z'),
  (3424279092, 3879069339, 'czenko', 23711156, $body$```suggestion
Swap is a portion of your instance's disk that is reserved for the operating system to use when the available RAM is used. As it uses the disk, Swap is slower to access and is generally used as a last resort.
```$body$, NULL, '2026-06-16T21:57:26Z', '2026-06-16T21:57:26Z'),
  (3424285847, 3879069339, 'czenko', 23711156, $body$Does not appear to be linked elsewhere$body$, NULL, '2026-06-16T21:58:57Z', '2026-06-16T21:58:57Z'),
  (3424288778, 3879069339, 'czenko', 23711156, $body$```suggestion
However, there is a solution. You can create a separate Supabase client using the `createClient` method from `@supabase/supabase-js` and provide it with the `secret` key. In a server environment, you also need to disable certain properties to ensure proper functionality. See the example code below for the required settings.
```$body$, NULL, '2026-06-16T21:59:45Z', '2026-06-16T21:59:45Z'),
  (3424290673, 3879069339, 'czenko', 23711156, $body$```suggestion
When a client forms a direct connection with Postgres, it usually makes a few queries but may not use the connection the entire time. In transaction mode, a client is allowed to make a single query before being sent back to the figurative "waiting room". This prevents greedy or sedentary clients from hoarding connections. In most cases, this increases query throughput and is optimal.
```$body$, NULL, '2026-06-16T22:00:17Z', '2026-06-16T22:00:17Z'),
  (3421729321, 3875766697, 'pamelachia', 26612111, $body$is there a reason we add 404 here but not the interface name? $body$, NULL, '2026-06-16T14:52:08Z', '2026-06-16T14:52:15Z'),
  (3426855673, 3875766697, 'ChrisChinchilla', 42080, $body$@pamelachia I am not sure I understand the question? This is following the same pattern as other telemetry events we trigger$body$, 3421729321, '2026-06-17T09:00:04Z', '2026-06-17T09:00:04Z'),
  (3427132891, 3875766697, 'ChrisChinchilla', 42080, $body$Ahhhh!$body$, 3421729321, '2026-06-17T09:46:04Z', '2026-06-17T09:46:04Z'),
  (3427136249, 3875766697, 'ChrisChinchilla', 42080, $body$```suggestion
export interface DocsRecommendation404ClickedEvent {
```$body$, NULL, '2026-06-17T09:46:35Z', '2026-06-17T09:46:36Z'),
  (3427139374, 3875766697, 'ChrisChinchilla', 42080, $body$```suggestion
  | DocsRecommendation404ClickedEvent
```$body$, NULL, '2026-06-17T09:47:06Z', '2026-06-17T09:47:06Z'),
  (3417692771, 3872322339, 'czenko', 23711156, $body$Guess there is no 'simple' in this one. 😅 
"Let's" will be handled in another PR.$body$, NULL, '2026-06-16T02:06:24Z', '2026-06-16T02:06:24Z'),
  (3417715979, 3872322339, 'czenko', 23711156, $body$As will 'easy'$body$, 3417692771, '2026-06-16T02:14:42Z', '2026-06-16T02:14:43Z'),
  (3418876326, 3872322339, 'ChrisChinchilla', 42080, $body$```suggestion
## Small workloads [#simple-workloads]
```

To preserve links$body$, NULL, '2026-06-16T07:30:36Z', '2026-06-16T07:39:11Z'),
  (3418883991, 3872322339, 'ChrisChinchilla', 42080, $body$```suggestion
### Basic metadata filtering [#simple-metadata-filtering]
```$body$, NULL, '2026-06-16T07:31:52Z', '2026-06-16T07:39:11Z'),
  (3418899850, 3872322339, 'ChrisChinchilla', 42080, $body$```suggestion
### Basic `GET` example [#simple-get-example]
```$body$, NULL, '2026-06-16T07:34:38Z', '2026-06-16T07:39:11Z'),
  (3418901252, 3872322339, 'ChrisChinchilla', 42080, $body$```suggestion
### Basic `POST` example [#simple-post-example]
```$body$, NULL, '2026-06-16T07:34:54Z', '2026-06-16T07:39:11Z'),
  (3418906970, 3872322339, 'ChrisChinchilla', 42080, $body$```suggestion
## Basic functions [#simple-functions]
```$body$, NULL, '2026-06-16T07:36:05Z', '2026-06-16T07:39:11Z'),
  (3418910440, 3872322339, 'ChrisChinchilla', 42080, $body$There's an awful lot of rabbit holes you can fall down…$body$, 3417692771, '2026-06-16T07:36:47Z', '2026-06-16T07:39:11Z'),
  (3418916686, 3872322339, 'ChrisChinchilla', 42080, $body$The fact is that the link above is probably the only place that uses the internal link, so let's let this one pass.$body$, NULL, '2026-06-16T07:38:02Z', '2026-06-16T07:39:11Z'),
  (3423311307, 3872322339, 'nrichers', 15148011, $body$```suggestion
You implement file uploads with the supabase-js SDK using the traditional `multipart/form-data` format. Here's an example of how to upload a file using the standard upload method:
```

(Fixes a couple of dangling occurrences of "it", puts you doing the thing before covering how it's done, and omits "can" to simplify.)$body$, NULL, '2026-06-16T19:02:53Z', '2026-06-16T19:30:31Z'),
  (3423376805, 3872322339, 'nrichers', 15148011, $body$```suggestion
Supabase is a hosted platform to get you started without needing to manage any infrastructure yourself.
```

(Stylistic tweak that avoids some extra verbiage.)$body$, NULL, '2026-06-16T19:13:52Z', '2026-06-16T19:30:31Z'),
  (3423386376, 3872322339, 'nrichers', 15148011, $body$```suggestion
Supabase is a hosted platform to get you started without needing to manage any infrastructure yourself. The hosted platform comes with many security and compliance controls managed by Supabase.
```

(Similar stylistic tweak to my other comment.)$body$, NULL, '2026-06-16T19:15:31Z', '2026-06-16T19:35:01Z'),
  (3424011277, 3872322339, 'czenko', 23711156, $body$Good catch!$body$, 3423386376, '2026-06-16T21:01:49Z', '2026-06-16T21:01:50Z'),
  (3422874635, 3877703145, 'dnywh', 3104761, $body$Match hierarchy of other headings$body$, NULL, '2026-06-16T17:52:45Z', '2026-06-16T17:52:45Z'),
  (3423010086, 3877703145, 'czenko', 23711156, $body$Unrelated to this work, but why is there `[&_h2]:m-0` when you have direct access to the children?$body$, NULL, '2026-06-16T18:14:39Z', '2026-06-16T18:17:50Z'),
  (3423019115, 3877703145, 'czenko', 23711156, $body$🥳 $body$, NULL, '2026-06-16T18:16:14Z', '2026-06-16T18:17:50Z'),
  (3423260349, 3877703145, 'dnywh', 3104761, $body$Whoops, forgot to clean this up. Fixed.$body$, 3423010086, '2026-06-16T18:55:18Z', '2026-06-16T18:55:18Z'),
  (3417521677, 3872134170, 'czenko', 23711156, $body$Perhaps it makes sense to stay here?$body$, NULL, '2026-06-16T01:09:58Z', '2026-06-16T01:09:59Z'),
  (3460322167, 3914774466, 'ChrisChinchilla', 42080, $body$```suggestion
responding under heavy load. This typically happens when many parallel
```$body$, NULL, '2026-06-23T13:56:45Z', '2026-06-23T14:00:02Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.thread_classifications (thread_root_comment_id, pull_request_id, intent, domain, model_id)
VALUES
  (3465623734, 3923614439, 'unblocking', 'refactoring', 'dev-seed'),
  (3459789497, 3919928423, 'bug-catch', 'refactoring', 'dev-seed'),
  (3453147479, 3896845411, 'question', 'functional', 'dev-seed'),
  (3453312031, 3896845411, 'bug-catch', 'functional', 'dev-seed'),
  (3455303324, 3877897839, 'architecture', 'refactoring', 'dev-seed'),
  (3455308352, 3877897839, 'nitpick', 'documentation', 'dev-seed'),
  (3455587273, 3913498452, 'unblocking', 'documentation', 'dev-seed'),
  (3455601547, 3913498452, 'question', 'documentation', 'dev-seed'),
  (3455731012, 3915640692, 'self-review', 'discussion', 'dev-seed'),
  (3455823983, 3915640692, 'self-review', 'refactoring', 'dev-seed'),
  (3455825710, 3915640692, 'self-review', 'functional', 'dev-seed'),
  (3455829100, 3915640692, 'self-review', 'functional', 'dev-seed'),
  (3455833399, 3915640692, 'self-review', 'functional', 'dev-seed'),
  (3461033762, 3915640692, 'nitpick', 'refactoring', 'dev-seed'),
  (3461054431, 3915640692, 'nitpick', 'refactoring', 'dev-seed'),
  (3462049018, 3920100885, 'question', 'refactoring', 'dev-seed'),
  (3463151920, 3920100885, 'mentoring', 'refactoring', 'dev-seed'),
  (3463164616, 3920100885, 'unblocking', 'refactoring', 'dev-seed'),
  (3460322167, 3914774466, 'bug-catch', 'documentation', 'dev-seed'),
  (3462185175, 3920725060, 'bug-catch', 'functional', 'dev-seed'),
  (3462140073, 3920130648, 'question', 'refactoring', 'dev-seed'),
  (3462151609, 3920130648, 'bug-catch', 'functional', 'dev-seed'),
  (3462156134, 3920130648, 'question', 'functional', 'dev-seed'),
  (3455869305, 3913092420, 'bug-catch', 'documentation', 'dev-seed'),
  (3455875197, 3913092420, 'nitpick', 'documentation', 'dev-seed'),
  (3455886666, 3913092420, 'bug-catch', 'documentation', 'dev-seed'),
  (3455892625, 3913092420, 'bug-catch', 'documentation', 'dev-seed'),
  (3455894524, 3913092420, 'mentoring', 'documentation', 'dev-seed'),
  (3455895966, 3913092420, 'nitpick', 'documentation', 'dev-seed'),
  (3432027745, 3885556573, 'mentoring', 'documentation', 'dev-seed'),
  (3432034078, 3885556573, 'bug-catch', 'documentation', 'dev-seed'),
  (3432043150, 3885556573, 'bug-catch', 'documentation', 'dev-seed'),
  (3432048558, 3885556573, 'mentoring', 'documentation', 'dev-seed'),
  (3432051839, 3885556573, 'nitpick', 'documentation', 'dev-seed'),
  (3432052885, 3885556573, 'nitpick', 'documentation', 'dev-seed'),
  (3432055164, 3885556573, 'mentoring', 'documentation', 'dev-seed'),
  (3432056340, 3885556573, 'nitpick', 'documentation', 'dev-seed'),
  (3432083045, 3885556573, 'bug-catch', 'documentation', 'dev-seed'),
  (3432085828, 3885556573, 'mentoring', 'documentation', 'dev-seed'),
  (3431536218, 3886826319, 'bug-catch', 'functional', 'dev-seed'),
  (3438270928, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438281300, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438289508, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438293116, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438338186, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438361507, 3886826319, 'mentoring', 'documentation', 'dev-seed'),
  (3438399288, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438400721, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438403389, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438405437, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438409323, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438410438, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438411519, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438419733, 3886826319, 'unblocking', 'documentation', 'dev-seed'),
  (3438442253, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3438442999, 3886826319, 'bug-catch', 'documentation', 'dev-seed'),
  (3431908387, 3887228930, 'self-review', 'documentation', 'dev-seed'),
  (3424488353, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424491578, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424498906, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424501999, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424504704, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424510258, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424511448, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424515427, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424523433, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3424526338, 3879332890, 'self-review', 'documentation', 'dev-seed'),
  (3428761748, 3879332890, 'bug-catch', 'documentation', 'dev-seed'),
  (3424251470, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424254838, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424259237, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424265932, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424275447, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424279092, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424285847, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424288778, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3424290673, 3879069339, 'self-review', 'documentation', 'dev-seed'),
  (3421729321, 3875766697, 'question', 'functional', 'dev-seed'),
  (3427136249, 3875766697, 'self-review', 'refactoring', 'dev-seed'),
  (3427139374, 3875766697, 'self-review', 'refactoring', 'dev-seed'),
  (3417692771, 3872322339, 'self-review', 'documentation', 'dev-seed'),
  (3418876326, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3418883991, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3418899850, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3418901252, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3418906970, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3418916686, 3872322339, 'unblocking', 'false-positive', 'dev-seed'),
  (3423311307, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3423376805, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3423386376, 3872322339, 'bug-catch', 'documentation', 'dev-seed'),
  (3422874635, 3877703145, 'self-review', 'documentation', 'dev-seed'),
  (3423010086, 3877703145, 'question', 'refactoring', 'dev-seed'),
  (3423019115, 3877703145, 'praise', 'discussion', 'dev-seed'),
  (3417521677, 3872134170, 'self-review', 'documentation', 'dev-seed')
ON CONFLICT (thread_root_comment_id) DO NOTHING;

