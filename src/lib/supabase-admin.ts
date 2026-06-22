import { createClient } from "@supabase/supabase-js";

// Service-role client for Worker contexts (Workflow, Cron dispatcher) that run outside an
// authenticated user session and therefore cannot use the cookie-based SSR client in
// `@/lib/supabase`. Bypasses RLS — callers are responsible for board-scoping their queries.
export function createServiceClient(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } });
}
