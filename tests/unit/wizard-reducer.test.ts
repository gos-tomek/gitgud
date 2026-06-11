import { describe, it, expect } from "vitest";
import {
  wizardReducer,
  initialState,
  type WizardState,
  type WizardAction,
  type PatValidation,
  type RepoItem,
  type CollaboratorItem,
} from "@/components/wizard-reducer";

const REPO_A: RepoItem = {
  owner: "octocat",
  name: "hello-world",
  fullName: "octocat/hello-world",
  private: false,
  pushAccess: true,
};
const REPO_B: RepoItem = {
  owner: "octocat",
  name: "spoon-knife",
  fullName: "octocat/spoon-knife",
  private: true,
  pushAccess: false,
};

const COLLAB_A: CollaboratorItem = {
  login: "octocat",
  id: 1,
  avatarUrl: "https://avatars.example/octocat.png",
  type: "User",
};
const COLLAB_B: CollaboratorItem = {
  login: "monalisa",
  id: 2,
  avatarUrl: "https://avatars.example/monalisa.png",
  type: "User",
};

const VALID_PAT: PatValidation = {
  status: "valid",
  login: "octocat",
  avatarUrl: "https://avatars.example/octocat.png",
};

function step1(overrides: Partial<Extract<WizardState, { step: 1 }>> = {}): Extract<WizardState, { step: 1 }> {
  return { ...initialState, ...overrides };
}

function step2(overrides: Partial<Extract<WizardState, { step: 2 }>> = {}): Extract<WizardState, { step: 2 }> {
  return {
    step: 2,
    name: "My Board",
    pat: "ghp_validtoken",
    patValidation: VALID_PAT,
    selectedRepos: [],
    selectedContributors: [],
    apiError: undefined,
    submitting: false,
    repos: [REPO_A, REPO_B],
    reposLoading: false,
    reposError: undefined,
    repoFilter: "",
    manualEntry: "",
    manualEntryLoading: false,
    manualEntryError: undefined,
    ...overrides,
  };
}

function step3(overrides: Partial<Extract<WizardState, { step: 3 }>> = {}): Extract<WizardState, { step: 3 }> {
  return {
    step: 3,
    name: "My Board",
    pat: "ghp_validtoken",
    patValidation: VALID_PAT,
    selectedRepos: [REPO_A],
    selectedContributors: [],
    apiError: undefined,
    submitting: false,
    collaborators: [COLLAB_A, COLLAB_B],
    collaboratorsLoading: false,
    collaboratorsError: undefined,
    contributorFilter: "",
    ...overrides,
  };
}

describe("initialState", () => {
  it("starts at step 1 with idle PAT validation and empty selections", () => {
    expect(initialState.step).toBe(1);
    expect(initialState.patValidation).toEqual({ status: "idle" });
    expect(initialState.selectedRepos).toEqual([]);
    expect(initialState.selectedContributors).toEqual([]);
    expect(initialState.submitting).toBe(false);
  });
});

