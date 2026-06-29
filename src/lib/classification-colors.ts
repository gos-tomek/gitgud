import type { IntentCategory, TechnicalDomain, IntentTier } from "@/types";

// Order drives the stacked bar segment order and filter dropdown order.
export const INTENT_CATEGORIES: IntentCategory[] = [
  "architecture",
  "bug-catch",
  "mentoring",
  "unblocking",
  "nitpick",
  "question",
  "praise",
  "joke",
  "self-review",
  "unknown",
];

export const DOMAIN_CATEGORIES: TechnicalDomain[] = [
  "functional",
  "refactoring",
  "documentation",
  "discussion",
  "false-positive",
];

export const INTENT_COLORS: Record<IntentCategory, string> = {
  architecture: "#16a34a",
  "bug-catch": "#22c55e",
  mentoring: "#4ade80",
  unblocking: "#86efac",
  nitpick: "#2563eb",
  question: "#3b82f6",
  praise: "#93c5fd",
  joke: "#94a3b8",
  "self-review": "#cbd5e1",
  unknown: "#e2e8f0",
};

export const DOMAIN_COLORS: Record<TechnicalDomain, string> = {
  functional: "#f97316",
  refactoring: "#eab308",
  documentation: "#a855f7",
  discussion: "#ec4899",
  "false-positive": "#94a3b8",
};

// Darker shades for badge text — ensures readable contrast on the light tinted background.
export const INTENT_TEXT_COLORS: Record<IntentCategory, string> = {
  architecture: "#14532d",
  "bug-catch": "#15803d",
  mentoring: "#16a34a",
  unblocking: "#16a34a",
  nitpick: "#1e40af",
  question: "#1d4ed8",
  praise: "#1d4ed8",
  joke: "#475569",
  "self-review": "#475569",
  unknown: "#64748b",
};

export const DOMAIN_TEXT_COLORS: Record<TechnicalDomain, string> = {
  functional: "#c2410c",
  refactoring: "#854d0e",
  documentation: "#6b21a8",
  discussion: "#9d174d",
  "false-positive": "#475569",
};

export const INTENT_TIERS: Record<IntentCategory, IntentTier> = {
  architecture: "high-signal",
  "bug-catch": "high-signal",
  mentoring: "high-signal",
  unblocking: "high-signal",
  nitpick: "routine",
  question: "routine",
  praise: "routine",
  joke: "low-signal",
  "self-review": "low-signal",
  unknown: "low-signal",
};

export const INTENT_LABELS: Record<IntentCategory, string> = {
  architecture: "Architecture",
  "bug-catch": "Bug-catch",
  mentoring: "Mentoring",
  unblocking: "Unblocking",
  nitpick: "Nitpick",
  question: "Question",
  praise: "Praise",
  joke: "Joke",
  "self-review": "Self-review",
  unknown: "Unknown",
};

export const DOMAIN_LABELS: Record<TechnicalDomain, string> = {
  functional: "Functional",
  refactoring: "Refactoring",
  documentation: "Documentation",
  discussion: "Discussion",
  "false-positive": "False-positive",
};

// Sourced from context/changes/profile-classified-comments/research.md §5 (prototype tooltip table).
export const CATEGORY_TOOLTIPS: Record<string, string> = {
  architecture:
    "A structural, component, API, or data-flow change — or a firm objection to recreating something that already exists.",
  "bug-catch":
    "Asserts a concrete defect or broken behaviour — a claim that something IS currently wrong, not just a suggestion.",
  mentoring: "Explains a concept, convention, or rationale aimed at the author's growth.",
  unblocking: "A concrete next step in prose, for an issue this comment doesn't itself flag as broken.",
  nitpick: "Trivial style, naming, or formatting point — tests would pass either way.",
  question: "Asks for clarification or rationale — must be phrased as an actual question.",
  praise: "Approval or thanks from the reviewer, with no code change requested.",
  "joke-group":
    "Off-topic banter, the PR author commenting on their own thread, CI/bot noise, or anything the model couldn't classify.",
  functional: "Correctness, bugs, or security — whether the code behaves right.",
  refactoring: "Changes structure without changing behaviour — cleanups, renames, reorganisation.",
  documentation: "Docstrings, READMEs, and code comments — explanatory text rather than logic.",
  discussion: "Questions, design conversation, or praise — not tied to correctness or structure.",
  "false-positive": "A concern that was raised and then conclusively withdrawn or refuted in the thread.",
};
