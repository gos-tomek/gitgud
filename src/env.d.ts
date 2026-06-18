declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}

interface Env {
  ASSETS: Fetcher;
  AI: Ai;
  CLASSIFICATION_BATCH: Workflow<{ boardId: string }>;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  GITHUB_TOKEN_ENCRYPTION_KEY: string;
}