describe("step transitions", () => {
  it("NEXT_TO_STEP_2 transitions when name is non-empty and PAT is valid", () => {
    const state = step1({ name: "My Board", patValidation: VALID_PAT });

    const result = wizardReducer(state, { type: "NEXT_TO_STEP_2" });

    expect(result.step).toBe(2);
    if (result.step !== 2) throw new Error("expected step 2");
    expect(result.name).toBe("My Board");
    expect(result.pat).toBe(state.pat);
    expect(result.patValidation).toEqual(VALID_PAT);
    expect(result.repos).toEqual([]);
    expect(result.reposLoading).toBe(false);
  });

  it.each([
    ["empty name", step1({ name: "", patValidation: VALID_PAT })],
    ["PAT not yet validated", step1({ name: "My Board", patValidation: { status: "idle" } })],
    ["PAT validation failed", step1({ name: "My Board", patValidation: { status: "error", message: "bad token" } })],
  ])("NEXT_TO_STEP_2 is rejected when %s — state stays at step 1", (_label, state) => {
    const result = wizardReducer(state, { type: "NEXT_TO_STEP_2" });

    expect(result).toBe(state);
    expect(result.step).toBe(1);
  });

  it("BACK_TO_STEP_1 preserves name, pat, patValidation and selectedRepos", () => {
    const state = step2({ selectedRepos: [REPO_A] });

    const result = wizardReducer(state, { type: "BACK_TO_STEP_1" });

    expect(result.step).toBe(1);
    expect(result.name).toBe(state.name);
    expect(result.pat).toBe(state.pat);
    expect(result.patValidation).toEqual(state.patValidation);
    expect(result.selectedRepos).toEqual([REPO_A]);
  });

  it("NEXT_TO_STEP_3 is rejected when no repos are selected — state stays at step 2", () => {
    const state = step2({ selectedRepos: [] });

    const result = wizardReducer(state, { type: "NEXT_TO_STEP_3" });

    expect(result).toBe(state);
    expect(result.step).toBe(2);
  });

  it("NEXT_TO_STEP_3 transitions when at least one repo is selected", () => {
    const state = step2({ selectedRepos: [REPO_A] });

    const result = wizardReducer(state, { type: "NEXT_TO_STEP_3" });

    expect(result.step).toBe(3);
    if (result.step !== 3) throw new Error("expected step 3");
    expect(result.selectedRepos).toEqual([REPO_A]);
    expect(result.collaborators).toEqual([]);
    expect(result.collaboratorsLoading).toBe(false);
  });

  it("BACK_TO_STEP_2 clears selectedContributors (Bug 1 fix) and preserves selectedRepos", () => {
    const state = step3({ selectedRepos: [REPO_A], selectedContributors: [COLLAB_B] });

    const result = wizardReducer(state, { type: "BACK_TO_STEP_2" });

    expect(result.step).toBe(2);
    expect(result.selectedContributors).toEqual([]);
    expect(result.selectedRepos).toEqual([REPO_A]);
  });

  const noOpCases: { name: string; state: WizardState; action: WizardAction }[] = [
    { name: "NEXT_TO_STEP_3 from step 1", state: step1(), action: { type: "NEXT_TO_STEP_3" } },
    { name: "BACK_TO_STEP_2 from step 1", state: step1(), action: { type: "BACK_TO_STEP_2" } },
    { name: "BACK_TO_STEP_1 from step 1", state: step1(), action: { type: "BACK_TO_STEP_1" } },
    { name: "NEXT_TO_STEP_2 from step 2", state: step2(), action: { type: "NEXT_TO_STEP_2" } },
    { name: "BACK_TO_STEP_1 from step 3", state: step3(), action: { type: "BACK_TO_STEP_1" } },
  ];

  it.each(noOpCases)("$name is a no-op", ({ state, action }) => {
    expect(wizardReducer(state, action)).toBe(state);
  });
});

describe("PAT validation (Bugs 2 & 3)", () => {
  it("SET_PAT resets patValidation to idle, cancelling any in-flight validation (Bug 2 fix)", () => {
    const state = step1({ patValidation: { status: "validating" } });

    const result = wizardReducer(state, { type: "SET_PAT", pat: "ghp_newtoken" });

    expect(result.pat).toBe("ghp_newtoken");
    expect(result.patValidation).toEqual({ status: "idle" });
  });

  it("SET_PAT resets a previously valid PAT to idle when the token is edited", () => {
    const state = step1({ pat: "ghp_oldtoken", patValidation: VALID_PAT });

    const result = wizardReducer(state, { type: "SET_PAT", pat: "ghp_oldtoken2" });

    expect(result.patValidation).toEqual({ status: "idle" });
  });

  it("SET_PAT flags fine-grained tokens as unsupported", () => {
    const state = step1({ patValidation: { status: "idle" } });

    const result = wizardReducer(state, { type: "SET_PAT", pat: "github_pat_abc123" });

    expect(result.patValidation.status).toBe("error");
    expect(result.patValidation.message).toMatch(/classic PAT/);
  });

  it("VALIDATE_PAT_START sets status to validating", () => {
    const state = step1({ patValidation: { status: "idle" } });

    const result = wizardReducer(state, { type: "VALIDATE_PAT_START" });

    expect(result.patValidation).toEqual({ status: "validating" });
  });

  it("VALIDATE_PAT_SUCCESS stores warnings in patValidation (Bug 3 fix)", () => {
    const state = step1({ patValidation: { status: "validating" } });

    const result = wizardReducer(state, {
      type: "VALIDATE_PAT_SUCCESS",
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      warnings: ["Token is missing the read:org scope"],
    });

    expect(result.patValidation).toEqual({
      status: "valid",
      login: "octocat",
      avatarUrl: "https://avatars.example/octocat.png",
      warnings: ["Token is missing the read:org scope"],
    });
  });

  it("VALIDATE_PAT_ERROR sets status to error with the given message", () => {
    const state = step1({ patValidation: { status: "validating" } });

    const result = wizardReducer(state, { type: "VALIDATE_PAT_ERROR", message: "Token is invalid or expired" });

    expect(result.patValidation).toEqual({ status: "error", message: "Token is invalid or expired" });
  });
});

