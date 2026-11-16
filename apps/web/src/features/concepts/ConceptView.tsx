import {
  type Citation,
  type CitationStatus,
  type Concept,
  type ConceptPage,
  citationKey,
  type NameCheck,
  type RelationGroupItem,
} from "@notes/schema";
import {
  ArrowLeft,
  BadgeCheck,
  CircleHelp,
  FileText,
  ListChecks,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Badge } from "../../components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { describeError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { relationSections, SEVERITY_LABEL } from "./model/relations";
import { pluralise } from "./model/text";
import { Neighbourhood } from "./Neighbourhood";
import type { ConceptsViewProps } from "./types";
import { AskButton } from "./ui/ask";
import { ConceptsProvider, useConcepts } from "./ui/context";
import { useAsync } from "./ui/hooks";
import { Card, CiteChip, CiteList, ConceptLink, RichSummary, TypeBadge } from "./ui/parts";
import "./concepts.css";

/** One concept (F2): what it is, how it relates, where it comes from, and a graph of its neighbours. */
export function ConceptView({
  store,
  params,
  openSource,
  openNode,
  ...navigation
}: ConceptsViewProps) {
  const id = params.id ?? "";
  return (
    <ConceptsProvider store={store} context={{ openSource, openNode }} navigation={navigation}>
      <ConceptPageScreen id={id} />
    </ConceptsProvider>
  );
}

function ConceptPageScreen({ id }: { id: string }) {
  const { store, openIndex } = useConcepts();
  const page = useAsync(() => store.page(id), id);
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 md:px-8 md:pt-8"
      data-testid="concept-view"
    >
      <button
        type="button"
        onClick={openIndex}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl pr-3 text-sm font-medium text-text-muted hover:text-text"
      >
        <ArrowLeft size={16} aria-hidden /> All concepts
      </button>
      {page.status === "loading" ? (
        <div role="status" aria-label="Loading concept" className="grid gap-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-64" />
        </div>
      ) : page.status === "error" ? (
        <ErrorState error={page.error} onRetry={page.reload} />
      ) : (
        <PageBody data={page.data} reload={page.reload} />
      )}
    </div>
  );
}

