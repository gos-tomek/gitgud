// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreateBoardForm from "@/components/CreateBoardForm";

type UserEvent = ReturnType<typeof userEvent.setup>;

const PAT = "ghp_validtoken123";
const PAT_B = "ghp_anothertoken456";

const REPO_A = {
  owner: "octocat",
  name: "hello-world",
  fullName: "octocat/hello-world",
  private: false,
  pushAccess: true,
};
const REPO_B = {
  owner: "octocat",
  name: "spoon-knife",
  fullName: "octocat/spoon-knife",
  private: false,
  pushAccess: true,
};

const COLLAB_A = { login: "octocat", id: 1, avatarUrl: "https://avatars.example/octocat.png", type: "User" };
const COLLAB_B = { login: "monalisa", id: 2, avatarUrl: "https://avatars.example/monalisa.png", type: "User" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface FetchMockOptions {
  collaboratorResponses?: { collaborators: (typeof COLLAB_A)[] }[];
}

function installFetchMock(options: FetchMockOptions = {}) {
  const collaboratorResponses = options.collaboratorResponses ?? [{ collaborators: [COLLAB_A, COLLAB_B] }];
  let collaboratorCallCount = 0;

  const fetchMock = vi.fn((input: string, _init?: RequestInit): Promise<Response> => {
    switch (input) {
      case "/api/github/validate-pat":
        return Promise.resolve(jsonResponse({ login: "octocat", avatarUrl: COLLAB_A.avatarUrl }));
      case "/api/boards/check-name":
        return Promise.resolve(new Response(null, { status: 204 }));
      case "/api/github/repos":
        return Promise.resolve(jsonResponse({ repos: [REPO_A, REPO_B] }));
      case "/api/github/collaborators": {
        const response = collaboratorResponses[Math.min(collaboratorCallCount, collaboratorResponses.length - 1)];
        collaboratorCallCount++;
        return Promise.resolve(jsonResponse(response));
      }
      case "/api/boards":
        return Promise.resolve(jsonResponse({ id: "new-board-id" }, 201));
      default:
        throw new Error(`Unhandled fetch to ${input}`);
    }
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fillStep1(user: UserEvent, boardName = "Test Board", pat = PAT) {
  await user.type(screen.getByLabelText(/Board name/i), boardName);
  await user.type(screen.getByLabelText(/GitHub Personal Access Token/i), pat);
  await waitFor(() => expect(screen.getByText(/Connected as/i)).toBeInTheDocument(), { timeout: 2000 });
}

async function goToStep2(user: UserEvent, boardName = "Test Board") {
  await fillStep1(user, boardName);
  await user.click(screen.getByRole("button", { name: /next/i }));
  await waitFor(() => expect(screen.getByText("Step 2 of 3")).toBeInTheDocument());
  await screen.findByText(REPO_A.fullName);
}

async function toggleRepo(user: UserEvent, fullName: string) {
  const text = await screen.findByText(fullName);
  const label = text.closest("label");
  if (!label) throw new Error(`Could not find repo label for "${fullName}"`);
  await user.click(within(label).getByRole("checkbox"));
}

async function toggleContributor(user: UserEvent, login: string) {
  const text = await screen.findByText(`@${login}`);
  const label = text.closest("label");
  if (!label) throw new Error(`Could not find contributor label for "${login}"`);
  await user.click(within(label).getByRole("checkbox"));
}

async function goToStep3(user: UserEvent) {
  await user.click(screen.getByRole("button", { name: /next/i }));
  await waitFor(() => expect(screen.getByText("Step 3 of 3")).toBeInTheDocument());
}

describe("CreateBoardForm", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { href: "" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("W1: blocks Step 1 -> 2 when the board name is empty and shows an error", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await user.type(screen.getByLabelText(/GitHub Personal Access Token/i), PAT);
    await waitFor(() => expect(screen.getByText(/Connected as/i)).toBeInTheDocument(), { timeout: 2000 });

    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText("Board name is required")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("W2: disables Next while the PAT has not been validated", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await user.type(screen.getByLabelText(/Board name/i), "Test Board");

    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("W3: completes the wizard and submits data collected across all three steps", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user, "My Board");
    await toggleRepo(user, REPO_A.fullName);
    await toggleRepo(user, REPO_B.fullName);

    await goToStep3(user);
    await toggleContributor(user, COLLAB_A.login);

    await user.click(screen.getByRole("button", { name: /create board/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/boards", expect.objectContaining({ method: "POST" }));
    });

    const call = fetchMock.mock.calls.find(([url]) => url === "/api/boards");
    const body = JSON.parse((call?.[1]?.body as string | undefined) ?? "{}") as {
      name: string;
      pat: string;
      repos: { owner: string; name: string }[];
      contributors: { githubId: number; githubLogin: string; avatarUrl?: string }[];
    };

    expect(body.name).toBe("My Board");
    expect(body.pat).toBe(PAT);
    expect(body.repos).toEqual([
      { owner: REPO_A.owner, name: REPO_A.name },
      { owner: REPO_B.owner, name: REPO_B.name },
    ]);
    expect(body.contributors).toEqual([
      { githubId: COLLAB_A.id, githubLogin: COLLAB_A.login, avatarUrl: COLLAB_A.avatarUrl },
    ]);

    await waitFor(() => {
      expect(window.location.href).toBe("/boards/new-board-id");
    });
  });

  it("W4: clears selected repos and re-fetches them when the PAT changes after going back", async () => {
    const fetchMock = installFetchMock();
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user);
    await toggleRepo(user, REPO_A.fullName);
    expect(screen.getByText(/1 repo selected/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("Step 1 of 3")).toBeInTheDocument());

    await user.clear(screen.getByLabelText(/GitHub Personal Access Token/i));
    await user.type(screen.getByLabelText(/GitHub Personal Access Token/i), PAT_B);
    await waitFor(() => expect(screen.getByText(/Connected as/i)).toBeInTheDocument(), { timeout: 2000 });

    await user.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Step 2 of 3")).toBeInTheDocument());
    await screen.findByText(REPO_A.fullName);

    await waitFor(() => {
      const repoCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/github/repos");
      expect(repoCalls).toHaveLength(2);
    });
    const repoCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/github/repos");
    const secondBody = JSON.parse((repoCalls.at(1)?.[1]?.body as string | undefined) ?? "{}") as { pat?: string };
    expect(secondBody.pat).toBe(PAT_B);

    expect(screen.queryByText(/repo.*selected/i)).not.toBeInTheDocument();
  });

  it("W5: re-fetches collaborators when returning to Step 3 after changing the repo selection", async () => {
    const fetchMock = installFetchMock({
      collaboratorResponses: [{ collaborators: [COLLAB_A, COLLAB_B] }, { collaborators: [COLLAB_A] }],
    });
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user);
    await toggleRepo(user, REPO_A.fullName);
    await toggleRepo(user, REPO_B.fullName);
    await goToStep3(user);
    await screen.findByText(`@${COLLAB_A.login}`);

    await user.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("Step 2 of 3")).toBeInTheDocument());
    await toggleRepo(user, REPO_B.fullName); // deselect, narrowing the repo set

    await goToStep3(user);
    await screen.findByText(`@${COLLAB_A.login}`);

    const collabCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/github/collaborators");
    expect(collabCalls).toHaveLength(2);
    const secondBody = JSON.parse((collabCalls.at(1)?.[1]?.body as string | undefined) ?? "{}") as {
      repos?: { owner: string; name: string }[];
    };
    expect(secondBody.repos).toEqual([{ owner: REPO_A.owner, name: REPO_A.name }]);
  });

  it("W6: keeps stale selectedContributors after the collaborator list changes (documents Bug 1)", async () => {
    installFetchMock({
      collaboratorResponses: [{ collaborators: [COLLAB_A, COLLAB_B] }, { collaborators: [COLLAB_A] }],
    });
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user);
    await toggleRepo(user, REPO_A.fullName);
    await toggleRepo(user, REPO_B.fullName);
    await goToStep3(user);

    await toggleContributor(user, COLLAB_B.login);
    expect(screen.getByText(/1 contributor selected/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    await waitFor(() => expect(screen.getByText("Step 2 of 3")).toBeInTheDocument());
    await toggleRepo(user, REPO_B.fullName); // deselect, repo selection now differs from the first Step 3 visit

    await goToStep3(user);
    await screen.findByText(`@${COLLAB_A.login}`);

    // Known bug (Bug 1): handleBack/handleBackToStep2 never clear selectedContributors,
    // so "monalisa" (selected during the first Step 3 visit) stays counted even though
    // the refreshed collaborator list no longer contains them and they cannot be unchecked.
    expect(screen.queryByText(`@${COLLAB_B.login}`)).not.toBeInTheDocument();
    expect(screen.getByText(/1 contributor selected/i)).toBeInTheDocument();
  });

  it("W7: disables Next on Step 2 when no repos are selected", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user);

    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("W8: disables Create Board on Step 3 when no contributors are selected", async () => {
    installFetchMock();
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user);
    await toggleRepo(user, REPO_A.fullName);
    await goToStep3(user);
    await screen.findByText(`@${COLLAB_A.login}`);

    expect(screen.getByRole("button", { name: /create board/i })).toBeDisabled();
  });

  it("W9: shows 'No collaborators found' and disables Create Board when the API returns an empty list", async () => {
    installFetchMock({ collaboratorResponses: [{ collaborators: [] }] });
    const user = userEvent.setup();
    render(<CreateBoardForm />);

    await goToStep2(user);
    await toggleRepo(user, REPO_A.fullName);
    await goToStep3(user);

    expect(await screen.findByText(/No collaborators found/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create board/i })).toBeDisabled();
  });
});
