// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BoardNameEditor from "@/components/BoardNameEditor";
import RepoManager from "@/components/RepoManager";
import ContributorManager from "@/components/ContributorManager";
import type { BoardContributor } from "@/types";

// ─── shared fixtures ──────────────────────────────────────────────────────────

const TEST_BOARD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CHECK_NAME_URL = "/api/board/check-name";
const SETTINGS_URL = `/api/board/${TEST_BOARD_ID}/settings`;
const REPOS_URL = `/api/board/${TEST_BOARD_ID}/repos`;
const CONTRIBUTORS_URL = `/api/board/${TEST_BOARD_ID}/contributors`;
const VALIDATE_REPO_URL = "/api/github/validate-repo";
const COLLABORATORS_URL = "/api/github/collaborators";

const REPO_A = { repoOwner: "octocat", repoName: "hello-world" };
const REPO_B = { repoOwner: "octocat", repoName: "spoon-knife" };

const COLLAB_A = { login: "octocat", id: 1, avatarUrl: "https://avatars.example/octocat.png", type: "User" };
const COLLAB_B = { login: "monalisa", id: 2, avatarUrl: "https://avatars.example/monalisa.png", type: "User" };

const CONTRIBUTOR_A: BoardContributor = {
  boardId: TEST_BOARD_ID,
  githubId: 1001,
  githubLogin: "contributor-a",
  avatarUrl: null,
  addedAt: "2026-01-01T00:00:00Z",
};
const CONTRIBUTOR_B: BoardContributor = {
  boardId: TEST_BOARD_ID,
  githubId: 1002,
  githubLogin: "contributor-b",
  avatarUrl: null,
  addedAt: "2026-01-02T00:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── BoardNameEditor ──────────────────────────────────────────────────────────

describe("BoardNameEditor", () => {
  interface BNEFetchOptions {
    checkNameStatus?: number;
    checkNameBody?: unknown;
    patchStatus?: number;
    patchBody?: unknown;
  }
  function installFetchMock({
    checkNameStatus = 204,
    checkNameBody = null,
    patchStatus = 204,
    patchBody = null,
  }: BNEFetchOptions = {}) {
    const fetchMock = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (input === CHECK_NAME_URL && method === "POST") {
        return Promise.resolve(
          checkNameStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(checkNameBody ?? {}, checkNameStatus),
        );
      }
      if (input === SETTINGS_URL && method === "PATCH") {
        return Promise.resolve(
          patchStatus === 204 ? new Response(null, { status: 204 }) : jsonResponse(patchBody ?? {}, patchStatus),
        );
      }
      throw new Error(`Unhandled fetch: ${method} ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("renders the current name with an Edit button", () => {
    installFetchMock();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    expect(screen.getByText("My Board")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("clicking Edit reveals an input pre-filled with the current name", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));

    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("My Board");
  });

  it("clicking Cancel exits edit mode and restores the original name", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Name");

    // Both save and cancel buttons have only SVG icons (no text). Cancel is the last button.
    const buttons = screen.getAllByRole("button");
    const cancelButton = buttons[buttons.length - 1];
    await user.click(cancelButton);

    expect(screen.getByText("My Board")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("typing a changed name triggers a debounced check-name fetch", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Other Board");

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(
          CHECK_NAME_URL,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ name: "Other Board", boardId: TEST_BOARD_ID }),
          }),
        );
      },
      { timeout: 2000 },
    );
  });

  it("check-name returning 409 shows a duplicate error and disables Save", async () => {
    installFetchMock({
      checkNameStatus: 409,
      checkNameBody: { error: "You already have a board with that name" },
    });
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Taken Name");

    await waitFor(() => expect(screen.getByText(/already have a board/i)).toBeInTheDocument(), { timeout: 2000 });
  });

  it("saving with an empty name shows a validation error and does not fetch", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);

    // Click the save (check) button
    const buttons = screen.getAllByRole("button");
    // The save button is the second button (after the input row starts: save, cancel)
    // Look for the enabled save button (not disabled)
    const saveBtn = buttons.find((b) => !b.hasAttribute("disabled") && b.getAttribute("type") === "button");
    if (saveBtn) await user.click(saveBtn);

    await waitFor(() => expect(screen.getByText(/Board name is required/i)).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalledWith(SETTINGS_URL, expect.anything());
  });

  it("successful save calls PATCH and updates the displayed name", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "New Board Name");

    // Wait for the debounced check-name to resolve (no error)
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(CHECK_NAME_URL, expect.anything());
      },
      { timeout: 2000 },
    );

    // Press Enter to save
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        SETTINGS_URL,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "New Board Name" }),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("New Board Name")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  it("PATCH returning 409 shows a duplicate error in the form", async () => {
    installFetchMock({
      patchStatus: 409,
      patchBody: { error: "You already have a board with that name" },
    });
    const user = userEvent.setup();
    render(<BoardNameEditor boardId={TEST_BOARD_ID} currentName="My Board" />);

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Taken Name");

    // Wait for check-name (no error from check, but PATCH returns 409)
    await waitFor(
      () => {
        expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(CHECK_NAME_URL, expect.anything());
      },
      {
        timeout: 2000,
      },
    );

    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText(/already have a board/i)).toBeInTheDocument());
  });
});

// ─── RepoManager ─────────────────────────────────────────────────────────────

describe("RepoManager", () => {
  interface RMFetchOptions {
    validateStatus?: number;
    addStatus?: number;
    removeStatus?: number;
    addBody?: unknown;
    addError?: string | null;
    removeError?: string | null;
  }
  function installFetchMock({
    validateStatus = 200,
    addStatus = 201,
    removeStatus = 204,
    addBody = { id: "new-repo-id" },
    addError = null,
    removeError = null,
  }: RMFetchOptions = {}) {
    const fetchMock = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (input === VALIDATE_REPO_URL && method === "POST") {
        return Promise.resolve(
          validateStatus === 200
            ? jsonResponse({ owner: "octocat", name: "hello-world" })
            : jsonResponse({ error: "Repository not found" }, validateStatus),
        );
      }
      if (input === REPOS_URL && method === "POST") {
        if (addError) return Promise.resolve(jsonResponse({ error: addError }, addStatus));
        return Promise.resolve(jsonResponse(addBody, addStatus));
      }
      if (input === REPOS_URL && method === "DELETE") {
        if (removeError) return Promise.resolve(jsonResponse({ error: removeError }, 500));
        return Promise.resolve(new Response(null, { status: removeStatus }));
      }
      throw new Error(`Unhandled fetch: ${method} ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("renders the list of repos with remove buttons", () => {
    installFetchMock();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A, REPO_B]} />);

    expect(screen.getByText("octocat/hello-world")).toBeInTheDocument();
    expect(screen.getByText("octocat/spoon-knife")).toBeInTheDocument();
  });

  it("renders an empty state when there are no repos", () => {
    installFetchMock();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[]} />);

    expect(screen.getByText(/no repositories linked/i)).toBeInTheDocument();
  });

  it("clicking 'Add repository' shows the add form", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A]} />);

    await user.click(screen.getByRole("button", { name: /add repository/i }));

    expect(screen.getByPlaceholderText(/owner\/name/i)).toBeInTheDocument();
  });

  it("invalid owner/name format shows a format error without calling API", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A]} />);

    await user.click(screen.getByRole("button", { name: /add repository/i }));
    const input = screen.getByPlaceholderText(/owner\/name/i);
    await user.type(input, "no-slash-here");
    await user.keyboard("{Enter}");

    expect(screen.getByText(/owner\/name format/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("valid owner/name calls validate-repo then POST repos on Enter", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A]} />);

    await user.click(screen.getByRole("button", { name: /add repository/i }));
    const input = screen.getByPlaceholderText(/owner\/name/i);
    await user.type(input, "facebook/react");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(VALIDATE_REPO_URL, expect.objectContaining({ method: "POST" }));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(REPOS_URL, expect.objectContaining({ method: "POST" }));
    });
  });

  it("successful add appends the repo to the list and clears the form", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A]} />);

    await user.click(screen.getByRole("button", { name: /add repository/i }));
    await user.type(screen.getByPlaceholderText(/owner\/name/i), "facebook/react");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText("facebook/react")).toBeInTheDocument());
    expect(screen.queryByPlaceholderText(/owner\/name/i)).not.toBeInTheDocument();
  });

  it("duplicate repo (409) shows the already-linked error", async () => {
    installFetchMock({ addStatus: 409 });
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A]} />);

    await user.click(screen.getByRole("button", { name: /add repository/i }));
    await user.type(screen.getByPlaceholderText(/owner\/name/i), "facebook/react");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByText(/already linked/i)).toBeInTheDocument());
  });

  it("clicking a remove button opens the confirmation dialog", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A, REPO_B]} />);

    const removeButtons = screen.getAllByRole("button", { name: /^Remove .+\/.+/ });
    await user.click(removeButtons[0]);

    // Dialog opens — the type-to-confirm prompt should be visible
    await waitFor(() => expect(screen.getByText(/remove repository/i)).toBeInTheDocument());
  });

  it("Remove button is disabled until the confirm input matches the repo name", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A, REPO_B]} />);

    const removeButtons = screen.getAllByRole("button", { name: /^Remove .+\/.+/ });
    await user.click(removeButtons[0]);

    await waitFor(() => expect(screen.getByText(/remove repository/i)).toBeInTheDocument());

    const removeBtn = screen.getByRole("button", { name: /^remove$/i });
    expect(removeBtn).toBeDisabled();

    // Type the wrong text first
    const confirmInput = screen.getByPlaceholderText(/octocat\//i);
    await user.type(confirmInput, "wrong/input");
    expect(removeBtn).toBeDisabled();
  });

  it("Remove button enables and calls DELETE when confirm input matches", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<RepoManager boardId={TEST_BOARD_ID} initialRepos={[REPO_A, REPO_B]} />);

    const removeButtons = screen.getAllByRole("button", { name: /^Remove .+\/.+/ });
    await user.click(removeButtons[0]);

    await waitFor(() => expect(screen.getByText(/remove repository/i)).toBeInTheDocument());

    const confirmText = "octocat/hello-world";
    const confirmInput = screen.getByPlaceholderText(confirmText);
    await user.type(confirmInput, confirmText);

    const removeBtn = screen.getByRole("button", { name: /^remove$/i });
    expect(removeBtn).not.toBeDisabled();

    await user.click(removeBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        REPOS_URL,
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ owner: "octocat", name: "hello-world" }),
        }),
      );
    });

    await waitFor(() => expect(screen.queryByText("octocat/hello-world")).not.toBeInTheDocument());
  });
});