function PageBody({ data, reload }: { data: ConceptPage; reload: () => void }) {
  const statuses = useMemo(
    () =>
      new Map<string, CitationStatus>(data.sources.map((s) => [citationKey(s.citation), s.status])),
    [data.sources],
  );
  const sections = relationSections(data.groups);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start xl:gap-6">
      <div className="grid min-w-0 gap-4">
        <Header data={data} statuses={statuses} reload={reload} />
        {data.suggestions.length > 0 ? <MergeSuggestions data={data} reload={reload} /> : null}
        {sections.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">No relations have been filed for this yet.</p>
          </Card>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2" data-testid="relations">
            {sections.map((s) => (
              <Card key={s.key} className={cn(s.type === "interacts_with" && "md:col-span-2")}>
                <h2 className="font-display text-base font-semibold" data-testid="relation-title">
                  {s.title}
                </h2>
                <p className="mb-2 text-xs text-text-muted">
                  {pluralise(s.group.items.length, "concept")} · this concept {s.group.label}
                </p>
                <ul className="grid gap-2">
                  {s.group.items.map((item) => (
                    <RelationRow key={item.relation.id} item={item} statuses={statuses} />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
        <Neighbourhood conceptId={data.concept.id} />
      </div>
      <AppearsIn data={data} statuses={statuses} />
    </div>
  );
}

function nameCheckLine(check: NameCheck | undefined) {
  if (!check) return null;
  switch (check.status) {
    case "matched":
      return { icon: <BadgeCheck size={14} aria-hidden />, text: "Name matches the drug database" };
    case "suggestion":
      return {
        icon: <CircleHelp size={14} aria-hidden />,
        text: `Did you mean “${check.suggested}”?`,
      };
    case "unknown":
      return {
        icon: <CircleHelp size={14} aria-hidden />,
        text: "Name not found in the drug database",
      };
    default:
      return { icon: null, text: "Name not checked yet" };
  }
}

function Header({
  data,
  statuses,
  reload,
}: {
  data: ConceptPage;
  statuses: Map<string, CitationStatus>;
  reload: () => void;
}) {
  const { store } = useConcepts();
  const c = data.concept;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const check = nameCheckLine(c.drug?.nameCheck);
  const review = async (status: Concept["reviewStatus"]) => {
    setBusy(true);
    setError(null);
    try {
      await store.review(c.id, status);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={c.type} />
        {c.reviewStatus === "reviewed" ? (
          <Badge tone="accent">Reviewed by you</Badge>
        ) : (
          <Badge>Unverified</Badge>
        )}
        {c.generalKnowledge ? <Badge>Not from your notes</Badge> : null}
      </div>
      <div>
        <h1
          className="font-display text-2xl font-semibold leading-tight md:text-3xl"
          data-testid="concept-name"
        >
          {c.name}
        </h1>
        {c.aliases.length > 0 ? (
          <p className="mt-1 text-sm text-text-muted">Also called {c.aliases.join(", ")}</p>
        ) : null}
        {data.redirectedFrom ? (
          <p className="mt-1 text-sm text-text-muted">
            This is where an older, merged entry now lives.
          </p>
        ) : null}
      </div>
      {c.drug ? (
        <div className="grid gap-1.5 text-sm">
          {c.drug.genericName && c.drug.genericName.toLowerCase() !== c.name.toLowerCase() ? (
            <p>
              <span className="text-text-muted">Generic name </span>
              {c.drug.genericName}
            </p>
          ) : null}
          {c.drug.brandNames.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-text-muted">Brand names</span>
              {c.drug.brandNames.map((b) => (
                <span
                  key={b}
                  className="rounded-full bg-surface-muted px-2.5 py-0.5 font-medium"
                  data-testid="brand-name"
                >
                  {b}
                </span>
              ))}
            </p>
          ) : null}
          {check ? (
            <p
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                c.drug.nameCheck.status === "suggestion"
                  ? "text-(--cx-amber-fg)"
                  : "text-text-muted",
              )}
              data-testid="name-check"
              data-status={c.drug.nameCheck.status}
            >
              {check.icon}
              {check.text}
            </p>
          ) : null}
        </div>
      ) : null}
      {c.summary.length > 0 ? (
        <RichSummary text={c.summary} citations={c.citations} statuses={statuses} />
      ) : (
        <p className="text-sm text-text-muted">No summary yet.</p>
      )}
      {c.citations.length > 0 && !c.summary.some((s) => "cite" in s) ? (
        <CiteList citations={c.citations} statuses={statuses} />
      ) : null}
      {c.generalKnowledge ? (
        <p className="rounded-2xl bg-surface-muted px-3.5 py-2.5 text-sm text-text-muted">
          This comes from general knowledge, not from your notes, so it has no source to open.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {describeError(error).message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {c.reviewStatus === "unverified" ? (
          <Button variant="primary" disabled={busy} onClick={() => review("reviewed")}>
            <BadgeCheck size={16} aria-hidden /> Mark reviewed
          </Button>
        ) : (
          <Button disabled={busy} onClick={() => review("unverified")}>
            Mark as unverified
          </Button>
        )}
        <AskButton
          target={{ type: "library" }}
          targetLabel={c.name}
          submit={store.createRequest}
          defaultMessage={`About the concept "${c.name}": `}
          label="Ask about this"
        />
      </div>
    </Card>
  );
}

function RelationRow({
  item,
  statuses,
}: {
  item: RelationGroupItem;
  statuses: Map<string, CitationStatus>;
}) {
  const { relation: r, concept } = item;
  return (
    <li className="rounded-2xl border border-border bg-bg px-3.5 py-3" data-testid="relation-item">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ConceptLink id={concept.id}>{concept.name}</ConceptLink>
        <TypeBadge type={concept.type} />
        {r.interaction ? (
          <span
            className={cn(
              "inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold",
              r.interaction.severity === "major" || r.interaction.severity === "contraindicated"
                ? "bg-(--cx-red-bg) text-(--cx-red-fg)"
                : r.interaction.severity === "moderate"
                  ? "bg-(--cx-amber-bg) text-(--cx-amber-fg)"
                  : "bg-(--cx-grey-bg) text-(--cx-grey-fg)",
            )}
            data-testid="severity"
          >
            {SEVERITY_LABEL[r.interaction.severity]}
          </span>
        ) : null}
      </div>
      {r.interaction ? <p className="mt-1 text-sm text-text">{r.interaction.effect}</p> : null}
      {r.note ? <p className="mt-1 text-sm text-text-muted">{r.note}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {r.citations.length > 0 ? (
          <CiteList citations={r.citations} statuses={statuses} />
        ) : r.generalKnowledge ? (
          <span className="text-xs text-text-muted">Not from your notes</span>
        ) : null}
      </div>
    </li>
  );
}

function MergeSuggestions({ data, reload }: { data: ConceptPage; reload: () => void }) {
  const { store, openConcept } = useConcepts();
  const [pending, setPending] = useState<ConceptPage["suggestions"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Card className="border-(--cx-amber-fg)/30 bg-(--cx-amber-bg)">
      <h2 className="flex items-center gap-2 font-display text-base font-semibold text-(--cx-amber-fg)">
        <Sparkles size={16} aria-hidden /> Might be the same thing
      </h2>
      <ul className="mt-2 grid gap-3">
        {data.suggestions.map((s) => (
          <li key={s.conceptId} className="grid gap-2" data-testid="merge-suggestion">
            <p className="text-sm text-text">
              <strong>{s.name}</strong>. {s.explanation}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => openConcept(s.conceptId)}>Open {s.name}</Button>
              <Button onClick={() => setPending(s)}>Merge into this concept</Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {describeError(error).message}
        </p>
      ) : null}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? `Merge ${pending.name} into ${data.concept.name}?` : "Merge"}
        description="Names, brand names, sources and links are kept on this concept, and the other entry leads here. Nothing is deleted from your notes."
        confirmLabel="Merge"
        busy={busy}
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          setError(null);
          try {
            await store.merge(data.concept.id, pending.conceptId);
            setPending(null);
            reload();
          } catch (e) {
            setError(e);
            setPending(null);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

function AppearsIn({
  data,
  statuses,
}: {
  data: ConceptPage;
  statuses: Map<string, CitationStatus>;
}) {
  const { openDocument, openQuestion } = useConcepts();
  const unique = new Map<string, ConceptPage["sources"][number]>();
  for (const s of data.sources)
    if (!unique.has(citationKey(s.citation))) unique.set(citationKey(s.citation), s);
  const sources = [...unique.values()];
  const nothing = data.mentions.length === 0 && data.questions.length === 0 && sources.length === 0;
  return (
    <aside aria-label="Appears in" className="grid min-w-0 gap-4">
      <Card>
        <h2 className="font-display text-base font-semibold">Appears in</h2>
        {nothing ? (
          <div className="mt-2">
            <EmptyState icon={<FileText size={22} />} title="Not in your notes yet">
              Pages, questions and sources that mention this will show up here.
            </EmptyState>
          </div>
        ) : null}
        {data.mentions.length > 0 ? (
          <div className="mt-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <FileText size={13} aria-hidden /> Notes
            </h3>
            <ul className="grid gap-1.5">
              {data.mentions.map((m) => (
                <li key={`${m.documentId}${m.blockId}`}>
                  <button
                    type="button"
                    data-testid="mention"
                    disabled={m.trashed || !m.nodeId}
                    onClick={() =>
                      m.nodeId && openDocument({ nodeId: m.nodeId, blockId: m.blockId })
                    }
                    className="w-full rounded-2xl border border-border bg-bg px-3.5 py-2.5 text-left hover:border-accent disabled:opacity-60"
                  >
                    <span className="block text-sm font-medium">{m.title}</span>
                    <span className="mt-0.5 block text-sm text-text-muted">
                      {m.trashed ? "In the trash. " : ""}
                      {m.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data.questions.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <ListChecks size={13} aria-hidden /> Practice questions
            </h3>
            <ul className="grid gap-1.5">
              {data.questions.map((q) => (
                <li key={q.questionId}>
                  <button
                    type="button"
                    data-testid="question-link"
                    onClick={() => openQuestion({ questionId: q.questionId, nodeId: q.nodeId })}
                    className="w-full rounded-2xl border border-border bg-bg px-3.5 py-2.5 text-left text-sm hover:border-accent"
                  >
                    {q.stem}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {sources.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
              <ScrollText size={13} aria-hidden /> Source pages
            </h3>
            <ul className="grid gap-1.5">
              {sources.map((s) => (
                <li
                  key={citationKey(s.citation)}
                  className="rounded-2xl border border-border bg-bg px-3.5 py-2.5"
                  data-testid="source-row"
                >
                  <p className="text-sm font-medium">
                    {s.fileName ?? "Deleted file"}
                    {s.pageIndex ? `, page ${s.pageIndex}` : ""}
                  </p>
                  <p className="mt-0.5 text-sm text-text-muted">“{s.citation.quote}”</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <CiteChip
                      citation={s.citation as Citation}
                      status={statuses.get(citationKey(s.citation))}
                    />
                    {s.supports.kind === "relation" ? s.supports.sentence : "Supports this concept"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </aside>
  );
}
