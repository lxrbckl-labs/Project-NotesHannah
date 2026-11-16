import {
  COMPARISON_LABELS,
  CONCEPT_LIMITS,
  type ComparisonAttribute,
  type ComparisonResult,
  type ConceptSummary,
} from "@notes/schema";
import { Table2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { describeError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { pluralise } from "./model/text";
import { RequestComposer } from "./ui/ask";
import { useConcepts } from "./ui/context";
import { Card, Chip, CiteList, ConceptLink, ConceptPicker } from "./ui/parts";

const ATTRIBUTES: ComparisonAttribute[] = [
  "belongs_to_class",
  "has_mechanism",
  "treats",
  "causes_adverse_effect",
  "interacts_with",
  "contraindicated_in",
  "monitored_by",
  "brand_names",
];
const DEFAULT_ATTRIBUTES: ComparisonAttribute[] = [
  "belongs_to_class",
  "causes_adverse_effect",
  "contraindicated_in",
  "monitored_by",
];

/** Pick drugs (or a whole class) and attributes; get the server's comparison as a table. */
export function Compare() {
  const { store } = useConcepts();
  const [drugs, setDrugs] = useState<ConceptSummary[]>([]);
  const [attributes, setAttributes] = useState<ComparisonAttribute[]>(DEFAULT_ATTRIBUTES);
  const [includeClass, setIncludeClass] = useState(false);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; error: unknown }
    | {
        status: "ready";
        result: ComparisonResult;
        drugs: ConceptSummary[];
        attributes: ComparisonAttribute[];
      }
  >({ status: "idle" });
  const [composer, setComposer] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [classNote, setClassNote] = useState<string | null>(null);

  const addDrug = (c: ConceptSummary) =>
    setDrugs((list) =>
      list.some((d) => d.id === c.id) || list.length >= CONCEPT_LIMITS.compareConcepts
        ? list
        : [...list, c],
    );

  const addClass = async (cls: ConceptSummary) => {
    setClassNote(null);
    try {
      const found = await store.query({
        kind: "in_class",
        class: { id: cls.id },
        includeSubclasses: true,
        limit: 50,
      });
      const members = found.items.map((r) => r.concept).filter((c) => c.type === "drug");
      setDrugs((list) => {
        const merged = [...list];
        for (const m of members) if (!merged.some((d) => d.id === m.id)) merged.push(m);
        return merged.slice(0, CONCEPT_LIMITS.compareConcepts);
      });
      setClassNote(`Added ${pluralise(members.length, "drug")} from ${cls.name}.`);
    } catch (e) {
      setClassNote(describeError(e).message);
    }
  };

  const build = async () => {
    setState({ status: "loading" });
    setNotice(null);
    try {
      const result = await store.compare({
        conceptIds: drugs.map((d) => d.id),
        attributes,
        includeClass,
      });
      setState({ status: "ready", result, drugs, attributes });
    } catch (error) {
      setState({ status: "error", error });
    }
  };

  const toggle = (a: ComparisonAttribute) =>
    setAttributes((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]));
  const canBuild = drugs.length >= 2 && attributes.length > 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Card className="grid gap-4">
        <div>
          <h2 className="font-display text-title font-semibold">Compare drugs side by side</h2>
          <p className="mt-1 text-ui text-text-muted">
            Choose at least two drugs, or add a whole class, then the things to compare.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ConceptPicker
            label="Add a drug"
            types={["drug"]}
            exclude={drugs.map((d) => d.id)}
            placeholder="For example atenolol"
            onPick={addDrug}
          />
          <ConceptPicker
            label="Add a whole class"
            types={["drug_class"]}
            placeholder="For example ACE inhibitors"
            onPick={addClass}
          />
        </div>
        {classNote ? (
          <p role="status" className="text-ui text-text-muted">
            {classNote}
          </p>
        ) : null}
        <div>
          <p className="mb-1.5 text-ui font-medium">
            Drugs{" "}
            <span className="font-normal text-text-muted">
              ({drugs.length} of {CONCEPT_LIMITS.compareConcepts})
            </span>
          </p>
          {drugs.length === 0 ? (
            <p className="text-ui text-text-muted">None yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5" data-testid="compare-drugs">
              {drugs.map((d) => (
                <li key={d.id}>
                  <Chip
                    removeLabel={`Remove ${d.name}`}
                    onRemove={() => setDrugs((l) => l.filter((x) => x.id !== d.id))}
                  >
                    {d.name}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </div>
        <fieldset>
          <legend className="mb-1.5 text-ui font-medium">What to compare</legend>
          <div className="flex flex-wrap gap-2">
            {ATTRIBUTES.map((a) => {
              const on = attributes.includes(a);
              return (
                <label
                  key={a}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border px-3.5 text-ui font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                    on ? "border-accent bg-accent-soft text-accent" : "border-border bg-bg",
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-(--color-accent)"
                    checked={on}
                    onChange={() => toggle(a)}
                  />
                  {COMPARISON_LABELS[a]}
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="inline-flex min-h-11 items-center gap-2.5 text-ui">
          <input
            type="checkbox"
            className="size-4 accent-(--color-accent)"
            checked={includeClass}
            onChange={(e) => setIncludeClass(e.target.checked)}
          />
          Also show what each drug's class has, marked as from the class
        </label>
        <div>
          <Button
            variant="primary"
            disabled={!canBuild || state.status === "loading"}
            onClick={build}
          >
            <Table2 size={16} aria-hidden /> Build table
          </Button>
          {!canBuild ? (
            <span className="ml-3 text-ui text-text-muted">
              {drugs.length < 2 ? "Pick at least two drugs." : "Pick something to compare."}
            </span>
          ) : null}
        </div>
      </Card>

      {state.status === "loading" ? (
        <Skeleton className="h-56" />
      ) : state.status === "error" ? (
        <ErrorState error={state.error} onRetry={build} />
      ) : state.status === "ready" ? (
        <section aria-label="Comparison" className="grid min-w-0 gap-3">
          <ComparisonTable result={state.result} />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setComposer(true)}>
              Leave a request to add this to a study guide
            </Button>
            {notice ? (
              <span role="status" className="text-ui text-accent" data-testid="compare-notice">
                {notice}
              </span>
            ) : null}
          </div>
          <RequestComposer
            open={composer}
            onOpenChange={setComposer}
            target={{ type: "library" }}
            targetLabel="Comparison table"
            defaultKind="other"
            defaultMessage={`Please add this comparison to a study guide. Drugs: ${state.drugs
              .map((d) => d.name)
              .join(
                ", ",
              )}. Compare: ${state.attributes.map((a) => COMPARISON_LABELS[a]).join(", ")}.`}
            submit={store.createRequest}
            onCreated={() =>
              setNotice("Request left. An agent will pick it up the next time one runs.")
            }
          />
        </section>
      ) : (
        <EmptyState icon={<Table2 size={24} />} title="Your table will appear here">
          Pick two or more drugs and press Build table.
        </EmptyState>
      )}
    </div>
  );
}

/** The comparison as a table: sticky first column, scrolls sideways, source chips in every cell. */
export function ComparisonTable({ result }: { result: ComparisonResult }) {
  return (
    <section
      className="relative max-w-full overflow-x-auto rounded-card border border-border bg-surface shadow-card"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll area needs the keyboard
      tabIndex={0}
      aria-label="Comparison table, scrolls sideways"
      data-testid="comparison"
    >
      <table className="w-full min-w-max border-separate border-spacing-0 text-ui">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-(--z-raised) border-b border-r border-border bg-surface-muted px-4 py-3 text-left font-semibold"
            >
              Drug
            </th>
            {result.columns.map((col) => (
              <th
                key={col.attribute}
                scope="col"
                className="min-w-56 border-b border-border bg-surface-muted px-4 py-3 text-left font-semibold"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.concept.id} data-testid="compare-row">
              <th
                scope="row"
                className="sticky left-0 z-(--z-raised) border-b border-r border-border bg-surface px-4 py-3 text-left align-top font-semibold"
              >
                <ConceptLink id={row.concept.id}>{row.concept.name}</ConceptLink>
              </th>
              {row.cells.map((cell) => (
                <td
                  key={cell.attribute}
                  className="border-b border-border px-4 py-3 align-top"
                  data-testid="compare-cell"
                >
                  {cell.values.length === 0 ? (
                    <span className="text-text-muted">
                      <span aria-hidden>—</span>
                      <span className="sr-only">Nothing filed</span>
                    </span>
                  ) : (
                    <ul className="grid gap-1">
                      {cell.values.map((v) => (
                        <li key={`${v.relationId ?? v.text}${v.inheritedFrom?.id ?? ""}`}>
                          {v.concept ? (
                            <ConceptLink id={v.concept.id}>{v.text}</ConceptLink>
                          ) : (
                            v.text
                          )}
                          {v.inheritedFrom ? (
                            <span className="ml-1.5 text-caption text-text-muted">
                              from {v.inheritedFrom.name}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {cell.citations.length > 0 ? (
                    <div className="mt-2">
                      <CiteList citations={cell.citations} />
                    </div>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
