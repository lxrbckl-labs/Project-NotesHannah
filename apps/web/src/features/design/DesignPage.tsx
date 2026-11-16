import {
  BookOpen,
  Brain,
  CalendarCheck,
  Flame,
  Layers,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ThemeSwitch } from "../../app/ThemeSwitch";
import { Page } from "../../components/Page";
import { Badge, Chip } from "../../components/ui/badge";
import { Button, type ButtonVariant, IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ConfirmDialog, Modal } from "../../components/ui/dialog";
import { Disclosure } from "../../components/ui/disclosure";
import { Field, TextArea, TextInput } from "../../components/ui/field";
import { HuePicker } from "../../components/ui/hue-picker";
import { ActionMenu } from "../../components/ui/menu";
import { PageHeader } from "../../components/ui/page-header";
import { Popover } from "../../components/ui/popover";
import { ProgressBar } from "../../components/ui/progress";
import { SegmentedControl, Tab, TabList, TabPanel, Tabs } from "../../components/ui/segmented";
import { Sheet, type SheetPlacement } from "../../components/ui/sheet";
import { StatTile } from "../../components/ui/stat";
import { EmptyState, LoadingList, Skeleton, Spinner } from "../../components/ui/states";
import { Switch } from "../../components/ui/switch";
import { useToast } from "../../components/ui/toast";
import { Tooltip } from "../../components/ui/tooltip";
import { CATEGORICAL_HUES, HUE_LABEL, HUES, type Hue, hueForId } from "../../lib/hues";
import {
  CALLOUT_HUE,
  CONCEPT_TYPE_HUE,
  CONNECTOR_HUE,
  DOCUMENT_HUE,
  FEEDBACK_HUE,
  FILE_STATUS_HUE,
  RATING_HUE,
  REQUEST_STATUS_HUE,
  SEVERITY_HUE,
  STATUS_TONE,
} from "../../lib/roles";

/** "adverse_effect" and "flagDose" -> "adverse effect", "flag dose". */
const words = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

const SHADES = ["solid", "soft", "text", "border", "mark"] as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-6">
      <h2 id={id} className="font-display text-heading font-semibold">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 max-w-prose text-ui text-text-muted">{description}</p>
      ) : null}
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}

function Swatch({ name, value, className }: { name: string; value: string; className?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className={`size-9 shrink-0 rounded-control border border-border ${className ?? ""}`}
        style={{ background: value }}
      />
      <code className="min-w-0 truncate font-mono text-caption text-text-muted">{name}</code>
    </div>
  );
}

function RoleRow({ title, map }: { title: string; map: Record<string, string> }) {
  return (
    <div>
      <h3 className="mb-2 text-label font-semibold text-text-muted">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {Object.entries(map).map(([key, hue]) => (
          <Badge key={key} hue={hue as Hue} dot>
            {words(key)}
          </Badge>
        ))}
      </div>
    </div>
  );
}

const BASE = [
  "bg",
  "surface",
  "surface-muted",
  "border",
  "border-strong",
  "text",
  "text-muted",
  "accent",
  "accent-contrast",
  "accent-soft",
  "accent-border",
  "dot",
  "selection",
];

const SEMANTIC = ["success", "warning", "info", "danger"] as const;

const BUTTONS: ButtonVariant[] = [
  "primary",
  "secondary",
  "subtle",
  "ghost",
  "ghostAccent",
  "ghostDanger",
  "danger",
];

