import type { ConceptSummary, ConceptType } from "@notes/schema";
import { CONCEPT_TYPE_INFO, CONCEPT_TYPES } from "@notes/schema";
import { BookMarked, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { HeaderArt } from "../../components/art/pills";
import { Chip } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { inputClass } from "../../components/ui/field";
import { PageHeader } from "../../components/ui/page-header";
import { Tab, TabList, TabPanel, Tabs } from "../../components/ui/segmented";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { CONCEPT_TYPE_HUE } from "../../lib/roles";
import { Compare } from "./Compare";
import { Drill } from "./Drill";
import { Finder } from "./Finder";
import type { Rng } from "./model/drill";
import { letterOf, pluralise } from "./model/text";
import type { ConceptsStore, ConceptsViewProps } from "./types";
import { ConceptsProvider, useConcepts } from "./ui/context";
import { useAsync, useDebounced } from "./ui/hooks";
import { ConceptLink, TypeBadge } from "./ui/parts";
import "./concepts.css";

type TabId = "browse" | "find" | "compare" | "drill";
const TABS: Array<{ id: TabId; label: string }> = [
  { id: "browse", label: "Browse" },
  { id: "find", label: "Ask a question" },
  { id: "compare", label: "Compare" },
  { id: "drill", label: "Drill" },
];

/** Follow the cursors until the whole list is in (libraries are small). */
export async function listAllConcepts(store: ConceptsStore): Promise<ConceptSummary[]> {
  const items: ConceptSummary[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 30; guard++) {
    const page = await store.list({ cursor, limit: 200 });
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export interface ConceptsIndexProps extends ConceptsViewProps {
  /** Fixes the drill's shuffle (demo and tests). */
  drillRng?: Rng;
}

/** The concepts home: browse and search, ask cross-course questions, compare drugs, drill names. */
export function ConceptsIndex({
  store,
  openSource,
  openNode,
  search,
  drillRng,
  ...navigation
}: ConceptsIndexProps) {
  const initial = (search.get("tab") as TabId | null) ?? "browse";
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? initial : "browse");
  return (
    <ConceptsProvider store={store} context={{ openSource, openNode }} navigation={navigation}>
      <div
        className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 md:px-8 md:pt-8"
        data-testid="concepts-index"
      >
        <PageHeader
          art={<HeaderArt kind="concepts" />}
          title="Concepts"
          description="Drugs, classes and mechanisms from all your courses, in one place."
          className="mb-4"
        />
        <Tabs value={tab} onValueChange={setTab} look="pill">
          <TabList label="Concept tools" className="-mx-1 px-1 pb-1">
            {TABS.map((t) => (
              <Tab key={t.id} value={t.id} className="px-3.5">
                {t.label}
              </Tab>
            ))}
          </TabList>
          <TabPanel value="browse">
            <Browse />
          </TabPanel>
          <TabPanel value="find">
            <Finder />
          </TabPanel>
          <TabPanel value="compare">
            <Compare />
          </TabPanel>
          <TabPanel value="drill">
            <Drill rng={drillRng} />
          </TabPanel>
        </Tabs>
      </div>
    </ConceptsProvider>
  );
}

function Browse() {
  const { store } = useConcepts();
  const [q, setQ] = useState("");
  const [type, setType] = useState<ConceptType | null>(null);
  const debounced = useDebounced(q.trim());
  const all = useAsync(
    useCallback(() => listAllConcepts(store), [store]),
    "all",
  );
  const found = useAsync(
    () =>
      debounced
        ? store.search(debounced, { type: type ?? undefined, limit: 50 })
        : Promise.resolve(null),
    `${debounced}:${type ?? ""}`,
  );

  const counts = useMemo(() => {
    const m = new Map<ConceptType, number>();
    for (const c of all.data ?? []) m.set(c.type, (m.get(c.type) ?? 0) + 1);
    return m;
  }, [all.data]);

  const rows: ConceptSummary[] | null = useMemo(() => {
    if (debounced) return found.data ?? null;
    if (!all.data) return null;
    const list = type ? all.data.filter((c) => c.type === type) : all.data;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [all.data, found.data, debounced, type]);

  const grouped = useMemo(() => {
    if (!rows || debounced) return null;
    const groups = new Map<string, ConceptSummary[]>();
    for (const c of rows)
      groups.set(letterOf(c.name), [...(groups.get(letterOf(c.name)) ?? []), c]);
    return [...groups];
  }, [rows, debounced]);

  if (all.status === "error") return <ErrorState error={all.error} onRetry={all.reload} />;
  return (
    <div className="grid gap-4">
      <div className="relative max-w-xl">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
        />
        <input
          type="search"
          aria-label="Search concepts by name, alias or brand"
          placeholder="Search by name, alias or brand, like Lopressor"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={cn(inputClass, "pl-10")}
          data-testid="concept-search"
        />
      </div>
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Filter by type</legend>
        <TypeFilter
          active={type === null}
          onClick={() => setType(null)}
          label="All"
          count={all.data?.length}
        />
        {CONCEPT_TYPES.filter((t) => counts.has(t)).map((t) => (
          <TypeFilter
            key={t}
            type={t}
            active={type === t}
            onClick={() => setType(type === t ? null : t)}
            label={CONCEPT_TYPE_INFO[t].label}
            count={counts.get(t)}
          />
        ))}
      </fieldset>
      {all.status === "loading" || (debounced && found.status === "loading" && !found.data) ? (
        <LoadingList rows={6} label="Loading concepts" />
      ) : found.status === "error" && debounced ? (
        <ErrorState error={found.error} onRetry={found.reload} />
      ) : !rows || rows.length === 0 ? (
        debounced || type ? (
          <EmptyState icon={<Search size={24} />} title="No matches">
            Nothing matches that. Try a shorter name, a brand name, or clear the filter.
          </EmptyState>
        ) : (
          <EmptyState icon={<BookMarked size={24} />} title="No concepts yet">
            Agents file drugs, classes and mechanisms here as they read your notes. They will appear
            after the next time an agent runs.
          </EmptyState>
        )
      ) : grouped ? (
        <div className="grid gap-5" data-testid="concept-list">
          {grouped.map(([letter, items]) => (
            <section key={letter} aria-label={`Names starting with ${letter}`}>
              <h2 className="mb-1.5 px-1 font-display text-ui font-semibold text-text-muted">
                {letter}
              </h2>
              <ConceptRows items={items} />
            </section>
          ))}
        </div>
      ) : (
        <div data-testid="concept-list">
          <p className="mb-2 px-1 text-ui text-text-muted">
            {pluralise(rows.length, "match", "matches")}
          </p>
          <ConceptRows items={rows} />
        </div>
      )}
    </div>
  );
}

function TypeFilter({
  type,
  active,
  onClick,
  label,
  count,
}: {
  type?: ConceptType;
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number | undefined;
}) {
  return (
    <Chip hue={type ? CONCEPT_TYPE_HUE[type] : undefined} pressed={active} onClick={onClick}>
      {label}
      {count !== undefined ? (
        <>
          {" "}
          <span className="ml-1 opacity-80">{count}</span>
        </>
      ) : null}
    </Chip>
  );
}

function ConceptRows({ items }: { items: ConceptSummary[] }) {
  return (
    <ul className="grid gap-1.5 xl:grid-cols-3">
      {items.map((c) => (
        <Card
          as="li"
          key={c.id}
          data-testid="concept-row"
          padding="none"
          className="flex min-h-14 items-center justify-between gap-3 px-4 py-2"
        >
          <span className="min-w-0">
            <ConceptLink id={c.id} className="block truncate py-1.5">
              {c.name}
            </ConceptLink>
            {c.reviewStatus === "unverified" ? <span className="sr-only">Unverified</span> : null}
          </span>
          <TypeBadge type={c.type} />
        </Card>
      ))}
    </ul>
  );
}
