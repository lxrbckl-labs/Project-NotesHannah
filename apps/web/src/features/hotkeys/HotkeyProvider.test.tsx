import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { Button, IconButton } from "../../components/ui/button";
import { HotkeyProvider, useHotkey } from "./HotkeyProvider";
import { Kbd } from "./Kbd";
import { formatKeys } from "./registry";

function Owner({ onAsk }: { onAsk: () => void }) {
  useHotkey("app.ask", onAsk);
  return (
    <Button hotkey="app.ask" onClick={onAsk}>
      Ask an agent
    </Button>
  );
}

function Screen({
  onAsk,
  badges = true,
  enabled = true,
}: {
  onAsk: () => void;
  badges?: boolean;
  enabled?: boolean;
}) {
  const [shown, setShown] = useState(true);
  return (
    <HotkeyProvider enabled={enabled} badges={badges}>
      <button type="button" onClick={() => setShown((s) => !s)}>
        Toggle
      </button>
      {shown ? <Owner onAsk={onAsk} /> : null}
      <Kbd hotkey="app.ask" />
    </HotkeyProvider>
  );
}

test("a hotkey fires only while the screen that owns it is on show", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  render(<Screen onAsk={onAsk} />);
  await user.keyboard("r");
  expect(onAsk).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Toggle" }));
  await user.keyboard("r");
  expect(onAsk).toHaveBeenCalledOnce();
  // Its badge goes with it: a key that does nothing here is not shown.
  expect(document.querySelector("[data-hotkey='app.ask']")).toBeNull();
});

test("the badge sits in the button without changing its name, and the key is in aria-keyshortcuts", () => {
  render(<Screen onAsk={() => {}} />);
  const button = screen.getByRole("button", { name: "Ask an agent" });
  const badge = button.querySelector("[data-hotkey='app.ask']");
  expect(badge).toHaveTextContent(formatKeys("r"));
  expect(badge).toHaveAttribute("aria-hidden", "true");
  expect(button).toHaveAttribute("aria-keyshortcuts", "R");
});

test("badges hide when she turns them off (or off the computer layout); the key still works", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  render(<Screen onAsk={onAsk} badges={false} />);
  expect(document.querySelector("[data-hotkey]")).toBeNull();
  const button = screen.getByRole("button", { name: "Ask an agent" });
  // The key is still announced: the setting is about the look, not the keys.
  expect(button).toHaveAttribute("aria-keyshortcuts", "R");
  await user.keyboard("r");
  expect(onAsk).toHaveBeenCalledOnce();
});

test("on the phone layout the keys are off and nothing shows", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  render(<Screen onAsk={onAsk} enabled={false} />);
  await user.keyboard("r");
  expect(onAsk).not.toHaveBeenCalled();
  expect(document.querySelector("[data-hotkey]")).toBeNull();
  expect(screen.getByRole("button", { name: "Ask an agent" })).not.toHaveAttribute(
    "aria-keyshortcuts",
  );
});

test("an unknown id shows nothing, and nothing shows outside the provider", () => {
  render(
    <HotkeyProvider enabled badges>
      <Kbd hotkey="no.such.key" />
    </HotkeyProvider>,
  );
  expect(document.querySelector("[data-hotkey]")).toBeNull();
  render(
    <Button hotkey="app.ask" onClick={() => {}}>
      Alone
    </Button>,
  );
  expect(screen.getByRole("button", { name: "Alone" })).not.toHaveAttribute("aria-keyshortcuts");
});

function Panel() {
  useHotkey("app.sidebar", () => {});
  return (
    <IconButton aria-label="Hide sidebar" hotkey="app.sidebar">
      <span />
    </IconButton>
  );
}

test("an icon-only button names its key in its hint, never inline", () => {
  render(
    <HotkeyProvider enabled badges>
      <Panel />
    </HotkeyProvider>,
  );
  const button = screen.getByRole("button", { name: "Hide sidebar" });
  expect(button.querySelector("[data-hotkey]")).toBeNull();
  expect(button.getAttribute("aria-keyshortcuts")).toContain("\\");
});
