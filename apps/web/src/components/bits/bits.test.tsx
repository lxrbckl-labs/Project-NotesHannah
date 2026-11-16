import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BlurText from "./BlurText";
import { clearTokens, setReducedMotion, setToken, stubCanvas2d } from "./bits-test-utils";
import CountUp from "./CountUp";
import {
  AnimatedList,
  ClickSpark,
  type ClickSparkHandle,
  DotGrid,
  Magnet,
  ShinyText,
  SpotlightCard,
  StarBorder,
  Step,
  Stepper,
} from "./index";
import { readToken, useThemeMode, useToken } from "./tokens";

class NoObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", NoObserver);
  setReducedMotion(false);
  stubCanvas2d();
});

afterEach(() => {
  clearTokens();
  vi.restoreAllMocks();
});

function Probe() {
  const accent = useToken("--color-accent", "none");
  const mode = useThemeMode();
  return (
    <p>
      {accent}|{mode}
    </p>
  );
}

function Harness({ handle }: { handle: React.RefObject<ClickSparkHandle | null> }) {
  return (
    <ClickSpark ref={handle}>
      <button type="button">Answer</button>
    </ClickSpark>
  );
}

function Flow() {
  return (
    <Stepper completedContent={<p>All done</p>}>
      <Step title="One">
        <p>First step</p>
      </Step>
      <Step title="Two">
        <p>Second step</p>
      </Step>
    </Stepper>
  );
}

describe("tokens", () => {
  it("reads a custom property from the root", () => {
    setToken("--color-accent", "#112233");
    expect(readToken("--color-accent")).toBe("#112233");
    expect(readToken("--missing", "fallback")).toBe("fallback");
  });

  it("follows a theme change", async () => {
    setToken("--color-accent", "#112233");
    render(<Probe />);
    expect(screen.getByText("#112233|light")).toBeInTheDocument();
    act(() => {
      setToken("--color-accent", "#445566");
      document.documentElement.dataset.theme = "dark";
    });
    await waitFor(() => expect(screen.getByText("#445566|dark")).toBeInTheDocument());
  });
});

describe("CountUp", () => {
  it("gives screen readers the final number and animates the visible copy", () => {
    render(<CountUp to={42} trigger="load" />);
    expect(screen.getByText("42", { selector: ".sr-only" })).toBeInTheDocument();
    expect(document.querySelector("[aria-hidden='true']")).toHaveTextContent("0");
  });

  it("shows the final number at once under reduced motion", () => {
    setReducedMotion(true);
    render(<CountUp to={42} trigger="load" />);
    expect(document.querySelector("[aria-hidden='true']")).toHaveTextContent("42");
  });
});

describe("BlurText", () => {
  it("renders the whole sentence as the heading", () => {
    render(<BlurText as="h1" text="Hello, Hannah" trigger="load" />);
    expect(screen.getByRole("heading", { level: 1, name: "Hello, Hannah" })).toBeInTheDocument();
    // the animated pieces are hidden from assistive technology
    expect(document.querySelectorAll("[aria-hidden='true']").length).toBeGreaterThan(0);
  });

  it("starts blurred and invisible, then stands still under reduced motion", () => {
    const { unmount } = render(<BlurText text="Hello there" trigger="load" />);
    const piece = document.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(piece.style.filter).toContain("blur");
    unmount();
    setReducedMotion(true);
    render(<BlurText text="Hello there" trigger="load" />);
    const still = document.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(still.style.filter).not.toContain("blur(10");
  });
});

describe("SpotlightCard", () => {
  it("renders its children with the card tokens", () => {
    render(<SpotlightCard>Pharmacology</SpotlightCard>);
    const card = screen.getByText("Pharmacology");
    expect(card.style.getPropertyValue("--spotlight-card-surface")).toBe("var(--color-surface)");
    expect(card.style.getPropertyValue("--spotlight-card-border")).toBe("var(--color-border)");
    expect(card.style.getPropertyValue("--spotlight-card-shadow")).toBe("var(--shadow-card)");
  });

  it("keeps the glow off under reduced motion", () => {
    setReducedMotion(true);
    render(<SpotlightCard ambient>Still</SpotlightCard>);
    expect(screen.getByText("Still")).toBeInTheDocument();
  });
});

