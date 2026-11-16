import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Hue } from "../../lib/hues";
import { Badge, Chip } from "./badge";
import { IconButton } from "./button";
import { Card } from "./card";
import { HuePicker } from "./hue-picker";
import { ProgressBar } from "./progress";
import { SegmentedControl, Tab, TabList, TabPanel, Tabs } from "./segmented";
import { StatTile } from "./stat";
import { Switch } from "./switch";

function Theme() {
  const [value, setValue] = useState<"light" | "dark" | "system">("system");
  return (
    <>
      <SegmentedControl
        label="Theme"
        value={value}
        onValueChange={setValue}
        items={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "system", label: "System" },
        ]}
      />
      <output>{value}</output>
    </>
  );
}

function Picker() {
  const [hue, setHue] = useState<Hue | null>(null);
  return (
    <>
      <HuePicker label="Card colour" value={hue} onChange={setHue} />
      <output>{hue ?? "none"}</output>
    </>
  );
}

describe("Badge", () => {
  it("sets the hue it is given, so the tone utilities pick it up", () => {
    render(<Badge hue="purple">Mechanism</Badge>);
    expect(screen.getByText("Mechanism").closest("[data-hue]")).toHaveAttribute(
      "data-hue",
      "purple",
    );
  });

  it("maps the old tone prop onto the palette", () => {
    render(
      <>
        <Badge tone="danger">Failed</Badge>
        <Badge>Uploaded</Badge>
        <Badge tone="accent">Filed</Badge>
      </>,
    );
    expect(screen.getByText("Failed").closest("[data-hue]")).toHaveAttribute("data-hue", "red");
    expect(screen.getByText("Uploaded").closest("[data-hue]")).toHaveAttribute("data-hue", "gray");
    expect(screen.getByText("Filed").closest("[data-hue]")).toHaveAttribute("data-hue", "accent");
  });
});

describe("Chip", () => {
  it("is a button that reports its pressed state", async () => {
    const onClick = vi.fn();
    render(
      <Chip hue="teal" pressed={false} onClick={onClick}>
        Indication
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Indication" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("IconButton", () => {
  it("takes its name from label or aria-label", () => {
    render(
      <>
        <IconButton label="Close">x</IconButton>
        <IconButton aria-label="More">…</IconButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("is a toggle when given pressed", () => {
    render(
      <IconButton label="Bold" pressed>
        B
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Card", () => {
  it("renders as the element asked for, tinted when given a hue", () => {
    render(
      <Card as="section" hue="blue" aria-label="Info">
        Body
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Info" });
    expect(card.tagName).toBe("SECTION");
    expect(card).toHaveAttribute("data-hue", "blue");
  });
});

describe("SegmentedControl", () => {
  it("changes the value on click and keeps it when the chosen item is clicked again", async () => {
    render(<Theme />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("status")).toHaveTextContent("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByRole("status")).toHaveTextContent("dark");
  });

  it("moves between items with the arrow keys", async () => {
    render(<Theme />);
    screen.getByRole("radio", { name: "System" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();
  });
});

describe("Tabs", () => {
  it("shows one panel at a time and switches with the keyboard", async () => {
    render(
      <Tabs defaultValue="browse" look="pill">
        <TabList label="Concept tools">
          <Tab value="browse">Browse</Tab>
          <Tab value="drill">Drill</Tab>
        </TabList>
        <TabPanel value="browse">Browse panel</TabPanel>
        <TabPanel value="drill">Drill panel</TabPanel>
      </Tabs>,
    );
    expect(screen.getByRole("tablist", { name: "Concept tools" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Browse panel");
    screen.getByRole("tab", { name: "Browse" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Drill" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Drill panel");
  });
});

describe("Switch", () => {
  it("toggles from its label and announces its state", async () => {
    const onChange = vi.fn();
    render(<Switch label="Show hints" checked={false} onCheckedChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Show hints" });
    expect(control).toHaveAttribute("aria-checked", "false");
    await userEvent.click(screen.getByText("Show hints"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("HuePicker", () => {
  it("names every swatch and reports the choice, including no colour", async () => {
    render(<Picker />);
    expect(screen.getByRole("radiogroup", { name: "Card colour" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(11);
    await userEvent.click(screen.getByRole("radio", { name: "Teal" }));
    expect(screen.getByRole("status")).toHaveTextContent("teal");
    await userEvent.click(screen.getByRole("radio", { name: "No colour" }));
    expect(screen.getByRole("status")).toHaveTextContent("none");
  });
});

describe("ProgressBar", () => {
  it("exposes its value and clamps it to the range", () => {
    render(<ProgressBar label="Cards reviewed" value={14} max={10} showValue />);
    const bar = screen.getByRole("progressbar", { name: "Cards reviewed" });
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(screen.getByText("10 of 10")).toBeInTheDocument();
  });

  it("copes with an empty range", () => {
    render(<ProgressBar label="Nothing yet" value={0} max={0} />);
    expect(screen.getByRole("progressbar", { name: "Nothing yet" })).toBeInTheDocument();
  });
});

describe("StatTile", () => {
  it("shows the label with the number", () => {
    render(<StatTile label="Due today" value={12} hue="blue" />);
    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
