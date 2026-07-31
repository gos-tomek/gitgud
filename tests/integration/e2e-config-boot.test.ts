import { checkSupabase } from "../helpers/setup.js";
import { startAstroServer, type AstroServerHandle } from "../helpers/astro-server.js";

// astro dev still needs Supabase credentials in .dev.vars to boot cleanly, even though this
// test never exercises a Supabase-backed route — same guard pattern as pat-leak.test.ts.
const supabaseAvailable = await checkSupabase();
const DEV_SERVER_PORT = 4323;

describe.skipIf(!supabaseAvailable)("E2E config boot check", () => {
  let server: AstroServerHandle | undefined;

  afterAll(async () => {
    await server?.stop();
  });

  it("astro dev boots with CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=./wrangler.e2e.jsonc and serves 200 on /", async () => {
    server = await startAstroServer(DEV_SERVER_PORT, {
      CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH: "./wrangler.e2e.jsonc",
    });

    const res = await fetch(`${server.baseUrl}/`);
    expect(res.status).toBe(200);
  }, 150_000);
});
