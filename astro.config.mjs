// @ts-check
import process from "node:process";
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Isolates the SSR dep-optimizer cache per spawned astro dev process (see
    // tests/helpers/astro-server.ts) — two concurrent `astro dev` instances sharing the default
    // node_modules/.vite cache race on the same optimized-deps chunk files and crash.
    cacheDir: process.env.VITE_CACHE_DIR ?? undefined,
  },
  adapter: cloudflare({
    imageService: "passthrough",
    // Disables the Cloudflare Vite plugin's inspector port entirely for test-spawned servers
    // (see tests/helpers/astro-server.ts) — its default port auto-detection has a probe-then-bind
    // race that crashes when two astro dev instances start concurrently. Not needed for automated
    // tests, which never attach Chrome DevTools; unset for normal `npm run dev`.
    inspectorPort: process.env.CLOUDFLARE_VITE_DISABLE_INSPECTOR ? false : undefined,
  }),
  // Disable Astro's built-in session (auth is handled by Supabase SSR cookies, not KV).
  // Without this the Cloudflare adapter v13 auto-wires a SESSION KV binding that doesn't exist.
  session: { driver: { entrypoint: "unstorage/drivers/null" } },
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_SERVICE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      GITHUB_TOKEN_ENCRYPTION_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
