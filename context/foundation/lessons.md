# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## useFormStatus only works with React Server Actions

**Context**: src/components/CreateBoardForm.tsx:50-66 — SubmitButton component relies on useFormStatus() from React, which tracks submission state for the enclosing form.

**Problem**: useFormStatus() only detects submission state when the form is wired to a React Server Action (action={serverAction}). For native HTML forms that POST to an API route (action="/api/boards"), useFormStatus() never fires — the submit button never enters a loading state, and SubmitButton cannot be reused.

**Rule**: For native-POST forms (action="/api/..."), manage submitting state locally with useState + an onSubmit handler; do not reach for SubmitButton / useFormStatus. When the same pattern appears in two or more form components, extract a shared NativeSubmitButton that accepts an isLoading prop. Reserve SubmitButton (useFormStatus) for Server Action forms only.

**Applies to**: Any React island that renders a native <form> POSTing to an Astro API route. Extraction threshold: two or more form components using the same useState+isLoading pattern.

## Always use consola via @/lib/logger for all logging

- **Context**: Any src/ file that emits log output
- **Problem**: Scattered console.* calls trigger lint warnings and can't be centrally controlled — lint suppression pragmas accumulate and there's no single swap point when a structured logger is needed.
- **Rule**: Always use consola via `@/lib/logger` for logging. Never use `console.*` directly in application code.
- **Applies to**: implement, impl-review

## Always REVOKE ALL before relying on RLS

**Context**: supabase/migrations/20260602120000_board_contributors.sql — board_contributors table secured with RLS policies.

**Problem**: RLS policies restrict which rows users can access, but Postgres still grants default table-level privileges to the `anon` and `authenticated` roles unless explicitly revoked. A table protected only by RLS but without a preceding REVOKE can be accessed through privilege-escalation paths or future policy gaps.

**Rule**: Every new table migration must include `REVOKE ALL ON <table> FROM anon, authenticated;` before the RLS policies.

**Applies to**: All new Supabase migration files that create tables with RLS.
