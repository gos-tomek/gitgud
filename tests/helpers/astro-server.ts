import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface AstroServerHandle {
  stop: () => Promise<void>;
  output: () => string[];
  baseUrl: string;
}

// Matches Astro's "┃ Local    http://localhost:4326/" line
// (and wrangler's "Ready on http://0.0.0.0:4326" variant).
// Captures just the origin — e.g. "http://localhost:4326".
const LOCAL_URL_RE = /(https?:\/\/[^\s/]+)/;
const LOCAL_LINE_RE = /\blocal\b/i;

/**
 * Spawns `astro dev` on the requested port and waits until the server is
 * actually accepting connections. The server may auto-select a different port
 * if the requested one is busy — the returned `baseUrl` reflects the actual
 * URL parsed from Astro's stdout.
 *
 * All stdout/stderr lines are captured for later PAT-leak assertions.
 * The server is started from the project root so `.dev.vars` is picked up.
 */
export async function startAstroServer(port: number): Promise<AstroServerHandle> {
  const outputLines: string[] = [];

  const proc: ChildProcess = spawn("npx", ["astro", "dev", "--port", String(port)], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    // detached: spawn in its own process group so `stop()` can kill the whole tree
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Prevent the Node process from waiting on this child
  proc.unref();

  // Resolve to the actual base URL once the server is accepting connections.
  // Strategy: parse Astro's "Local  http://…" line to get the real origin, then
  // HTTP-poll that origin until we get a response.
  const baseUrl = await new Promise<string>((resolve, reject) => {
    const TIMEOUT_MS = 120_000;
    const deadline = Date.now() + TIMEOUT_MS;
    let settled = false;
    let detectedOrigin: string | null = null;

    const done = (err: Error | null, url?: string) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(url ?? "");
    };

    const failWithOutput = (msg: string) => {
      const tail = outputLines.slice(-30).join("\n");
      done(new Error(`${msg}\nLast server output:\n${tail || "(none)"}`));
    };

    proc.once("exit", (code) => {
      if (code !== null && code !== 0) {
        failWithOutput(`Astro dev server exited prematurely with code ${code}.`);
      }
    });
    proc.once("error", (err) => {
      done(err);
    });

    // HTTP poll against the detected origin; fall back to the requested port
    // until the "Local" line arrives.
    const pollHttp = () => {
      if (settled) return;
      if (Date.now() > deadline) {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
        failWithOutput(`Astro dev server did not become ready within ${TIMEOUT_MS / 1000}s.`);
        return;
      }
      const target = detectedOrigin ?? `http://127.0.0.1:${port}`;
      fetch(`${target}/`)
        .then(() => {
          done(null, target);
        })
        .catch(() => setTimeout(pollHttp, 500));
    };

    const processChunk = (data: Buffer) => {
      data
        .toString()
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((line) => {
          outputLines.push(line);
          // Detect "┃ Local    http://localhost:NNNN/" to capture the actual origin
          if (!detectedOrigin && LOCAL_LINE_RE.test(line)) {
            const m = LOCAL_URL_RE.exec(line);
            if (m) {
              detectedOrigin = m[1];
            }
          }
        });
    };

    proc.stdout?.on("data", processChunk);
    proc.stderr?.on("data", processChunk);

    pollHttp();
  });

  return {
    stop: () =>
      new Promise<void>((res) => {
        if (proc.pid) {
          try {
            // Kill the entire process group (includes wrangler workers)
            process.kill(-proc.pid, "SIGTERM");
          } catch {
            // Process may have already exited
          }
        }
        const forceKill = setTimeout(() => {
          if (proc.pid) {
            try {
              process.kill(-proc.pid, "SIGKILL");
            } catch {
              /* ignore */
            }
          }
          res();
        }, 8_000);
        proc.once("exit", () => {
          clearTimeout(forceKill);
          res();
        });
      }),
    output: () => [...outputLines],
    baseUrl,
  };
}

/**
 * Reads a single key from the Cloudflare `.dev.vars` file (KEY=VALUE format).
 * Returns undefined if the file doesn't exist or the key is absent.
 */
export function readDevVarsKey(key: string): string | undefined {
  const devVarsPath = path.resolve(PROJECT_ROOT, ".dev.vars");
  if (!existsSync(devVarsPath)) return undefined;
  const content = readFileSync(devVarsPath, "utf-8");
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(content);
  const val = match?.[1]?.trim();
  return val !== "" ? val : undefined;
}
