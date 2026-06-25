---
date: "2026-06-25T07:59:22Z"
researcher: Claude (AI)
git_commit: 9090500ccbc329f00e189c44d005fb485b22f7c2
branch: change/edit-board-connection
repository: gitgud
topic: "PAT expiry mechanics and /profile/settings route status"
tags: [research, codebase, github-pat, profile-settings, token-expiry]
status: complete
last_updated: "2026-06-25"
last_updated_by: Claude (AI)
---

# Research: PAT Expiry Mechanics and /profile/settings Route Status

**Date**: 2026-06-25T07:59:22Z
**Researcher**: Claude (AI)
**Git Commit**: 9090500ccbc329f00e189c44d005fb485b22f7c2
**Branch**: change/edit-board-connection
**Repository**: gitgud

## Research Question

Two targeted questions before /10x-plan:

1. Does GitHub's API reliably expose a PAT's expiration date — for both classic and fine-grained tokens — so that it can be captured programmatically at validation time? Or must the user enter expiry manually?
2. Is `/profile/settings` a 404 today, or does a page file exist that was missed during framing?

## Summary

1. **PAT expiry is available via a response header** — `GitHub-Authentication-Token-Expiration` — on every authenticated GitHub API call, including the zero-cost `GET /rate_limit`. The header is present when the token has an expiration and absent when it doesn't. No response-body endpoint exists for PAT self-introspection. This header is the only programmatic mechanism and it is sufficient for the planned expiry-capture feature.

2. **`/profile/settings` is a confirmed 404.** No page file exists under `src/pages/profile/`. `BoardTopbar.astro:99` links to it, but clicking it today returns Astro's default 404. The new profile page will fill a real gap, not duplicate an existing surface.

## Detailed Findings

### 1. GitHub PAT Expiry Mechanics

#### The `GitHub-Authentication-Token-Expiration` Header

Every authenticated GitHub REST or GraphQL API response includes this header **if the token has an expiration date**. If the token has no expiration (classic PAT created with "No expiration"), the header is **absent** from the response.

**Format** (non-ISO, two known variants):

- `2026-06-03 19:52:44 UTC` — space-separated, named timezone
- `2025-09-05 17:55:53 +0500` — space-separated, numeric offset

To parse in JavaScript, replace the first space between date and time with `T` and normalize the timezone suffix to get an ISO-8601 string.