describe("submission requires at least one contributor (Bug 4 reclassified)", () => {
  it("SUBMIT_START is rejected from step 3 with zero selectedContributors", () => {
    const state = step3({ selectedContributors: [] });

    const result = wizardReducer(state, { type: "SUBMIT_START" });

    expect(result).toBe(state);
    expect(result.submitting).toBe(false);
  });

  it("SUBMIT_START succeeds from step 3 once at least one contributor is selected", () => {
    const state = step3({ selectedContributors: [COLLAB_A] });

    const result = wizardReducer(state, { type: "SUBMIT_START" });

    expect(result.step).toBe(3);
    expect(result.submitting).toBe(true);
    expect(result.apiError).toBeUndefined();
  });

  it("SUBMIT_ERROR stops submitting and records the error", () => {
    const state = step3({ submitting: true, selectedContributors: [COLLAB_A] });

    const result = wizardReducer(state, { type: "SUBMIT_ERROR", message: "Board creation failed" });

    expect(result.submitting).toBe(false);
    expect(result.apiError).toBe("Board creation failed");
  });
});

describe("repo and contributor selection", () => {
  it("TOGGLE_REPO_SELECTION adds then removes a repo", () => {
    const selected = wizardReducer(step2({ selectedRepos: [] }), { type: "TOGGLE_REPO_SELECTION", repo: REPO_A });
    expect(selected.selectedRepos).toEqual([REPO_A]);

    const deselected = wizardReducer(selected, { type: "TOGGLE_REPO_SELECTION", repo: REPO_A });
    expect(deselected.selectedRepos).toEqual([]);
  });

  it("TOGGLE_CONTRIBUTOR_SELECTION adds then removes a contributor", () => {
    const selected = wizardReducer(step3({ selectedContributors: [] }), {
      type: "TOGGLE_CONTRIBUTOR_SELECTION",
      contributor: COLLAB_A,
    });
    expect(selected.selectedContributors).toEqual([COLLAB_A]);

    const deselected = wizardReducer(selected, { type: "TOGGLE_CONTRIBUTOR_SELECTION", contributor: COLLAB_A });
    expect(deselected.selectedContributors).toEqual([]);
  });

  it("CLEAR_SELECTED_REPOS empties selectedRepos regardless of step", () => {
    const result = wizardReducer(step2({ selectedRepos: [REPO_A, REPO_B] }), { type: "CLEAR_SELECTED_REPOS" });
    expect(result.selectedRepos).toEqual([]);
  });
});

describe("fetch lifecycles", () => {
  it("FETCH_REPOS_START/SUCCESS/ERROR update loading, data and error fields", () => {
    const loading = wizardReducer(step2({ reposError: "stale error" }), { type: "FETCH_REPOS_START" });
    expect(loading.reposLoading).toBe(true);
    expect(loading.reposError).toBeUndefined();

    const success = wizardReducer(loading, { type: "FETCH_REPOS_SUCCESS", repos: [REPO_A] });
    expect(success.reposLoading).toBe(false);
    expect(success.repos).toEqual([REPO_A]);

    const error = wizardReducer(loading, { type: "FETCH_REPOS_ERROR", message: "Network error" });
    expect(error.reposLoading).toBe(false);
    expect(error.reposError).toBe("Network error");
  });

  it("FETCH_REPOS_SUCCESS keeps a previously-selected repo visible even when absent from the fetched list", () => {
    const manuallyAdded: RepoItem = {
      owner: "facebook",
      name: "react",
      fullName: "facebook/react",
      private: false,
      pushAccess: false,
    };
    const state = step2({ repos: [], selectedRepos: [manuallyAdded] });

    const result = wizardReducer(state, { type: "FETCH_REPOS_SUCCESS", repos: [REPO_A] });

    expect(result.repos).toEqual([REPO_A, manuallyAdded]);
    expect(result.selectedRepos).toEqual([manuallyAdded]);
  });

  it("FETCH_COLLABORATORS_START/SUCCESS/ERROR update loading, data and error fields", () => {
    const loading = wizardReducer(step3({ collaboratorsError: "stale error" }), { type: "FETCH_COLLABORATORS_START" });
    expect(loading.collaboratorsLoading).toBe(true);
    expect(loading.collaboratorsError).toBeUndefined();

    const success = wizardReducer(loading, { type: "FETCH_COLLABORATORS_SUCCESS", collaborators: [COLLAB_A] });
    expect(success.collaboratorsLoading).toBe(false);
    expect(success.collaborators).toEqual([COLLAB_A]);

    const error = wizardReducer(loading, { type: "FETCH_COLLABORATORS_ERROR", message: "Network error" });
    expect(error.collaboratorsLoading).toBe(false);
    expect(error.collaboratorsError).toBe("Network error");
  });
});
