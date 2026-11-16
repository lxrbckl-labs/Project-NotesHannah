import { BLOCK_LIMITS, type BlockOf, type CitedText, type RichText } from "@notes/schema";
import { Pill } from "lucide-react";
import { toneVars } from "../ui/hooks";
import { cx } from "../ui/primitives";
import { CitedEntry } from "./cited";
import { AddButton, Eyebrow, PlainInput, useBlockEdit } from "./common";

type Card = BlockOf<"drug_card">;
type ListKey =
  | "indications"
  | "adverseEffects"
  | "contraindications"
  | "interactions"
  | "monitoring"
  | "counselling"
  | "dosingNotes";

const SECTIONS: Array<{ key: ListKey; label: string; one: string }> = [
  { key: "indications", label: "Indications", one: "indication" },
  { key: "adverseEffects", label: "Adverse effects", one: "adverse effect" },
  { key: "contraindications", label: "Contraindications & cautions", one: "contraindication" },
  { key: "interactions", label: "Interactions", one: "interaction" },
  { key: "monitoring", label: "Monitoring", one: "monitoring point" },
  { key: "counselling", label: "Counselling", one: "counselling point" },
];

const empty = (): CitedText => ({ text: [], citations: [], flags: [] });

/** A drug card (D4): clinical fields kept apart, each with its own sources and flags. */
export function DrugCardBlock({ block }: { block: Card }) {
  const { editing, active, patch } = useBlockEdit(block);
  const c = block.content;
  const tone = block.style?.color ?? "teal";
  const tools = editing && active;

  const setList = (key: ListKey, list: CitedText[], label: string) => patch({ [key]: list }, label);
  const editEntry = (key: ListKey, index: number, text: RichText) =>
    setList(
      key,
      c[key].map((entry, i) => (i === index ? { ...entry, text } : entry)),
      "Edit drug card",
    );
  const single = (key: "drugClass" | "mechanism", text: RichText) =>
    patch({ [key]: { ...(c[key] ?? empty()), text } }, "Edit drug card");

  const section = (key: ListKey, label: string, one: string, wide = false) => {
    const entries = c[key];
    if (entries.length === 0 && !tools) return null;
    const dosing = key === "dosingNotes";
    return (
      <section
        key={key}
        aria-label={label}
        data-testid={`drug-${key}`}
        className={cx(
          "rounded-xl px-3.5 py-3",
          wide && "md:col-span-2",
          dosing
            ? "border border-[var(--doc-red-border)] bg-[var(--doc-red-bg)]/60"
            : "border border-border/70 bg-surface",
        )}
      >
        <Eyebrow className={cx("mb-1.5", dosing && "text-[var(--doc-red-fg)]")}>{label}</Eyebrow>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px] leading-relaxed">
          {entries.map((entry, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional
              key={i}
              className="relative pl-3.5 before:absolute before:top-[0.7em] before:left-0 before:size-1.5 before:rounded-full before:bg-[var(--t-solid)] before:content-['']"
            >
              <CitedEntry
                block={block}
                field={`${key}.${i}`}
                value={entry}
                editing={editing}
                removable={tools}
                label={`${one} ${i + 1}`}
                onCommit={(text) => editEntry(key, i, text)}
                onRemove={() =>
                  setList(
                    key,
                    entries.filter((_, j) => j !== i),
                    `Remove ${one}`,
                  )
                }
              />
            </li>
          ))}
        </ul>
        {tools && entries.length < BLOCK_LIMITS.drugListEntries && (
          <div className="mt-2">
            <AddButton
              testId={`add-${key}`}
              onClick={() => setList(key, [...entries, empty()], `Add ${one}`)}
            >
              {one}
            </AddButton>
          </div>
        )}
      </section>
    );
  };

  return (
    <article
      aria-label={`Drug card: ${c.name}`}
      data-testid="drug-card"
      className="doc-tone overflow-hidden rounded-3xl border border-[var(--t-border)] bg-surface shadow-[var(--doc-sheet-shadow)]"
      style={toneVars(tone)}
    >
      <header className="flex items-start gap-3.5 border-b border-[var(--t-border)] bg-[var(--t-bg)] px-5 py-4">
        <span
          aria-hidden
          className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--t-solid)] text-white shadow-sm"
        >
          <Pill className="size-5.5" />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow className="text-[var(--t-fg)]">Drug card</Eyebrow>
          {editing ? (
            <PlainInput
              value={c.name}
              required
              label="Generic name"
              className="text-[1.35rem] font-bold capitalize"
              onCommit={(name) => patch({ name }, "Rename drug")}
            />
          ) : (
            <h3 className="m-0 text-[1.35rem] leading-tight font-bold capitalize">{c.name}</h3>
          )}
          {editing ? (
            <PlainInput
              value={c.brandNames.join(", ")}
              label="Brand names, separated by commas"
              placeholder="Brand names, separated by commas"
              className="mt-1 text-[14px] text-text-muted"
              onCommit={(value) =>
                patch(
                  {
                    brandNames: value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean)
                      .slice(0, BLOCK_LIMITS.brandNames),
                  },
                  "Edit brand names",
                )
              }
            />
          ) : (
            c.brandNames.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-1.5">
                {c.brandNames.map((brand) => (
                  <span
                    key={brand}
                    className="rounded-full border border-[var(--t-border)] bg-surface px-2.5 py-0.5 text-[12.5px] font-medium text-[var(--t-fg)]"
                  >
                    {brand}
                  </span>
                ))}
              </p>
            )
          )}
          {(c.drugClass || editing) && (
            <div className="mt-2 text-[14.5px] text-text">
              <span className="sr-only">Class: </span>
              <CitedEntry
                block={block}
                field="drugClass"
                value={c.drugClass ?? empty()}
                editing={editing}
                label="Drug class"
                onCommit={(text) => single("drugClass", text)}
              />
            </div>
          )}
        </div>
      </header>
      <div className="grid gap-2.5 p-3 md:grid-cols-2 md:p-4">
        {(c.mechanism || editing) && (
          <section
            aria-label="Mechanism"
            className="rounded-xl border border-border/70 bg-surface px-3.5 py-3 md:col-span-2"
          >
            <Eyebrow className="mb-1">Mechanism</Eyebrow>
            <div className="text-[15px] leading-relaxed">
              <CitedEntry
                block={block}
                field="mechanism"
                value={c.mechanism ?? empty()}
                editing={editing}
                label="Mechanism"
                onCommit={(text) => single("mechanism", text)}
              />
            </div>
          </section>
        )}
        {SECTIONS.map((s) => section(s.key, s.label, s.one))}
        {section("dosingNotes", "Dosing", "dosing note", true)}
      </div>
    </article>
  );
}