export function DesignPage() {
  const toast = useToast();
  const [view, setView] = useState<"page" | "canvas">("page");
  const [hue, setHue] = useState<Hue | null>("teal");
  const [on, setOn] = useState(true);
  const [chips, setChips] = useState<string[]>(["drug"]);
  const [sheet, setSheet] = useState<SheetPlacement | null>(null);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <Page className="max-w-6xl">
      <PageHeader
        back={{ to: "/settings", label: "Back to settings" }}
        icon={<Palette />}
        eyebrow="Settings"
        title="Design reference"
        description="Every colour, scale and shared component, in the current theme. docs/design.md explains when to use each."
        actions={<ThemeSwitch />}
      />

      <nav aria-label="Sections" className="mb-8 flex flex-wrap gap-2">
        {[
          ["palette", "Palette"],
          ["semantic", "Semantic"],
          ["roles", "Roles"],
          ["base", "Base"],
          ["scales", "Scales"],
          ["type", "Type"],
          ["components", "Components"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="hit-area inline-flex min-h-8 items-center rounded-pill border border-border bg-surface px-3 text-label font-medium hover:bg-surface-muted"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="grid gap-12">
        <Section
          id="palette"
          title="Palette"
          description="Ten hues, named like the colour tokens stored on cards, frames and highlights. Each has five shades. The eight lively hues also colour things with no colour of their own."
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {HUES.map((h) => (
              <Card key={h} padding="sm" className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{HUE_LABEL[h]}</h3>
                  {(CATEGORICAL_HUES as readonly string[]).includes(h) ? (
                    <Badge hue={h} size="sm">
                      lively
                    </Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {SHADES.map((shade) => (
                    <div key={shade} className="grid justify-items-center gap-1">
                      <span
                        aria-hidden
                        className="h-9 w-full rounded-control border border-border"
                        style={{ background: `var(--hue-${h}-${shade})` }}
                      />
                      <span className="text-caption text-text-muted">{shade}</span>
                    </div>
                  ))}
                </div>
                <div data-hue={h} className="rounded-control bg-tone-soft p-2.5 text-ui">
                  <span className="font-semibold text-tone-text">Text on soft.</span>{" "}
                  <span>Body text on soft, with a </span>
                  <mark className="rounded-[3px] bg-tone-mark px-0.5 text-text">highlight</mark>.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge hue={h}>Soft</Badge>
                  <Badge hue={h} variant="outline">
                    Outline
                  </Badge>
                  <Badge hue={h} variant="solid">
                    Solid
                  </Badge>
                  <Badge hue={h} dot>
                    Dot
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
          <Card padding="sm">
            <h3 className="mb-2 text-label font-semibold text-text-muted">
              Stable hue from an id (hueForId)
            </h3>
            <div className="flex flex-wrap gap-2">
              {["Pharmacology 1", "Pharmaceutics", "Therapeutics", "Microbiology", "Law"].map(
                (course) => (
                  <Badge key={course} hue={hueForId(course)} dot>
                    {course}
                  </Badge>
                ),
              )}
            </div>
          </Card>
        </Section>

        <Section
          id="semantic"
          title="Semantic colours"
          description="Success, warning, info and danger, each from a hue. Use them for messages and states, never for decoration."
        >
          <div className="grid gap-3 md:grid-cols-2">
            {SEMANTIC.map((role) => (
              <div
                key={role}
                className="rounded-card border p-3"
                style={{
                  background: `var(--color-${role}-soft)`,
                  borderColor: `var(--color-${role}-border)`,
                }}
              >
                <p className="font-semibold" style={{ color: `var(--color-${role})` }}>
                  {words(role)}
                </p>
                <p className="text-ui">
                  <code className="font-mono text-caption">--color-{role}</code>, -soft, -border,
                  -solid
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="roles"
          title="Roles"
          description="What each colour means in each feature (src/lib/roles.ts). Always shown with words or an icon too."
        >
          <Card className="grid gap-5">
            <RoleRow title="Concept types" map={CONCEPT_TYPE_HUE} />
            <RoleRow title="Interaction severity" map={SEVERITY_HUE} />
            <RoleRow title="Callouts" map={CALLOUT_HUE} />
            <RoleRow title="Document marks" map={DOCUMENT_HUE} />
            <RoleRow title="Practice feedback" map={FEEDBACK_HUE} />
            <RoleRow title="Recall ratings" map={RATING_HUE} />
            <RoleRow title="Request statuses" map={REQUEST_STATUS_HUE} />
            <RoleRow title="File statuses" map={FILE_STATUS_HUE} />
            <RoleRow title="Canvas connectors" map={CONNECTOR_HUE} />
            <RoleRow title="Status tones" map={STATUS_TONE} />
          </Card>
        </Section>

        <Section
          id="base"
          title="Base colours"
          description="The warm paper neutrals and the green accent."
        >
          <Card className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {BASE.map((name) => (
              <Swatch key={name} name={`--color-${name}`} value={`var(--color-${name})`} />
            ))}
          </Card>
          <div className="dot-grid h-24 rounded-panel border border-border bg-bg" aria-hidden />
        </Section>

        <Section id="scales" title="Scales">
          <Card className="grid gap-6">
            <div>
              <h3 className="mb-2 text-label font-semibold text-text-muted">Radius</h3>
              <div className="flex flex-wrap items-end gap-4">
                {["inline", "control", "card", "panel", "pill"].map((r) => (
                  <div key={r} className="grid justify-items-center gap-1">
                    <span
                      aria-hidden
                      className="size-16 border-2 border-accent bg-accent-soft"
                      style={{ borderRadius: `var(--radius-${r})` }}
                    />
                    <code className="font-mono text-caption text-text-muted">{r}</code>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-label font-semibold text-text-muted">Elevation</h3>
              <div className="flex flex-wrap gap-4 rounded-card bg-bg p-4">
                {["card", "raised", "pop"].map((s) => (
                  <div
                    key={s}
                    className="grid size-24 place-items-center rounded-card bg-surface text-label"
                    style={{ boxShadow: `var(--shadow-${s})` }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-label font-semibold text-text-muted">Layers (z-index)</h3>
              <ol className="grid gap-1 text-ui sm:grid-cols-2">
                {[
                  ["raised", 10],
                  ["sticky", 20],
                  ["nav", 30],
                  ["dock", 40],
                  ["float", 55],
                  ["overlay", 60],
                  ["modal", 61],
                  ["popover", 70],
                  ["toast", 80],
                  ["tooltip", 90],
                  ["skip", 100],
                ].map(([name, value]) => (
                  <li key={name} className="flex justify-between gap-3 border-b border-border py-1">
                    <code className="font-mono text-caption">--z-{name}</code>
                    <span className="tabular-nums text-text-muted">{value}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="mb-2 text-label font-semibold text-text-muted">Motion</h3>
              <MotionDemo />
            </div>
          </Card>
        </Section>

        <Section id="type" title="Type">
          <Card className="grid gap-3">
            {(
              [
                ["display", "Pharmacology 1"],
                ["heading", "Beta blockers"],
                ["title", "Mechanism of action"],
                ["reading", "Propranolol blocks beta-1 and beta-2 receptors."],
                ["body", "Inputs on touch use this size, so iOS does not zoom."],
                ["ui", "Buttons, menus and most interface text."],
                ["label", "Badges, table heads, secondary labels"],
                ["caption", "Counts, timestamps, tiny labels"],
              ] as const
            ).map(([size, sample]) => (
              <div key={size} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <code className="w-20 shrink-0 font-mono text-caption text-text-muted">{size}</code>
                <span
                  className={
                    size === "display" || size === "heading" ? "font-display font-semibold" : ""
                  }
                  style={{
                    fontSize: `var(--text-${size})`,
                    lineHeight: `var(--text-${size}--line-height)`,
                  }}
                >
                  {sample}
                </span>
              </div>
            ))}
          </Card>
          <Card>
            <h3 className="mb-3 text-label font-semibold text-text-muted">
              Study-guide prose (.prose-reading)
            </h3>
            <div className="prose-reading">
              <p>
                <strong>Beta blockers</strong> lower heart rate and contractility by blocking beta-1
                receptors in the heart. Non-selective agents such as propranolol also block beta-2
                receptors, so they can cause <mark>bronchospasm</mark> in asthma.
              </p>
              <ul>
                <li>Cardioselective: atenolol, bisoprolol, metoprolol.</li>
                <li>
                  Monitor <mark data-hue="blue">heart rate and blood pressure</mark>.
                </li>
              </ul>
              <p>
                A usual starting dose is <code>2.5 mg</code> once daily.
              </p>
            </div>
          </Card>
        </Section>

        <Section id="components" title="Components">
          <Card className="grid gap-4">
            <h3 className="font-semibold">Buttons</h3>
            <div className="flex flex-wrap gap-2">
              {BUTTONS.map((v) => (
                <Button key={v} variant={v}>
                  {words(v)}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm">
                Small
              </Button>
              <Button variant="primary">Medium</Button>
              <Button variant="primary" size="lg">
                Large
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip content="Add a card">
                <IconButton label="Add">
                  <Plus size={18} />
                </IconButton>
              </Tooltip>
              <IconButton label="Edit" variant="subtle">
                <Pencil size={18} />
              </IconButton>
              <IconButton label="Edit" variant="secondary" size="sm">
                <Pencil size={16} />
              </IconButton>
              <IconButton label="Pressed" pressed>
                <Layers size={18} />
              </IconButton>
              <IconButton label="Delete" variant="ghostDanger">
                <Trash2 size={18} />
              </IconButton>
              <ActionMenu
                trigger={
                  <IconButton label="More">
                    <MoreHorizontal size={18} />
                  </IconButton>
                }
                entries={[
                  { type: "label", text: "Beta blockers" },
                  { type: "item", label: "Rename", icon: <Pencil size={16} />, onSelect: () => {} },
                  {
                    type: "sub",
                    label: "Colour",
                    icon: <Palette size={16} />,
                    entries: CATEGORICAL_HUES.map((h) => ({
                      type: "item" as const,
                      label: HUE_LABEL[h],
                      onSelect: () => setHue(h),
                    })),
                  },
                  { type: "separator" },
                  {
                    type: "item",
                    label: "Move to trash",
                    icon: <Trash2 size={16} />,
                    danger: true,
                    onSelect: () => {},
                  },
                ]}
              />
            </div>
          </Card>

          <Card className="grid gap-4">
            <h3 className="font-semibold">Badges and chips</h3>
            <div className="flex flex-wrap gap-2">
              {Object.keys(STATUS_TONE).map((tone) => (
                <Badge key={tone} tone={tone as keyof typeof STATUS_TONE}>
                  {tone}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["drug", "drug_class", "mechanism", "adverse_effect"] as const).map((t) => (
                <Chip
                  key={t}
                  hue={CONCEPT_TYPE_HUE[t]}
                  pressed={chips.includes(t)}
                  onClick={() =>
                    setChips((all) => (all.includes(t) ? all.filter((x) => x !== t) : [...all, t]))
                  }
                >
                  {words(t)}
                </Chip>
              ))}
              <Chip icon={<Sparkles />}>Plain chip</Chip>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="grid gap-4">
              <h3 className="font-semibold">Segmented control and tabs</h3>
              <SegmentedControl
                label="View"
                value={view}
                onValueChange={setView}
                items={[
                  { value: "page", label: "Page", icon: <BookOpen size={16} /> },
                  { value: "canvas", label: "Canvas", icon: <Layers size={16} /> },
                ]}
              />
              <Tabs defaultValue="browse" look="pill">
                <TabList label="Concept tools">
                  <Tab value="browse">Browse</Tab>
                  <Tab value="find">Find</Tab>
                  <Tab value="compare">Compare</Tab>
                  <Tab value="drill">Drill</Tab>
                </TabList>
                <TabPanel value="browse" className="text-ui text-text-muted">
                  The browse panel.
                </TabPanel>
                <TabPanel value="find" className="text-ui text-text-muted">
                  The find panel.
                </TabPanel>
                <TabPanel value="compare" className="text-ui text-text-muted">
                  The compare panel.
                </TabPanel>
                <TabPanel value="drill" className="text-ui text-text-muted">
                  The drill panel.
                </TabPanel>
              </Tabs>
            </Card>

            <Card className="grid gap-4">
              <h3 className="font-semibold">Switch, colour and disclosure</h3>
              <Switch
                label="Show hints"
                description="A nudge before the answer."
                checked={on}
                onCheckedChange={setOn}
              />
              <HuePicker label="Card colour" value={hue} onChange={setHue} />
              <Disclosure label="Show working">
                <p className="pb-2 text-ui">Dose = 5 mg/kg x 70 kg = 350 mg.</p>
              </Disclosure>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Due today" value={12} icon={<CalendarCheck />} hue="blue" />
            <StatTile label="Streak" value="5 days" icon={<Flame />} hue="orange" />
            <StatTile
              label="Accuracy"
              value="86%"
              icon={<Target />}
              hue="green"
              hint="Last 7 days"
            />
            <StatTile label="Concepts" value={148} icon={<Brain />} />
          </div>

          <Card className="grid gap-3">
            <h3 className="font-semibold">Progress</h3>
            <ProgressBar label="Session" value={7} max={10} showValue />
            <ProgressBar label="Course" value={40} hue="purple" size="sm" />
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card>Plain card</Card>
            <Card hue={hue ?? undefined}>Tinted card ({hue ? HUE_LABEL[hue] : "none"})</Card>
            <Card interactive>Interactive card</Card>
          </div>

          <Card className="grid gap-3">
            <h3 className="font-semibold">Overlays</h3>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setSheet("side")}>Side sheet</Button>
              <Button onClick={() => setSheet("center")}>Centred sheet</Button>
              <Button onClick={() => setSheet("bottom")}>Bottom sheet</Button>
              <Button onClick={() => setModal(true)}>Modal</Button>
              <Button variant="ghostDanger" onClick={() => setConfirm(true)}>
                Confirm
              </Button>
              <Popover label="Colour" title="Colour" showClose trigger={<Button>Popover</Button>}>
                <HuePicker label="Colour" value={hue} onChange={setHue} />
              </Popover>
              <Button onClick={() => toast.show("Saved")}>Toast</Button>
              <Button onClick={() => toast.success("All 12 cards reviewed")}>Success toast</Button>
              <Button onClick={() => toast.error(new Error("The file could not be read."))}>
                Error toast
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="grid gap-4">
              <h3 className="font-semibold">Fields</h3>
              <Field label="Title" hint="Shown at the top of the page.">
                {(props) => <TextInput {...props} defaultValue="Beta blockers" />}
              </Field>
              <Field label="Dose" error="Enter a number.">
                {(props) => <TextInput {...props} defaultValue="five" />}
              </Field>
              <Field label="Note">{(props) => <TextArea {...props} />}</Field>
            </Card>
            <Card className="grid gap-4">
              <h3 className="font-semibold">Loading</h3>
              <Spinner label="Loading cards" inline />
              <Skeleton className="h-6 w-40" />
              <LoadingList rows={2} />
            </Card>
          </div>

          <EmptyState
            icon={<BookOpen size={26} />}
            title="No documents yet"
            hue="blue"
            action={<Button variant="primary">New document</Button>}
          >
            Documents you create or an agent writes appear here.
          </EmptyState>
        </Section>
      </div>

      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => !open && setSheet(null)}
        title="Outline"
        description="A sheet on the phone; a panel or dialog on larger screens."
        placement={sheet ?? "side"}
        footer={<Button onClick={() => setSheet(null)}>Done</Button>}
      >
        <ol className="grid gap-2 text-ui">
          <li>Mechanism</li>
          <li>Indications</li>
          <li>Adverse effects</li>
        </ol>
      </Sheet>
      <Modal
        open={modal}
        onOpenChange={setModal}
        title="Rename"
        footer={
          <Button variant="primary" onClick={() => setModal(false)}>
            Save
          </Button>
        }
      >
        <Field label="Name">
          {(props) => <TextInput {...props} defaultValue="Beta blockers" />}
        </Field>
      </Modal>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Move to trash?"
        description="Beta blockers and its 3 pages move to the trash."
        confirmLabel="Move to trash"
        danger
        onConfirm={() => setConfirm(false)}
      />
    </Page>
  );
}

function MotionDemo() {
  const [moved, setMoved] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="h-12 rounded-card bg-surface-muted p-1.5">
        <div
          className="size-9 rounded-control bg-accent transition-transform duration-(--duration-slow) ease-calm"
          style={{ transform: moved ? "translateX(min(240px, 60vw))" : "none" }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setMoved((m) => !m)}>
          Move
        </Button>
        <span className="text-label text-text-muted">
          instant 80ms, fast 140ms, base 200ms, slow 320ms; ease calm, exit, standard. Off with
          reduced motion.
        </span>
      </div>
    </div>
  );
}
