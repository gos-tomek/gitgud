import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConsola = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("consola", () => ({ consola: mockConsola }));

const { logger } = await import("@/lib/logger");

describe("logger redaction (Risk #2)", () => {
  beforeEach(() => {
    mockConsola.info.mockClear();
    mockConsola.warn.mockClear();
    mockConsola.error.mockClear();
    mockConsola.debug.mockClear();
  });

  it("redacts a classic GitHub PAT (ghp_...)", () => {
    const pat = `ghp_${"a".repeat(36)}`;
    logger.error(`token leaked: ${pat}`);
    expect(mockConsola.error).toHaveBeenCalledWith("token leaked: [REDACTED]");
  });

  it("redacts a fine-grained GitHub PAT (github_pat_...)", () => {
    const pat = `github_pat_${"b".repeat(22)}`;
    logger.warn(`token leaked: ${pat}`);
    expect(mockConsola.warn).toHaveBeenCalledWith("token leaked: [REDACTED]");
  });

  it("redacts a Supabase service-role key (sbp_...)", () => {
    const key = `sbp_${"a1b2c3d4e5".repeat(4)}`;
    logger.info(`key leaked: ${key}`);
    expect(mockConsola.info).toHaveBeenCalledWith("key leaked: [REDACTED]");
  });

  it("leaves messages without sensitive patterns unchanged", () => {
    logger.debug("[boards] create_board_atomic failed");
    expect(mockConsola.debug).toHaveBeenCalledWith("[boards] create_board_atomic failed");
  });

  it("passes non-string first arguments through unchanged", () => {
    const err = new Error("boom");
    logger.error(err);
    expect(mockConsola.error).toHaveBeenCalledWith(err);
  });

  it("redacts a token passed as a positional rest argument", () => {
    const pat = `ghp_${"a".repeat(36)}`;
    logger.error("Failed", pat);
    expect(mockConsola.error).toHaveBeenCalledWith("Failed", "[REDACTED]");
  });

  it("passes structured object rest arguments through unchanged", () => {
    const meta = { boardName: "foo", userId: "u1", pgCode: "23505" };
    logger.error("Failed", meta);
    expect(mockConsola.error).toHaveBeenCalledWith("Failed", meta);
  });
});
