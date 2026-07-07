// @ts-check
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
  },
  adapter: cloudflare({ imageService: "passthrough" }),
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
