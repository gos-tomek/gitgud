// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignUpForm from "@/components/auth/SignUpForm";

function fillRequiredFieldsExceptGithub(user: ReturnType<typeof userEvent.setup>) {
  return Promise.all([
    user.type(screen.getByLabelText(/email/i), "ic@example.com"),
    user.type(screen.getByLabelText(/^password$/i), "secret1"),
    user.type(screen.getByLabelText(/confirm password/i), "secret1"),
  ]);
}

describe("SignUpForm", () => {
  it("renders a GitHub username field", () => {
    render(<SignUpForm />);
    expect(screen.getByLabelText(/github username/i)).toBeInTheDocument();
  });

  it("blocks submission and shows an error when GitHub username is empty", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await fillRequiredFieldsExceptGithub(user);
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("GitHub username is required")).toBeInTheDocument();
  });

  it("blocks submission and shows an error when GitHub username contains spaces", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    await fillRequiredFieldsExceptGithub(user);
    const githubInput = screen.getByLabelText(/github username/i);
    // fireEvent.change delivers the whole string in one event (like a paste), so the
    // internal space survives normalization — only leading/trailing whitespace and a
    // leading "@" are stripped, per-keystroke typing would trim it away at each step.
    fireEvent.change(githubInput, { target: { value: "octo cat" } });

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText("GitHub username cannot contain spaces")).toBeInTheDocument();
  });

  it("trims whitespace, strips a leading @, and lowercases as the user types", async () => {
    const user = userEvent.setup();
    render(<SignUpForm />);

    const githubInput = screen.getByLabelText(/github username/i);
    await user.type(githubInput, "  @OctoCat  ");

    expect(githubInput).toHaveValue("octocat");
  });

  it("submits github_login in the form's FormData", async () => {
    const user = userEvent.setup();
    const { container } = render(<SignUpForm />);

    await fillRequiredFieldsExceptGithub(user);
    await user.type(screen.getByLabelText(/github username/i), "octocat");

    const form = container.querySelector("form");
    if (!form) throw new Error("form not found");

    let capturedFormData: FormData | undefined;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      capturedFormData = new FormData(form);
    });

    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(capturedFormData?.get("github_login")).toBe("octocat");
  });
});
