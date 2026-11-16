import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { ConfirmDialog } from "./dialog";
import { Disclosure } from "./disclosure";
import { ActionMenu } from "./menu";
import { Popover } from "./popover";
import { Sheet } from "./sheet";
import { Tooltip } from "./tooltip";

function Harness({ placement }: { placement?: "side" | "center" | "bottom" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open outline</Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Outline"
        {...(placement ? { placement } : {})}
      >
        <a href="#one">First heading</a>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("opens as a named dialog and closes with Escape", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open outline" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Outline" });
    expect(dialog).toHaveAttribute("data-placement", "side");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes from its close button", async () => {
    render(<Harness placement="center" />);
    await userEvent.click(screen.getByRole("button", { name: "Open outline" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-placement", "center");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("ConfirmDialog", () => {
  it("uses the cancel label it is given and confirms once", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="End the session?"
        description="Your answers so far are kept."
        confirmLabel="End session"
        cancelLabel="Keep going"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "End the session?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep going" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("Popover", () => {
  it("opens from its trigger, is named, and closes with Escape", async () => {
    render(
      <Popover label="Card colour" title="Colour" trigger={<Button>Colour</Button>}>
        <p>Pick one</p>
      </Popover>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Colour" }));
    expect(screen.getByRole("dialog", { name: "Card colour" })).toHaveTextContent("Pick one");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("ActionMenu", () => {
  it("opens a submenu and runs its item", async () => {
    const onSelect = vi.fn();
    render(
      <ActionMenu
        trigger={<Button>More</Button>}
        entries={[
          { type: "item", label: "Rename", onSelect: () => {} },
          {
            type: "sub",
            label: "Colour",
            entries: [{ type: "item", label: "Teal", onSelect }],
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Colour" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Teal" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe("Disclosure", () => {
  it("shows its content when opened", async () => {
    render(
      <Disclosure label="Show working">
        <p>Dose = 5 mg/kg</p>
      </Disclosure>,
    );
    const trigger = screen.getByRole("button", { name: "Show working" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Dose = 5 mg/kg")).toBeVisible();
  });
});

describe("Tooltip", () => {
  it("appears on keyboard focus with the hint", async () => {
    render(
      <Tooltip content="Add a card">
        <Button aria-label="Add">+</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Add" })).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Add a card");
  });
});
