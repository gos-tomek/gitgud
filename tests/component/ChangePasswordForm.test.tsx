// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChangePasswordForm from "@/components/ChangePasswordForm";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  currentPassword: string,
  newPassword: string,
  confirmPassword = newPassword,
) {
  await user.type(screen.getByLabelText(/^Current password$/i), currentPassword);
  await user.type(screen.getByLabelText(/^New password$/i), newPassword);
  await user.type(screen.getByLabelText(/^Confirm new password$/i), confirmPassword);
}

describe("ChangePasswordForm", () => {
  it("disables Update password until all fields are filled", () => {
    render(<ChangePasswordForm />);

    expect(screen.getByRole("button", { name: /update password/i })).toBeDisabled();
  });

  it("shows an error and never calls the API when the new passwords don't match", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await fillForm(user, "old-password", "new-password-1", "new-password-2");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText("New passwords do not match")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits and clears the form on success", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await fillForm(user, "old-password", "new-password-123");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(screen.getByText("Password updated successfully.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/profile/password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password-123" }),
      }),
    );
    expect(screen.getByLabelText(/Current password/i)).toHaveValue("");
  });

  it("shows the server error when the current password is wrong", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Current password is incorrect" }, 401)));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await fillForm(user, "wrong-password", "new-password-123");
    await user.click(screen.getByRole("button", { name: /update password/i }));

    expect(await screen.findByText("Current password is incorrect")).toBeInTheDocument();
  });
});
