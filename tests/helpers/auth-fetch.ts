import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./supabase.js";

// @supabase/supabase-js derives the storage key as `sb-{ref}-auth-token` where
// `ref` is the first dot-separated segment of the hostname.
// For http://127.0.0.1:54321 → ref = "127" → "sb-127-auth-token".
function getStorageKey(supabaseUrl: string): string {
  const hostname = new URL(supabaseUrl).hostname;
  const ref = hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

// @supabase/ssr encodes the session cookie as:
//   "base64-" + base64url(JSON.stringify(sessionObject))
// It uses its own base64url implementation which is equivalent to
// Buffer.from(str, "utf-8").toString("base64url") for ASCII/JSON strings.
function encodeSessionCookieValue(session: object): string {
  const json = JSON.stringify(session);
  const b64url = Buffer.from(json, "utf-8").toString("base64url");
  return `base64-${b64url}`;
}

// If the URL-encoded cookie value exceeds 3180 chars, @supabase/ssr splits it
// into chunks: key.0, key.1, …  We replicate that logic so the server-side
// client can reassemble the session.
const MAX_CHUNK_SIZE = 3180;

function buildCookiePairs(key: string, value: string): string {
  const encoded = encodeURIComponent(value);
  if (encoded.length <= MAX_CHUNK_SIZE) {
    return `${key}=${value}`;
  }

  const pairs: string[] = [];
  let remaining = encoded;
  let i = 0;
  while (remaining.length > 0) {
    let head = remaining.slice(0, MAX_CHUNK_SIZE);
    // Avoid splitting a %-encoded triplet across chunk boundaries
    const lastPct = head.lastIndexOf("%");
    if (lastPct > MAX_CHUNK_SIZE - 3) {
      head = head.slice(0, lastPct);
    }
    pairs.push(`${key}.${i}=${decodeURIComponent(head)}`);
    remaining = remaining.slice(head.length);
    i++;
  }
  return pairs.join("; ");
}

/**
 * Returns a `fetch`-compatible function that automatically injects the
 * Supabase session stored in `client` as the `Cookie` header, matching the
 * format that `@supabase/ssr`'s `createServerClient` expects.
 *
 * The test user must already be signed in (via `createTestUser`).
 */
export function createAuthenticatedFetch(
  client: SupabaseClient,
  baseUrl: string,
): (path: string, init?: RequestInit) => Promise<Response> {
  const storageKey = getStorageKey(SUPABASE_URL);

  return async (urlPath: string, init?: RequestInit) => {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) throw new Error("No active session — call signInWithPassword first");

    const cookiePairs = buildCookiePairs(storageKey, encodeSessionCookieValue(session));

    return fetch(`${baseUrl}${urlPath}`, {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        Cookie: cookiePairs,
      },
    });
  };
}
