declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}

// `import { env } from "cloudflare:workers"` is typed as `Cloudflare.Env` (declaration-merged
// here), not the bare global `Env` below — both must declare the same bindings.
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    AI: Ai;
    CLASSIFICATION_BATCH: Workflow<{ boardId: string }>;
    SUPABASE_URL: string;
    SUPABASE_KEY: string;
    SUPABASE_SERVICE_KEY: string;
    GITHUB_TOKEN_ENCRYPTION_KEY: string;
    HOMEPAGE_CACHE: KVNamespace;
  }
}

type Env = Cloudflare.Env;
