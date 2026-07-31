import type { AiBinding } from "@/lib/services/classification";

interface ClassificationBatchMessage {
  role: string;
  content: string;
}

// Deterministic stand-in for Workers AI in E2E tests. Workers AI has no local simulator — it
// always proxies to the real (billed) Cloudflare service, even under `wrangler dev` — so E2E runs
// swap this in via the classify-chunk phase's `this.env.AI_MOCK` flag (set only in
// wrangler.e2e.jsonc) instead of calling `this.env.AI` directly.
export function createMockAiBinding(): AiBinding {
  return {
    run(_model, inputs) {
      const messages = (inputs as { messages?: ClassificationBatchMessage[] }).messages ?? [];
      const userMessage = messages.find((message) => message.role === "user");
      const threads = userMessage ? (JSON.parse(userMessage.content) as { thread_id: number }[]) : [];

      const items = threads.map((thread) => ({
        thread_id: thread.thread_id,
        intent: "question",
        domain: "discussion",
      }));

      return Promise.resolve({ response: JSON.stringify(items) });
    },
  };
}
