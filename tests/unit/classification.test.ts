import { describe, it, expect } from "vitest";
import {
  isBotComment,
  assembleThreadPayload,
  parseClassificationOutput,
  extractJsonObject,
} from "@/lib/services/classification";

function comment(overrides: Partial<Parameters<typeof assembleThreadPayload>[0]> = {}) {
  return {
    id: 1,
    pull_request_id: 100,
    in_reply_to_id: null,
    commenter_login: "reviewer-1",
    body: "root comment",
    path: null,
    position_line: null,
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isBotComment", () => {
  it.each([
    ["dependabot[bot]", true],
    ["renovate[bot]", true],
    ["codecov-bot", true],
    ["github-actions[bot]", true],
    ["dependabot", true],
    ["regular-user", false],
    ["alice", false],
    ["botuser", false],
    ["robot", false],
  ])("isBotComment(%s) -> %s", (login, expected) => {
    expect(isBotComment(login)).toBe(expected);
  });
});

describe("assembleThreadPayload", () => {
  const prMeta = { title: "Add login flow", authorLogin: "pr-author-1" };

  it("builds an inline thread payload (path + position_line set)", () => {
    const root = comment({ path: "src/auth.ts", position_line: 42, commenter_login: "reviewer-1" });
    const payload = assembleThreadPayload(root, [], prMeta, "@@ -40,3 +40,3 @@");

    expect(payload.isInline).toBe(true);
    expect(payload.path).toBe("src/auth.ts");
    expect(payload.diffHunk).toBe("@@ -40,3 +40,3 @@");
  });

  it("builds a general thread payload (no path)", () => {
    const root = comment({ path: null, commenter_login: "reviewer-1" });
    const payload = assembleThreadPayload(root, [], prMeta, null);

    expect(payload.isInline).toBe(false);
    expect(payload.path).toBeNull();
    expect(payload.diffHunk).toBeNull();
  });

  it("single-comment thread has exactly one entry, attributed to the reviewer", () => {
    const root = comment({ commenter_login: "reviewer-1", body: "why this approach?" });
    const payload = assembleThreadPayload(root, [], prMeta, null);

    expect(payload.comments).toEqual([{ role: "reviewer", body: "why this approach?" }]);
  });

  it("multi-reply thread orders replies chronologically and attributes roles", () => {
    const root = comment({
      id: 1,
      commenter_login: "reviewer-1",
      body: "why this approach?",
      created_at: "2026-06-01T00:00:00.000Z",
    });
    const replyLate = comment({
      id: 3,
      in_reply_to_id: 1,
      commenter_login: "pr-author-1",
      body: "because of X",
      created_at: "2026-06-01T02:00:00.000Z",
    });
    const replyEarly = comment({
      id: 2,
      in_reply_to_id: 1,
      commenter_login: "third-party",
      body: "I wondered too",
      created_at: "2026-06-01T01:00:00.000Z",
    });

    // Pass replies out of chronological order — assembleThreadPayload must sort them.
    const payload = assembleThreadPayload(root, [replyLate, replyEarly], prMeta, null);

    expect(payload.comments).toEqual([
      { role: "reviewer", body: "why this approach?" },
      { role: "other", body: "I wondered too" },
      { role: "pr-author", body: "because of X" },
    ]);
  });
});

describe("parseClassificationOutput", () => {
  const valid = {
    intent: "bug-catch",
    domain: "functional",
    constructive: true,
    knowledge_direction: "peer-exchange",
    confidence: 0.8,
  };

  it("returns the parsed object for valid output", () => {
    expect(parseClassificationOutput(valid)).toEqual(valid);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseClassificationOutput("not an object")).toThrow();
  });

  it("rejects a payload missing a required field", () => {
    const { confidence, ...missingConfidence } = valid;
    void confidence;
    expect(() => parseClassificationOutput(missingConfidence)).toThrow();
  });

  it("rejects an out-of-range confidence", () => {
    expect(() => parseClassificationOutput({ ...valid, confidence: 1.5 })).toThrow();
  });

  it("rejects an invalid intent enum value", () => {
    expect(() => parseClassificationOutput({ ...valid, intent: "sarcasm" })).toThrow();
  });

  it("rejects an invalid domain enum value", () => {
    expect(() => parseClassificationOutput({ ...valid, domain: "vibes" })).toThrow();
  });

  it("rejects a non-boolean constructive value", () => {
    expect(() => parseClassificationOutput({ ...valid, constructive: "yes" })).toThrow();
  });
});

describe("extractJsonObject", () => {
  const obj = { intent: "bug-catch", domain: "functional", constructive: true };
  const json = JSON.stringify(obj);

  it("returns raw JSON unchanged", () => {
    expect(JSON.parse(extractJsonObject(json))).toEqual(obj);
  });

  it("strips ```json ... ``` markdown fences", () => {
    const fenced = `\`\`\`json\n${json}\n\`\`\``;
    expect(JSON.parse(extractJsonObject(fenced))).toEqual(obj);
  });

  it("strips bare ``` ... ``` fences (no language tag)", () => {
    const fenced = `\`\`\`\n${json}\n\`\`\``;
    expect(JSON.parse(extractJsonObject(fenced))).toEqual(obj);
  });

  it("strips leading prose before the JSON object", () => {
    const withProse = `Sure, here's the classification:\n${json}`;
    expect(JSON.parse(extractJsonObject(withProse))).toEqual(obj);
  });

  it("returns the input unchanged when no braces are found", () => {
    expect(extractJsonObject("no json here")).toBe("no json here");
  });
});
