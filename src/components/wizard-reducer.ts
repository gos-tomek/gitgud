// State machine for the board-creation wizard (CreateBoardForm).
// Pure reducer: no side effects, no async. Async orchestration (fetches,
// debounced PAT validation) lives in the component and dispatches the
// start/success/error action pairs defined below.

export type PatStatus = "idle" | "validating" | "valid" | "error";

export interface PatValidation {
  status: PatStatus;
  login?: string;
  avatarUrl?: string;
  message?: string;
  warnings?: string[];
  expiresAt?: string | null;
}

export interface StoredPat {
  login: string;
  expiresAt: string | null;
}

export interface RepoItem {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  pushAccess: boolean;
}

export interface CollaboratorItem {
  login: string;
  id: number;
  avatarUrl: string;
  type: string;
}

// Fields shared across all steps. selectedRepos and selectedContributors are
// included here (rather than only on steps 2/3) so that BACK_TO_STEP_1
// preserves the user's repo selection and BACK_TO_STEP_2 can clear the
// contributor selection (Bug 1) directly on the resulting step-2 state.
interface WizardCore {
  name: string;
  pat: string;
  usingStoredPat: boolean;
  patValidation: PatValidation;
  selectedRepos: RepoItem[];
  selectedContributors: CollaboratorItem[];
  apiError?: string;
  submitting: boolean;
}

export type WizardState =
  | (WizardCore & {
      step: 1;
      nameError?: string;
      checkingName: boolean;
      patVisible: boolean;
    })
  | (WizardCore & {
      step: 2;
      repos: RepoItem[];
      reposLoading: boolean;
      reposError?: string;
      repoFilter: string;
      manualEntry: string;
      manualEntryLoading: boolean;
      manualEntryError?: string;
    })
  | (WizardCore & {
      step: 3;
      collaborators: CollaboratorItem[];
      collaboratorsLoading: boolean;
      collaboratorsError?: string;
      contributorFilter: string;
    });

export type WizardAction =
  | { type: "SET_NAME"; name: string }
  | { type: "SET_NAME_ERROR"; error: string }
  | { type: "SET_CHECKING_NAME"; checking: boolean }
  | { type: "SET_PAT"; pat: string }
  | { type: "TOGGLE_PAT_VISIBLE" }
  | { type: "VALIDATE_PAT_START" }
  | { type: "VALIDATE_PAT_SUCCESS"; login: string; avatarUrl?: string; warnings?: string[]; expiresAt?: string | null }
  | { type: "VALIDATE_PAT_ERROR"; message: string }
  | { type: "USE_STORED_PAT"; login: string; expiresAt: string | null }
  | { type: "USE_DIFFERENT_TOKEN" }
  | { type: "NEXT_TO_STEP_2" }
  | { type: "BACK_TO_STEP_1" }
  | { type: "NEXT_TO_STEP_3" }
  | { type: "BACK_TO_STEP_2" }
  | { type: "CLEAR_SELECTED_REPOS" }
  | { type: "SET_REPO_FILTER"; filter: string }
  | { type: "TOGGLE_REPO_SELECTION"; repo: RepoItem }
  | { type: "FETCH_REPOS_START" }
  | { type: "FETCH_REPOS_SUCCESS"; repos: RepoItem[] }
  | { type: "FETCH_REPOS_ERROR"; message: string }
  | { type: "SET_MANUAL_ENTRY"; value: string }
  | { type: "ADD_MANUAL_REPO_START" }
  | { type: "ADD_MANUAL_REPO_SUCCESS"; repo: RepoItem }
  | { type: "ADD_MANUAL_REPO_ERROR"; message: string }
  | { type: "SET_CONTRIBUTOR_FILTER"; filter: string }
  | { type: "TOGGLE_CONTRIBUTOR_SELECTION"; contributor: CollaboratorItem }
  | { type: "FETCH_COLLABORATORS_START" }
  | { type: "FETCH_COLLABORATORS_SUCCESS"; collaborators: CollaboratorItem[] }
  | { type: "FETCH_COLLABORATORS_ERROR"; message: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "SET_API_ERROR"; error?: string };

export const initialState: WizardState = {
  step: 1,
  name: "",
  nameError: undefined,
  checkingName: false,
  pat: "",
  usingStoredPat: false,
  patVisible: false,
  patValidation: { status: "idle" },
  selectedRepos: [],
  selectedContributors: [],
  apiError: undefined,
  submitting: false,
};