describe("AnimatedList", () => {
  const items = [
    { title: "First", description: "one", meta: "1m" },
    { title: "Second", description: "two", meta: "2m" },
  ];

  it("renders a listbox of options coloured by the tokens", () => {
    render(<AnimatedList items={items} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    const root = screen.getByRole("listbox").parentElement as HTMLElement;
    expect(root.style.getPropertyValue("--al-ink")).toBe("var(--color-text)");
    expect(root.style.getPropertyValue("--al-ring")).toBe("var(--color-accent)");
  });

  it("selects with the keyboard and reports the choice", async () => {
    const onItemSelect = vi.fn();
    render(<AnimatedList items={items} onItemSelect={onItemSelect} />);
    await userEvent.click(screen.getByRole("option", { name: /Second/ }));
    expect(onItemSelect).toHaveBeenCalledWith(items[1], 1);
  });

  it("still lists everything under reduced motion", () => {
    setReducedMotion(true);
    render(<AnimatedList items={items} />);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

describe("ClickSpark", () => {
  it("draws a burst when asked", () => {
    const handle = { current: null as ClickSparkHandle | null };
    const { container } = render(<Harness handle={handle} />);
    act(() => handle.current?.spark(10, 10));
    expect(container.querySelectorAll("canvas").length).toBe(1);
  });

  it("draws nothing under reduced motion", () => {
    setReducedMotion(true);
    const handle = { current: null as ClickSparkHandle | null };
    const { container } = render(<Harness handle={handle} />);
    act(() => handle.current?.spark(10, 10));
    expect(container.querySelectorAll("canvas").length).toBe(0);
    expect(screen.getByRole("button", { name: "Answer" })).toBeInTheDocument();
  });
});

describe("Stepper", () => {
  it("moves to the next step and takes its colours from the tokens", async () => {
    render(<Flow />);
    expect(screen.getByText("First step")).toBeInTheDocument();
    const root = screen.getByText("First step").closest("[style*='--stepper']") as HTMLElement;
    expect(root.style.getPropertyValue("--stepper-solid")).toBe("var(--color-accent)");
    expect(root.style.getPropertyValue("--stepper-ink")).toBe("var(--color-text)");
    await userEvent.click(screen.getByRole("button", { name: /next|continue/i }));
    expect(await screen.findByText("Second step")).toBeInTheDocument();
  });

  it("still changes step under reduced motion", async () => {
    setReducedMotion(true);
    render(<Flow />);
    await userEvent.click(screen.getByRole("button", { name: /next|continue/i }));
    expect(await screen.findByText("Second step")).toBeInTheDocument();
  });
});

describe("ShinyText", () => {
  it("renders its text", () => {
    render(<ShinyText text="Syncing" />);
    expect(screen.getByText("Syncing")).toBeInTheDocument();
  });

  it("uses the muted text and accent tokens by default", () => {
    setToken("--color-text-muted", "#5f5d55");
    setToken("--color-accent", "#2f6f5e");
    render(<ShinyText text="Syncing" trigger="hover" />);
    const root = screen.getByText("Syncing");
    // the resting paint is the muted text colour (jsdom keeps the declared rgb or hex form)
    expect(root.style.backgroundImage).toMatch(/95, 93, 85|#5f5d55/i);
  });

  it("does not schedule animation frames under reduced motion", () => {
    setReducedMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<ShinyText text="Still" />);
    expect(raf.mock.calls.length).toBeLessThanOrEqual(1);
    expect(screen.getByText("Still")).toBeInTheDocument();
  });
});

describe("StarBorder", () => {
  it("renders a button with the surface tokens", () => {
    render(<StarBorder as="button">Start practice</StarBorder>);
    const button = screen.getByRole("button", { name: "Start practice" });
    expect(button.style.getPropertyValue("--star-border-surface")).toBe("var(--color-surface)");
    expect(button.style.getPropertyValue("--star-border-text")).toBe("var(--color-text)");
  });

  it("renders under reduced motion", () => {
    setReducedMotion(true);
    render(<StarBorder as="button">Go</StarBorder>);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});

describe("Magnet", () => {
  it("renders its child", () => {
    render(
      <Magnet>
        <button type="button">Pull</button>
      </Magnet>,
    );
    expect(screen.getByRole("button", { name: "Pull" })).toBeInTheDocument();
  });

  it("does not move under reduced motion", async () => {
    setReducedMotion(true);
    render(
      <Magnet padding={500}>
        <button type="button">Pull</button>
      </Magnet>,
    );
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5, pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const inner = screen.getByRole("button", { name: "Pull" }).parentElement as HTMLElement;
    expect(inner.style.transform).toMatch(/^(translate3d\(0px, 0px, 0px\))?$/);
  });
});

describe("DotGrid", () => {
  it("renders a canvas that ignores pointer events and survives having no WebGL", () => {
    const { container } = render(<DotGrid />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas).toBeInTheDocument();
    expect(canvas.className).toContain("pointer-events-none");
  });

  it("paints with the dot and accent tokens", async () => {
    setReducedMotion(true);
    setToken("--color-dot", "#102030");
    setToken("--color-accent", "#405060");
    const calls: number[][] = [];
    const gl = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "getProgramParameter") return () => true;
          if (key === "uniform3f") return (_loc: unknown, ...rgb: number[]) => calls.push(rgb);
          return () => ({});
        },
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      (() => gl) as unknown as typeof HTMLCanvasElement.prototype.getContext,
    );
    const size = { width: 200, height: 100, top: 0, left: 0, right: 200, bottom: 100, x: 0, y: 0 };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      ...size,
      toJSON: () => size,
    });
    render(<DotGrid />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const bytes = (rgb: number[] | undefined) => rgb?.map((v) => Math.round(v * 255));
    // uBase is set first, then uActive
    expect(bytes(calls.at(-2))).toEqual([0x10, 0x20, 0x30]);
    expect(bytes(calls.at(-1))).toEqual([0x40, 0x50, 0x60]);
  });

  it("renders under reduced motion", () => {
    setReducedMotion(true);
    const { container } = render(<DotGrid />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });
});
