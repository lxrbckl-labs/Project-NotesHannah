import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp, startBackend } from "./utils";

describe("API keys in settings", () => {
  it("lists keys with scope, preview, created, last used and revoked state", async () => {
    await startBackend();
    renderApp("/settings");
    const rows = await screen.findAllByTestId("key-row");
    expect(rows).toHaveLength(2);
    const text = rows.map((r) => r.textContent ?? "").join("\n");
    expect(text).toContain("Claude Code");
    expect(text).toContain("Read and write");
    expect(text).toContain("nh_write_Qm7");
    expect(text).toContain("Last used Nov 14, 2026");
    expect(text).toContain("Old laptop");
    expect(text).toContain("Never used");
    const revoked = rows.find((r) => r.dataset.revoked === "true");
    expect(revoked).toHaveTextContent("Revoked");
    expect(within(revoked as HTMLElement).queryByRole("button", { name: /Revoke/ })).toBeNull();
  });

  it("creates a key and shows the secret exactly once, with a copy button", async () => {
    const { user } = await startBackend();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp("/settings");
    await screen.findAllByTestId("key-row");

    await user.click(screen.getByRole("button", { name: "New key" }));
    const dialog = await screen.findByRole("dialog", { name: "New API key" });
    await user.type(within(dialog).getByLabelText("Name", { exact: true }), "Study helper");
    await user.click(within(dialog).getByRole("radio", { name: /Read and write/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    const secret = await screen.findByTestId("api-secret");
    expect(secret.textContent).toMatch(/^nh_write_[A-Za-z0-9_-]{43}$/);
    expect(screen.getByRole("alert")).toHaveTextContent(/You will not see this again/);

    await user.click(screen.getByRole("button", { name: "Copy key" }));
    expect(writeText).toHaveBeenCalledWith(secret.textContent);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    const shown = secret.textContent ?? "";
    await user.click(screen.getByRole("button", { name: "I have saved it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // the list now has the new key by preview only; the secret is gone everywhere
    const row = (await screen.findAllByTestId("key-row")).find((r) =>
      r.textContent?.includes("Study helper"),
    );
    expect(row).toBeDefined();
    expect(document.body.textContent).not.toContain(shown);

    // opening the dialog again starts a fresh form, not the old secret
    await user.click(screen.getByRole("button", { name: "New key" }));
    expect(await screen.findByRole("dialog", { name: "New API key" })).toBeInTheDocument();
    expect(screen.queryByTestId("api-secret")).toBeNull();
  });

  it("tells her when copying is blocked", async () => {
    const { user } = await startBackend();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    renderApp("/settings");
    await user.click(await screen.findByRole("button", { name: "New key" }));
    await user.type(await screen.findByLabelText("Name", { exact: true }), "K");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await user.click(await screen.findByRole("button", { name: "Copy key" }));
    expect(await screen.findByText(/Copying was blocked/)).toBeInTheDocument();
  });

  it("revokes only after a confirmation that names the key", async () => {
    const { user } = await startBackend();
    renderApp("/settings");
    await user.click(await screen.findByRole("button", { name: "Revoke Claude Code" }));
    const confirm = await screen.findByRole("alertdialog", { name: /Revoke "Claude Code"\?/ });

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Revoke Claude Code" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revoke Claude Code" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke key" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Revoke Claude Code" })).toBeNull(),
    );
    const row = screen
      .getAllByTestId("key-row")
      .find((r) => r.textContent?.includes("Claude Code"));
    expect(row).toHaveTextContent("Revoked");
  });

  it("changes the password and reports a wrong current password", async () => {
    const { user } = await startBackend();
    renderApp("/settings");
    await screen.findAllByTestId("key-row");
    await user.type(screen.getByLabelText("Current password"), "wrong-password-1");
    await user.type(screen.getByLabelText("New password", { exact: true }), "a-new-password-1");
    await user.type(screen.getByLabelText("New password again"), "a-new-password-1");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/current password is not right/i);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "study-notes-2026" },
    });
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Password changed/);
  });
});
