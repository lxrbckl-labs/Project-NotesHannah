import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { MOCK_PASSWORD, MOCK_USERNAME } from "../src/mocks/seed";
import { renderApp, startBackend } from "./utils";

async function fillAndSubmit(
  user: Awaited<ReturnType<typeof startBackend>>["user"],
  username: string,
  password: string,
) {
  await user.type(screen.getByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("signing in", () => {
  it("sends a signed-out visitor to the sign-in screen, with no sign-up anywhere", async () => {
    await startBackend(false);
    const { router } = renderApp("/library/nod_anything");
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toContain("next=");
    expect(screen.queryByText(/sign up|create account|register/i)).toBeNull();
  });

  it("shows a clear error for wrong credentials and keeps the username", async () => {
    const { user } = await startBackend(false);
    renderApp("/login");
    await fillAndSubmit(user, "hannah", "not-the-password");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /username or password is not right/i,
    );
    expect(screen.getByLabelText("Username")).toHaveValue("hannah");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("signs in, lands on the library, and returns to the page that was asked for", async () => {
    const { user } = await startBackend(false);
    const { router } = renderApp("/login?next=%2Ftrash");
    await fillAndSubmit(user, " Hannah ", MOCK_PASSWORD);
    expect(await screen.findByRole("heading", { name: "Trash" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/trash");
  });

  it("ignores an off-site next parameter", async () => {
    const { user } = await startBackend(false);
    const { router } = renderApp("/login?next=%2F%2Fevil.example");
    await fillAndSubmit(user, MOCK_USERNAME, MOCK_PASSWORD);
    await screen.findByRole("heading", { level: 1, name: "Library" });
    expect(router.state.location.pathname).toBe("/library");
  });

  it("counts down when rate limited and re-enables the button", async () => {
    const { user, fetch } = await startBackend(false);
    const real = fetch.getMockImplementation();
    fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/auth/login")) {
        return new Response(
          JSON.stringify({ error: { code: "rate_limited", message: "Too many.", retryAfter: 2 } }),
          { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "2" } },
        );
      }
      return real?.(input, init) as Promise<Response>;
    });
    renderApp("/login");
    await fillAndSubmit(user, "hannah", "whatever");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many attempts.");
    expect(alert).toHaveTextContent(/Try again in [12] seconds?/);
    const button = screen.getByRole("button", { name: /Wait \d+s/ });
    expect(button).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled(), {
      timeout: 4000,
    });
    // the countdown is over: with both fields filled the button is usable again
    await user.type(screen.getByLabelText("Password"), "x");
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });
});

describe("a session that ends", () => {
  it("sends the person to sign in when the API answers unauthenticated", async () => {
    await startBackend(true);
    const { client, router } = renderApp("/library");
    await screen.findByRole("heading", { level: 1, name: "Library" });
    await api.logout(); // the server forgets the session (expiry, or signed out elsewhere)
    await client.invalidateQueries({ queryKey: ["nodes"] });
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("signs out from the sidebar", async () => {
    const { user } = await startBackend(true);
    const { router } = renderApp("/library");
    await screen.findByRole("heading", { level: 1, name: "Library" });
    const sidebar = screen.getByTestId("sidebar");
    await user.click(within(sidebar).getByRole("button", { name: /Sign out/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    vi.stubGlobal("fetch", fetch); // keep teardown quiet
  });
});