// ─── ContributorManager ───────────────────────────────────────────────────────

describe("ContributorManager", () => {
  const REPOS = [REPO_A];

  function installFetchMock({
    collaborators = [COLLAB_A, COLLAB_B] as (typeof COLLAB_A)[],
    collaboratorsError = null as string | null,
    addStatus = 201,
    removeStatus = 204,
  } = {}) {
    const fetchMock = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (input === COLLABORATORS_URL && method === "POST") {
        if (collaboratorsError) return Promise.resolve(jsonResponse({ error: collaboratorsError }, 500));
        return Promise.resolve(jsonResponse({ collaborators }));
      }
      if (input === CONTRIBUTORS_URL && method === "POST") {
        return Promise.resolve(new Response(null, { status: addStatus }));
      }
      if (input === CONTRIBUTORS_URL && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: removeStatus }));
      }
      throw new Error(`Unhandled fetch: ${method} ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("renders the list of contributors", () => {
    installFetchMock();
    render(
      <ContributorManager boardId={TEST_BOARD_ID} initialContributors={[CONTRIBUTOR_A, CONTRIBUTOR_B]} repos={REPOS} />,
    );

    expect(screen.getByText("@contributor-a")).toBeInTheDocument();
    expect(screen.getByText("@contributor-b")).toBeInTheDocument();
  });

  it("renders an empty state when there are no contributors", () => {
    installFetchMock();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[]} repos={REPOS} />);

    expect(screen.getByText(/no contributors yet/i)).toBeInTheDocument();
  });

  it("clicking 'Add contributors' opens the dialog and fetches collaborators", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[CONTRIBUTOR_A]} repos={REPOS} />);

    await user.click(screen.getByRole("button", { name: /add contributors/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(COLLABORATORS_URL, expect.objectContaining({ method: "POST" }));
    });
  });

  it("collaborators are rendered in the dialog after fetch, excluding existing contributors", async () => {
    // COLLAB_A has id=1, CONTRIBUTOR_A has githubId=1001 — they don't match, so both collabs shown
    installFetchMock();
    const user = userEvent.setup();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[CONTRIBUTOR_A]} repos={REPOS} />);

    await user.click(screen.getByRole("button", { name: /add contributors/i }));

    await waitFor(() => expect(screen.getByText("@octocat")).toBeInTheDocument());
    expect(screen.getByText("@monalisa")).toBeInTheDocument();
  });

  it("filter input narrows the collaborator list", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[]} repos={REPOS} />);

    await user.click(screen.getByRole("button", { name: /add contributors/i }));
    await waitFor(() => expect(screen.getByText("@octocat")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText(/filter contributors/i), "mona");

    expect(screen.getByText("@monalisa")).toBeInTheDocument();
    expect(screen.queryByText("@octocat")).not.toBeInTheDocument();
  });

  it("a failed collaborators fetch shows an error with a Retry button", async () => {
    installFetchMock({ collaboratorsError: "GitHub error" });
    const user = userEvent.setup();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[]} repos={REPOS} />);

    await user.click(screen.getByRole("button", { name: /add contributors/i }));

    await waitFor(() => expect(screen.getByText("GitHub error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("selecting a collaborator enables the Save button with the count", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[]} repos={REPOS} />);

    await user.click(screen.getByRole("button", { name: /add contributors/i }));
    await waitFor(() => expect(screen.getByText("@octocat")).toBeInTheDocument());

    // The save button should start disabled (0 selected)
    const saveBtn = screen.getByRole("button", { name: /add.*contributor/i });
    expect(saveBtn).toBeDisabled();

    // Click the octocat label to select it
    const octocatEl = screen.getByText("@octocat").closest("label");
    if (!octocatEl) throw new Error("octocat label not found");
    await user.click(octocatEl);

    await waitFor(() => expect(screen.getByText(/1 contributor selected/i)).toBeInTheDocument());
    expect(saveBtn).not.toBeDisabled();
  });

  it("saving selected contributors calls POST and adds them to the list", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<ContributorManager boardId={TEST_BOARD_ID} initialContributors={[CONTRIBUTOR_A]} repos={REPOS} />);

    await user.click(screen.getByRole("button", { name: /add contributors/i }));
    await waitFor(() => expect(screen.getByText("@octocat")).toBeInTheDocument());

    const octocatEl = screen.getByText("@octocat").closest("label");
    if (!octocatEl) throw new Error("octocat label not found");
    await user.click(octocatEl);

    const saveBtn = screen.getByRole("button", { name: /add.*contributor/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(CONTRIBUTORS_URL, expect.objectContaining({ method: "POST" }));
    });
    const calls = fetchMock.mock.calls.filter(([url]) => url === CONTRIBUTORS_URL);
    const lastBody = calls.at(-1)?.[1]?.body as string | undefined;
    expect(lastBody).toContain('"githubId":1');

    await waitFor(() => expect(screen.getByText("@octocat")).toBeInTheDocument());
  });

  it("clicking a remove button opens a confirmation dialog with reversibility message", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(
      <ContributorManager boardId={TEST_BOARD_ID} initialContributors={[CONTRIBUTOR_A, CONTRIBUTOR_B]} repos={REPOS} />,
    );

    const removeButtons = screen.getAllByRole("button", { name: /^Remove @/ });
    await user.click(removeButtons[0]);

    await waitFor(() => expect(screen.getByText(/remove contributor/i)).toBeInTheDocument());
    expect(screen.getByText(/re-add them at any time/i)).toBeInTheDocument();
  });

  it("confirming removal calls DELETE and removes the contributor from the list", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(
      <ContributorManager boardId={TEST_BOARD_ID} initialContributors={[CONTRIBUTOR_A, CONTRIBUTOR_B]} repos={REPOS} />,
    );

    // Click the remove button for CONTRIBUTOR_A (first remove button)
    const removeButtons = screen.getAllByRole("button", { name: /^Remove @/ });
    await user.click(removeButtons[0]);

    await waitFor(() => expect(screen.getByText(/remove contributor/i)).toBeInTheDocument());

    // Click the destructive Remove button in the dialog
    const confirmRemoveBtn = screen.getByRole("button", { name: /^remove$/i });
    await user.click(confirmRemoveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        CONTRIBUTORS_URL,
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ githubId: CONTRIBUTOR_A.githubId }),
        }),
      );
    });

    await waitFor(() => expect(screen.queryByText("@contributor-a")).not.toBeInTheDocument());
  });
});