**Sources**: [GitHub Blog changelog (July 2021)](https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/), [go-github parseTokenExpiration](https://github.com/google/go-github/blob/master/github/github.go)

#### Classic vs Fine-Grained PATs

| Aspect                           | Classic PAT (`ghp_`)              | Fine-grained PAT (`github_pat_`)                                                                 |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Expiration required at creation? | No — "No expiration" is an option | Configurable 1–366 days or `none`; default 30 days. Org owners can enforce a max lifetime policy |
| Header present when no expiry?   | Absent                            | Absent                                                                                           |
| Header present when expiry set?  | Yes — reliable                    | Yes — reliable (a bug in Aug–Sep 2025 returned server time instead of expiry; fixed 2025-09-12)  |

**Implication for GitGud**: The validate-pat flow can reliably capture expiry from the header for tokens that have one. For tokens without expiry, the absence of the header is the signal — store `null` and skip the 7-day warning notification for those tokens.

#### No Body-Based Self-Introspection Endpoint

There is **no** REST endpoint where a PAT can discover its own metadata (expiry, scopes) in the response body. The header is the only mechanism. The `GET /user` endpoint returns profile data but no token metadata in the body.

Organization-admin endpoints (`GET /orgs/{org}/personal-access-tokens`) do return `token_expires_at` in the body, but these require org admin privileges and only cover fine-grained PATs scoped to that org — not suitable for GitGud's use case.

#### Best Validation Endpoint for Expiry Capture

`GET /rate_limit` is ideal:

- Does **not** consume rate limit quota
- Returns the `GitHub-Authentication-Token-Expiration` header like any authenticated call
- Validates that the token is functional (401 = invalid/revoked)

However, the current `validate-pat.ts` already calls `GET /user` (via `octokit.rest.users.getAuthenticated()`), which also returns this header. **The header can be captured from the existing call** — no need to add a second API call. See integration point below.

#### Integration Point in Current Code

`src/pages/api/github/validate-pat.ts:51-54`:

```typescript
const octokit = makeOctokit(pat);
const { data } = await octokit.rest.users.getAuthenticated();
```

The Octokit response object includes `.headers` alongside `.data`. Changing the destructuring to `const { data, headers }` and reading `headers["github-authentication-token-expiration"]` captures the expiry with zero additional API calls. The value (or `null` if absent) can then be returned to the caller and persisted alongside the PAT.

**Parsing helper needed**: A small utility to normalize GitHub's non-ISO date format into a `Date` / ISO string. Two-variant parsing: named timezone (`UTC`) or numeric offset (`+0500`).

### 2. `/profile/settings` Route Status

#### Current State: 404

- `src/pages/profile/` **does not exist** as a directory
- No page file at `src/pages/profile/settings.astro`, `src/pages/profile/settings/index.astro`, or any variant
- No redirect, rewrite, or catch-all in `src/middleware.ts` for `/profile` paths

#### The Dead Link

`src/components/BoardTopbar.astro:98-110` renders a dropdown with:

```html
<a href="/profile/settings">Profile settings</a>
```

This link is live on every board page today and leads to a 404. The dropdown is rendered for all authenticated users.

#### Route Protection Gap

`src/middleware.ts:4` defines:

```typescript
const PROTECTED_ROUTES = ["/dashboard", "/board"];
```

`/profile` is **not** in this list. When the profile page is created, it must be added to `PROTECTED_ROUTES` to enforce authentication — otherwise an unauthenticated request to `/profile/settings` would render the page without a user context.

#### Existing Precedent: Board Settings

The closest existing settings page is `src/pages/board/[id]/settings.astro` — board-level settings. The new profile settings page is a peer surface at the user level, not a duplicate.

## Code References

- `src/pages/api/github/validate-pat.ts:51-54` — Current validation call; captures `data` but discards `headers`
- `src/components/BoardTopbar.astro:98-110` — Dead link to `/profile/settings`
- `src/middleware.ts:4` — `PROTECTED_ROUTES` array; `/profile` not included
- `src/lib/github.ts` — `makeOctokit` factory; Octokit instance configuration
- `supabase/migrations/20260622120000_user_profiles.sql` — `user_profiles` table; no expiry column today

## Architecture Insights

1. **Header capture is zero-cost**: The existing `validate-pat` Octokit call already returns the expiry header — it's just not being read. This is the cheapest possible integration path.

2. **Null-expiry is a valid state**: Classic PATs with no expiration produce no header. The data model must accommodate `token_expires_at: timestamptz | null`, and the 7-day notification logic must treat `null` as "no expiry, no warning."

3. **Date parsing is non-trivial but bounded**: GitHub uses a non-ISO format with two variants. A small parsing utility is needed, but the format space is fully known and stable (documented since 2021, adopted by `go-github` and `refined-github`).

4. **Route protection must be extended**: Adding `/profile` to `PROTECTED_ROUTES` in middleware is a prerequisite for the profile page, not an afterthought.

## Historical Context (from prior changes)

- `context/archive/2026-06-22-link-github-account/plan-brief.md` — Created the `user_profiles` table with `avatar_url` and `github_username`, but no token-related fields. The table is the natural home for `token_expires_at`.
- `context/archive/2026-05-30-github-ingestion-access/plan-brief.md:25-26` — Documented the per-board PAT decision, which the current change intentionally overrides.
- `context/archive/2026-06-01-link-board-to-github-org/research.md:120-121` — Multi-org PAT limitation documented here.

## Open Questions

1. **Parse-once or parse-every-call?** Should the expiry be captured only at PAT-save time (one parse), or re-read on every GitHub API call the system makes (continuous freshness)? Save-time-only is simpler; continuous would catch GitHub-side expiry changes (e.g., admin shortening org token lifetimes) but adds overhead to every ingestion call.

2. **UI for no-expiry tokens**: Should the profile page show "No expiration" explicitly, or prompt the user to set one? GitHub itself now nudges users toward expiring tokens — GitGud could echo that recommendation without blocking.

3. **Fine-grained PAT header regression risk**: The 2025 bug (header returning server time) was fixed, but defensive parsing (rejecting dates in the past) would guard against a recurrence. Worth a one-line sanity check?
