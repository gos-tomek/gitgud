// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PatUpdateForm from "@/components/PatUpdateForm";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PatUpdateForm", () => {
  it("shows 'No token configured' when there is no current token", () => {
    render(<PatUpdateForm hasToken={false} currentLogin={null} currentExpiresAt={null} />);

    expect(screen.getByText("No token configured")).toBeInTheDocument();
  });

  it("shows the current login and expiry when a token is already stored", () => {
    render(<PatUpdateForm hasToken={true} currentLogin="octocat" currentExpiresAt="2099-06-03T19:52:44.000Z" />);

    expect(screen.getByText("@octocat")).toBeInTheDocument();
    expect(screen.getByText(/Expires/)).toBeInTheDocument();
  });

  it("shows 'No expiration' when the stored token has no expiry", () => {
    render(<PatUpdateForm hasToken={true} currentLogin="octocat" currentExpiresAt={null} />);

    expect(screen.getByText("No expiration")).toBeInTheDocument();
  });

  it("shows a generic 'Token configured' label when the PAT's GitHub identity is unknown (e.g. backfilled rows)", () => {
    render(<PatUpdateForm hasToken={true} currentLogin={null} currentExpiresAt={null} />);

    expect(screen.getByText("Token configured")).toBeInTheDocument();
    expect(screen.queryByText(/Connected as/)).not.toBeInTheDocument();
  });

  it("highlights the expiry badge when the token expires within 7 days", () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    render(<PatUpdateForm hasToken={true} currentLogin="octocat" currentExpiresAt={soon} />);

    const badge = screen.getByText(/Expires/);
    expect(badge.className).toMatch(/text-red-300/);
  });

  it("does not highlight the expiry badge when the token expires far in the future", () => {
    const farFuture = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    render(<PatUpdateForm hasToken={true} currentLogin="octocat" currentExpiresAt={farFuture} />);

    const badge = screen.getByText(/Expires/);
    expect(badge.className).not.toMatch(/text-red-300/);
  });

  it("links to a classic-PAT creation URL with the required scopes", () => {
    render(<PatUpdateForm hasToken={false} currentLogin={null} currentExpiresAt={null} />);

    const link = screen.getByRole("link", { name: /classic PAT/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("scopes=repo,read:org"));
  });

  it("saves a new token and shows the updated login on success", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ login: "newlogin", expiresAt: null })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PatUpdateForm hasToken={false} currentLogin={null} currentExpiresAt={null} />);

    await user.type(screen.getByLabelText(/Update GitHub Personal Access Token/i), "ghp_newtoken");
    await user.click(screen.getByRole("button", { name: /save token/i }));

    await waitFor(() => expect(screen.getByText("@newlogin")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile/pat",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ pat: "ghp_newtoken" }) }),
    );
  });

  it("shows an error message when the token is rejected", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Token is invalid or expired" }, 401)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<PatUpdateForm hasToken={false} currentLogin={null} currentExpiresAt={null} />);

    await user.type(screen.getByLabelText(/Update GitHub Personal Access Token/i), "ghp_badtoken");
    await user.click(screen.getByRole("button", { name: /save token/i }));

    expect(await screen.findByText("Token is invalid or expired")).toBeInTheDocument();
  });

  it("disables Save token until input is non-empty", () => {
    render(<PatUpdateForm hasToken={false} currentLogin={null} currentExpiresAt={null} />);

    expect(screen.getByRole("button", { name: /save token/i })).toBeDisabled();
  });
});
