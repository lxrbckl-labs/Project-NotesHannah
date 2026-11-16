import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, startBackend } from "../../../test/utils";
import { stubCanvas2d } from "../../components/bits/bits-test-utils";

class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoObserver);
  stubCanvas2d();
});

describe("/design/bits", () => {
  it("shows every component with where to use it, once signed in", async () => {
    await startBackend(true);
    renderApp("/design/bits");
    expect(
      await screen.findByRole("heading", { level: 1, name: "React Bits" }),
    ).toBeInTheDocument();
    for (const name of [
      "DotGrid",
      "SpotlightCard",
      "CountUp",
      "AnimatedList",
      "BlurText",
      "ClickSpark",
      "Stepper",
      "ShinyText",
      "StarBorder",
      "Magnet",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Use it for:")).toHaveLength(10);
    expect(screen.getAllByText("Light and dark:")).toHaveLength(10);
  });

  it("asks to sign in first", async () => {
    await startBackend(false);
    const { router } = renderApp("/design/bits");
    await screen.findByRole("button", { name: /sign in|log in/i });
    expect(router.state.location.pathname).toBe("/login");
  });
});
