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

INSERT INTO public.board_members (board_id, user_id)
VALUES
  ('11111111-aaaa-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-bbbb-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('11111111-aaaa-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'),
  ('22222222-bbbb-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001')
ON CONFLICT (board_id, user_id) DO NOTHING;

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
