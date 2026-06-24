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
  architecture: "#3b82f6",
  "bug-catch": "#ef4444",
  mentoring: "#10b981",
  unblocking: "#06b6d4",
  nitpick: "#f59e0b",
  question: "#8b5cf6",
  praise: "#eab308",
  joke: "#ec4899",
  "self-review": "#a1a1aa",
  unknown: "#d4d4d8",
};

export const DOMAIN_COLORS: Record<TechnicalDomain, string> = {
  functional: "#7c3aed",
  refactoring: "#0ea5e9",
  documentation: "#10b981",
  discussion: "#f59e0b",
  "false-positive": "#d4d4d8",
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
