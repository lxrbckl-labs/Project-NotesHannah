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
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Notice } from "../../components/ui/notice";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/states";
import { describeError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { SEVERITY_HUE } from "../../lib/roles";
import { ExternalLink } from "../references/ExternalLink";
import { pharmGuidesSearch } from "../references/registry";
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
        className="nav-back mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-control pr-3 text-ui font-medium text-text-muted hover:text-text"
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
            <p className="text-ui text-text-muted">No relations have been filed for this yet.</p>
          </Card>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2" data-testid="relations">
            {sections.map((s) => (
              <Card key={s.key} className={cn(s.type === "interacts_with" && "md:col-span-2")}>
                <h2 className="font-display text-body font-semibold" data-testid="relation-title">
                  {s.title}
                </h2>
                <p className="mb-2 text-caption text-text-muted">
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
          className="font-display text-heading font-semibold leading-tight md:text-display"
          data-testid="concept-name"
        >
          {c.name}
        </h1>
        {c.aliases.length > 0 ? (
          <p className="mt-1 text-ui text-text-muted">Also called {c.aliases.join(", ")}</p>
        ) : null}
        {data.redirectedFrom ? (
          <p className="mt-1 text-ui text-text-muted">
            This is where an older, merged entry now lives.
          </p>
        ) : null}
      </div>
      {c.drug ? (
        <div className="grid gap-1.5 text-ui">
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
                  className="rounded-pill bg-surface-muted px-2.5 py-0.5 font-medium"
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
                "inline-flex items-center gap-1.5 text-caption",
                c.drug.nameCheck.status === "suggestion" ? "text-warning" : "text-text-muted",
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
        <p className="text-ui text-text-muted">No summary yet.</p>
      )}
      {c.citations.length > 0 && !c.summary.some((s) => "cite" in s) ? (
        <CiteList citations={c.citations} statuses={statuses} />
      ) : null}
      {c.generalKnowledge ? (
        <p className="rounded-card bg-surface-muted px-3.5 py-2.5 text-ui text-text-muted">
          This comes from general knowledge, not from your notes, so it has no source to open.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui text-danger">
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
      <p className="text-ui">
        <ExternalLink
          href={pharmGuidesSearch(c.name)}
          data-testid="pharmguides-lookup"
          className="text-text-muted underline underline-offset-2 hover:text-accent"
        >
          Look up on PharmGuides
        </ExternalLink>
      </p>
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
    <li className="rounded-card border border-border bg-bg px-3.5 py-3" data-testid="relation-item">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ConceptLink id={concept.id}>{concept.name}</ConceptLink>
        <TypeBadge type={concept.type} />
        {r.interaction ? (
          <span data-testid="severity">
            <Badge hue={SEVERITY_HUE[r.interaction.severity]} className="font-semibold">
              {SEVERITY_LABEL[r.interaction.severity]}
            </Badge>
          </span>
        ) : null}
      </div>
      {r.interaction ? <p className="mt-1 text-ui text-text">{r.interaction.effect}</p> : null}
      {r.note ? <p className="mt-1 text-ui text-text-muted">{r.note}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {r.citations.length > 0 ? (
          <CiteList citations={r.citations} statuses={statuses} />
        ) : r.generalKnowledge ? (
          <span className="text-caption text-text-muted">Not from your notes</span>
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
    <Notice
      tone="warning"
      icon={<Sparkles size={18} />}
      title="Might be the same thing"
      className="p-4 md:p-5"
    >
      <ul className="mt-2 grid gap-3">
        {data.suggestions.map((s) => (
          <li key={s.conceptId} className="grid gap-2" data-testid="merge-suggestion">
            <p className="text-ui text-text">
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
        <p role="alert" className="mt-2 text-ui text-danger">
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
    </Notice>
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
        <h2 className="font-display text-body font-semibold">Appears in</h2>
        {nothing ? (
          <div className="mt-2">
            <EmptyState icon={<FileText size={22} />} title="Not in your notes yet">
              Pages, questions and sources that mention this will show up here.
            </EmptyState>
          </div>
        ) : null}
        {data.mentions.length > 0 ? (
          <div className="mt-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-text-muted">
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
                    className="w-full rounded-card border border-border bg-bg px-3.5 py-2.5 text-left hover:border-accent disabled:opacity-60"
                  >
                    <span className="block text-ui font-medium">{m.title}</span>
                    <span className="mt-0.5 block text-ui text-text-muted">
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
            <h3 className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-text-muted">
              <ListChecks size={13} aria-hidden /> Practice questions
            </h3>
            <ul className="grid gap-1.5">
              {data.questions.map((q) => (
                <li key={q.questionId}>
                  <button
                    type="button"
                    data-testid="question-link"
                    onClick={() => openQuestion({ questionId: q.questionId, nodeId: q.nodeId })}
                    className="w-full rounded-card border border-border bg-bg px-3.5 py-2.5 text-left text-ui hover:border-accent"
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
            <h3 className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-text-muted">
              <ScrollText size={13} aria-hidden /> Source pages
            </h3>
            <ul className="grid gap-1.5">
              {sources.map((s) => (
                <li
                  key={citationKey(s.citation)}
                  className="rounded-card border border-border bg-bg px-3.5 py-2.5"
                  data-testid="source-row"
                >
                  <p className="text-ui font-medium">
                    {s.fileName ?? "Deleted file"}
                    {s.pageIndex ? `, page ${s.pageIndex}` : ""}
                  </p>
                  <p className="mt-0.5 text-ui text-text-muted">“{s.citation.quote}”</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-text-muted">
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
