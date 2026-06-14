import { consola } from "consola";

// Risk #2 (pat-leak): scrub known secret formats from log output before they
// reach consola, in case a catch block accidentally logs a raw token.
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /ghp_[A-Za-z0-9_]{36,}/g, // classic GitHub PAT
  /github_pat_[A-Za-z0-9_]{22,}/g, // fine-grained GitHub PAT
  /sbp_[a-f0-9]{40,}/g, // Supabase service-role key
];

function redact(message: unknown): unknown {
  if (typeof message !== "string") return message;
  return SENSITIVE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[REDACTED]"), message);
}

type LogMethod = (message: unknown, ...args: unknown[]) => void;

function wrap(method: "info" | "warn" | "error" | "debug"): LogMethod {
  return (message, ...args) => {
    consola[method](redact(message), ...args);
  };
}

export const logger = {
  info: wrap("info"),
  warn: wrap("warn"),
  error: wrap("error"),
  debug: wrap("debug"),
};
