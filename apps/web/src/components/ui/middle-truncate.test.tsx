import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MiddleTruncate } from "./middle-truncate";

describe("MiddleTruncate", () => {
  it("leaves short text whole", () => {
    render(<MiddleTruncate text="Beta blockers" />);
    expect(screen.getByText("Beta blockers")).toBeInTheDocument();
  });

  it("keeps the end of a long name outside the part that gives way", () => {
    const text = "07 · Pharmacokinetics of the cholinergic agents";
    const { container } = render(<MiddleTruncate text={text} tail={7} />);
    expect(screen.getByText(text)).toHaveClass("sr-only");
    const parts = container.querySelectorAll("span[aria-hidden]");
    expect(parts[0]?.textContent).toBe(text.slice(0, -7));
    expect(parts[1]?.textContent).toBe(text.slice(-7));
    expect(parts[0]?.className).toContain("truncate");
    expect(parts[1]?.className).toContain("shrink-0");
  });
});