// useReducer lazy-initializer: when the wizard mounts with a previously-stored PAT (per-user
// PAT model), default straight to "valid" with the stored identity instead of making the user
// re-enter and re-validate a token we already have.
export function initWizardState(storedPat?: StoredPat | null): WizardState {
  if (!storedPat) return initialState;
  return {
    ...initialState,
    usingStoredPat: true,
    patValidation: { status: "valid", login: storedPat.login, expiresAt: storedPat.expiresAt },
  };
}

const FINE_GRAINED_PAT_ERROR = "Fine-grained tokens are not supported. Please use a classic PAT (starts with ghp_).";

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_NAME": {
      if (state.step !== 1) return state;
      return { ...state, name: action.name, nameError: undefined };
    }

    case "SET_NAME_ERROR": {
      if (state.step !== 1) return state;
      return { ...state, nameError: action.error, checkingName: false };
    }

    case "SET_CHECKING_NAME": {
      if (state.step !== 1) return state;
      return { ...state, checkingName: action.checking };
    }

    case "SET_PAT": {
      if (state.step !== 1) return state;
      const trimmed = action.pat.trim();
      let patValidation: PatValidation;
      if (trimmed.startsWith("github_pat_")) {
        patValidation = { status: "error", message: FINE_GRAINED_PAT_ERROR };
      } else {
        // Bug 2 fix: any new PAT input resets validation to idle, cancelling
        // any in-flight validation. The component dispatches
        // VALIDATE_PAT_START once its debounce timer fires.
        patValidation = { status: "idle" };
      }
      return { ...state, pat: action.pat, patValidation };
    }

    case "TOGGLE_PAT_VISIBLE": {
      if (state.step !== 1) return state;
      return { ...state, patVisible: !state.patVisible };
    }

    case "VALIDATE_PAT_START": {
      if (state.step !== 1) return state;
      return { ...state, patValidation: { status: "validating" } };
    }

    case "VALIDATE_PAT_SUCCESS": {
      if (state.step !== 1) return state;
      return {
        ...state,
        patValidation: {
          status: "valid",
          login: action.login,
          avatarUrl: action.avatarUrl,
          warnings: action.warnings,
          expiresAt: action.expiresAt,
        },
      };
    }

    case "VALIDATE_PAT_ERROR": {
      if (state.step !== 1) return state;
      return { ...state, patValidation: { status: "error", message: action.message } };
    }

    case "USE_STORED_PAT": {
      if (state.step !== 1) return state;
      return {
        ...state,
        pat: "",
        usingStoredPat: true,
        patValidation: { status: "valid", login: action.login, expiresAt: action.expiresAt },
      };
    }

    case "USE_DIFFERENT_TOKEN": {
      if (state.step !== 1) return state;
      return { ...state, pat: "", usingStoredPat: false, patValidation: { status: "idle" } };
    }

    case "NEXT_TO_STEP_2": {
      if (state.step !== 1) return state;
      if (!state.name.trim() || state.patValidation.status !== "valid") return state;
      return {
        step: 2,
        name: state.name,
        pat: state.pat,
        usingStoredPat: state.usingStoredPat,
        patValidation: state.patValidation,
        selectedRepos: state.selectedRepos,
        selectedContributors: state.selectedContributors,
        apiError: undefined,
        submitting: false,
        repos: [],
        reposLoading: false,
        reposError: undefined,
        repoFilter: "",
        manualEntry: "",
        manualEntryLoading: false,
        manualEntryError: undefined,
      };
    }

    case "BACK_TO_STEP_1": {
      if (state.step !== 2) return state;
      return {
        step: 1,
        name: state.name,
        nameError: undefined,
        checkingName: false,
        pat: state.pat,
        usingStoredPat: state.usingStoredPat,
        patVisible: false,
        patValidation: state.patValidation,
        selectedRepos: state.selectedRepos,
        selectedContributors: state.selectedContributors,
        apiError: undefined,
        submitting: false,
      };
    }

    case "NEXT_TO_STEP_3": {
      if (state.step !== 2) return state;
      if (state.selectedRepos.length === 0) return state;
      return {
        step: 3,
        name: state.name,
        pat: state.pat,
        usingStoredPat: state.usingStoredPat,
        patValidation: state.patValidation,
        selectedRepos: state.selectedRepos,
        selectedContributors: state.selectedContributors,
        apiError: undefined,
        submitting: false,
        collaborators: [],
        collaboratorsLoading: false,
        collaboratorsError: undefined,
        contributorFilter: "",
      };
    }

    case "BACK_TO_STEP_2": {
      if (state.step !== 3) return state;
      return {
        step: 2,
        name: state.name,
        pat: state.pat,
        usingStoredPat: state.usingStoredPat,
        patValidation: state.patValidation,
        selectedRepos: state.selectedRepos,
        // Bug 1 fix: contributors picked during the previous Step 3 visit
        // don't carry forward — the collaborator list is refetched fresh.
        selectedContributors: [],
        apiError: undefined,
        submitting: false,
        repos: [],
        reposLoading: false,
        reposError: undefined,
        repoFilter: "",
        manualEntry: "",
        manualEntryLoading: false,
        manualEntryError: undefined,
      };
    }

    case "CLEAR_SELECTED_REPOS": {
      return { ...state, selectedRepos: [] };
    }

    case "SET_REPO_FILTER": {
      if (state.step !== 2) return state;
      return { ...state, repoFilter: action.filter };
    }

    case "TOGGLE_REPO_SELECTION": {
      if (state.step !== 2) return state;
      const exists = state.selectedRepos.some((r) => r.fullName === action.repo.fullName);
      return {
        ...state,
        selectedRepos: exists
          ? state.selectedRepos.filter((r) => r.fullName !== action.repo.fullName)
          : [...state.selectedRepos, action.repo],
      };
    }

    case "FETCH_REPOS_START": {
      if (state.step !== 2) return state;
      return { ...state, reposLoading: true, reposError: undefined };
    }

    case "FETCH_REPOS_SUCCESS": {
      if (state.step !== 2) return state;
      // Manually-added repos (e.g. public repos the PAT owner doesn't have
      // access to) won't appear in the freshly-fetched list. Keep any
      // already-selected repo visible so it stays toggleable and the
      // selection count stays accurate.
      const fetchedNames = new Set(action.repos.map((r) => r.fullName.toLowerCase()));
      const missingSelected = state.selectedRepos.filter((r) => !fetchedNames.has(r.fullName.toLowerCase()));
      return { ...state, repos: [...action.repos, ...missingSelected], reposLoading: false };
    }

    case "FETCH_REPOS_ERROR": {
      if (state.step !== 2) return state;
      return { ...state, reposLoading: false, reposError: action.message };
    }

    case "SET_MANUAL_ENTRY": {
      if (state.step !== 2) return state;
      return { ...state, manualEntry: action.value, manualEntryError: undefined };
    }

    case "ADD_MANUAL_REPO_START": {
      if (state.step !== 2) return state;
      return { ...state, manualEntryLoading: true, manualEntryError: undefined };
    }

    case "ADD_MANUAL_REPO_SUCCESS": {
      if (state.step !== 2) return state;
      const inRepos = state.repos.some((r) => r.fullName.toLowerCase() === action.repo.fullName.toLowerCase());
      const inSelected = state.selectedRepos.some(
        (r) => r.fullName.toLowerCase() === action.repo.fullName.toLowerCase(),
      );
      return {
        ...state,
        repos: inRepos ? state.repos : [...state.repos, action.repo],
        selectedRepos: inSelected ? state.selectedRepos : [...state.selectedRepos, action.repo],
        manualEntry: "",
        manualEntryLoading: false,
      };
    }

    case "ADD_MANUAL_REPO_ERROR": {
      if (state.step !== 2) return state;
      return { ...state, manualEntryLoading: false, manualEntryError: action.message };
    }

    case "SET_CONTRIBUTOR_FILTER": {
      if (state.step !== 3) return state;
      return { ...state, contributorFilter: action.filter };
    }

    case "TOGGLE_CONTRIBUTOR_SELECTION": {
      if (state.step !== 3) return state;
      const exists = state.selectedContributors.some((c) => c.id === action.contributor.id);
      return {
        ...state,
        selectedContributors: exists
          ? state.selectedContributors.filter((c) => c.id !== action.contributor.id)
          : [...state.selectedContributors, action.contributor],
      };
    }

    case "FETCH_COLLABORATORS_START": {
      if (state.step !== 3) return state;
      return { ...state, collaboratorsLoading: true, collaboratorsError: undefined };
    }

    case "FETCH_COLLABORATORS_SUCCESS": {
      if (state.step !== 3) return state;
      return { ...state, collaborators: action.collaborators, collaboratorsLoading: false };
    }

    case "FETCH_COLLABORATORS_ERROR": {
      if (state.step !== 3) return state;
      return { ...state, collaboratorsLoading: false, collaboratorsError: action.message };
    }

    case "SUBMIT_START": {
      // Every board requires at least one contributor. The "no escape path"
      // dead end (Bug 4) is resolved by BACK_TO_STEP_2 above, not by relaxing
      // this guard.
      if (state.selectedContributors.length === 0) return state;
      return { ...state, submitting: true, apiError: undefined };
    }

    case "SUBMIT_ERROR": {
      return { ...state, submitting: false, apiError: action.message };
    }

    case "SET_API_ERROR": {
      return { ...state, apiError: action.error };
    }

    default:
      return state;
  }
}
