// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("location", { href: "" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DeleteAccountDialog", () => {
  it("hides the confirmation form until 'Delete account' is clicked", () => {
    render(<DeleteAccountDialog />);

    expect(screen.queryByLabelText(/Type DELETE to confirm/i)).not.toBeInTheDocument();
  });

  it("keeps the confirm button disabled until the user types DELETE", async () => {
    const user = userEvent.setup();
    render(<DeleteAccountDialog />);

    await user.click(screen.getByRole("button", { name: /delete account/i }));
    const confirmButton = screen.getByRole("button", { name: /permanently delete account/i });
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "delete");
    expect(confirmButton).toBeDisabled();

    await user.clear(screen.getByLabelText(/Type DELETE to confirm/i));
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    expect(confirmButton).toBeEnabled();
  });

  it("deletes the account, signs out, and redirects to / on success", async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === "/api/profile") return Promise.resolve(jsonResponse({ ok: true }));
      if (input === "/api/auth/signout") return Promise.resolve(new Response(null, { status: 200 }));
      throw new Error(`Unhandled fetch to ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<DeleteAccountDialog />);

    await user.click(screen.getByRole("button", { name: /delete account/i }));
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /permanently delete account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "DELETE" }));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/signout", expect.objectContaining({ method: "POST" }));
    });
    await waitFor(() => {
      expect(window.location.href).toBe("/");
    });
  });

  it("shows an error message and keeps the dialog open when deletion fails", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Failed to delete account." }, 500)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<DeleteAccountDialog />);

    await user.click(screen.getByRole("button", { name: /delete account/i }));
    await user.type(screen.getByLabelText(/Type DELETE to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /permanently delete account/i }));

    expect(await screen.findByText("Failed to delete account.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Type DELETE to confirm/i)).toBeInTheDocument();
  });
});
