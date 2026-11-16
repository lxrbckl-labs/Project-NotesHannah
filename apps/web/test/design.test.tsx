import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HUES } from "../src/lib/hues";
import { renderApp, startBackend } from "./utils";

describe("design reference", () => {
  it("is linked from Settings and opens the gallery", async () => {
    await startBackend();
    renderApp("/settings");
    const link = await screen.findByRole("link", { name: "Design reference" });
    expect(link).toHaveAttribute("href", "/design");
    fireEvent.click(link);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Design reference" }),
    ).toBeInTheDocument();
  });

  it("shows every hue, the roles and the components", async () => {
    await startBackend();
    renderApp("/design");
    await screen.findByRole("heading", { level: 1, name: "Design reference" });
    for (const id of ["palette", "semantic", "roles", "base", "scales", "type", "components"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(screen.getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(HUES.length);
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Concept tools" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show hints" })).toBeInTheDocument();
  });

  it("is not in the main navigation", async () => {
    await startBackend();
    renderApp("/library");
    await screen.findAllByRole("navigation");
    expect(screen.queryByRole("link", { name: "Design reference" })).toBeNull();
  });

  it("needs sign-in", async () => {
    await startBackend(false);
    renderApp("/design");
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument();
  });
});
