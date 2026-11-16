import {
  REFERENCE_KIND_LABEL,
  REFERENCE_KINDS,
  type ReferenceKind,
  type SavedReference,
} from "@notes/schema";
import {
  BookMarked,
  ExternalLink as ExternalIcon,
  Globe,
  Plus,
  Search,
  SearchX,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Page } from "../../components/Page";
import { Chip } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { inputClass } from "../../components/ui/field";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { cn } from "../../lib/cn";
import { ExternalLink } from "./ExternalLink";
import { useReferences } from "./queries";
import { type FormSubject, ReferenceForm } from "./ReferenceForm";
import { ReferenceItem } from "./ReferenceItem";
import { BUILT_IN_RESOURCES, type BuiltInResource } from "./registry";

export function ReferencesPage() {
  const [form, setForm] = useState<FormSubject | null>(null);
  return (
    <Page>
      <PageHeader
        title="References"
        icon={<BookMarked />}
        description="Outside guidelines and tools you rely on, and the pages you saved from them."
        actions={
          <Button variant="primary" onClick={() => setForm({ mode: "new" })}>
            <Plus size={16} aria-hidden />
            Save a reference
          </Button>
        }
      />
      <div className="grid gap-8">
        {BUILT_IN_RESOURCES.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} />
        ))}
        <SavedReferences
          onAdd={() => setForm({ mode: "new" })}
          onEdit={(reference) => setForm({ mode: "edit", reference })}
        />
      </div>
      <ReferenceForm subject={form} onClose={() => setForm(null)} />
    </Page>
  );
}

/** A built-in reference site: what it is, a search box that opens its search, its parts and topics. */
function ResourceCard({ resource: r }: { resource: BuiltInResource }) {
  const [words, setWords] = useState("");
  const id = `resource-${r.id}`;
  const search = r.searchUrl;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!search || !words.trim()) return;
    // A real new tab, as the parts' links open; noopener so the site cannot reach back.
    window.open(search(words), "_blank", "noopener,noreferrer");
  }

  return (
    <Card as="section" aria-labelledby={id} padding="lg" data-testid={`resource-${r.id}`}>
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden
          data-hue="teal"
          className="flex size-11 shrink-0 items-center justify-center rounded-card bg-tone-soft text-tone-text"
        >
          <Globe size={20} />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-title font-semibold">
            <ExternalLink href={r.home} className="hover:text-accent hover:underline">
              {r.name}
            </ExternalLink>
          </h2>
          <p className="mt-1 text-ui text-text-muted">{r.blurb}</p>
        </div>
      </div>

      {search ? (
        <form onSubmit={submit} aria-label={`Search ${r.name}`} className="mb-5">
          <label htmlFor={`${id}-q`} className="sr-only">
            Search {r.name}
          </label>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search
                size={18}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                id={`${id}-q`}
                type="search"
                enterKeyHint="search"
                placeholder={`Search ${r.name}`}
                value={words}
                onChange={(e) => setWords(e.target.value)}
                className={cn(inputClass, "pl-10")}
              />
            </div>
            <Button type="submit" variant="primary" disabled={!words.trim()}>
              Search
              <span className="sr-only"> (opens in a new tab)</span>
            </Button>
          </div>
        </form>
      ) : null}

      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Parts of ${r.name}`}>
        {r.parts.map((part) => (
          <li key={part.href} className="min-w-0">
            <ExternalLink
              href={part.href}
              icon={false}
              className="flex h-full min-h-16 flex-col rounded-card border border-border bg-bg px-3.5 py-3 transition-colors duration-(--duration-instant) hover:border-border-strong hover:bg-surface-muted"
            >
              <span className="flex items-center gap-1.5 font-medium">
                {part.label}
                <ExternalIcon size={12} aria-hidden className="shrink-0 text-text-muted" />
              </span>
              <span className="mt-0.5 text-ui text-text-muted">{part.blurb}</span>
            </ExternalLink>
          </li>
        ))}
      </ul>

      {search && r.topics.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 text-label font-semibold uppercase tracking-wide text-text-muted">
            Search by area
          </h3>
          <ul className="flex flex-wrap gap-2" aria-label={`Search ${r.name} by area`}>
            {r.topics.map((topic) => (
              <li key={topic} className="max-w-full">
                <ExternalLink
                  href={search(topic)}
                  icon={false}
                  className="hit-area inline-flex min-h-7 max-w-full items-center rounded-pill border border-border bg-surface px-3 text-label font-medium hover:bg-surface-muted"
                >
                  <span className="truncate">{topic}</span>
                </ExternalLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-5 text-caption text-text-muted">{r.notice}</p>
    </Card>
  );
}

/** Her own list: filter by words, kind and course; pinned first. */
function SavedReferences({
  onAdd,
  onEdit,
}: {
  onAdd: () => void;
  onEdit: (r: SavedReference) => void;
}) {
  const query = useReferences();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ReferenceKind | null>(null);
  const [course, setCourse] = useState<string | null>(null);

  const courses = useMemo(() => {
    const found = new Map<string, string>();
    for (const r of query.data ?? []) {
      for (const p of r.places) {
        if (p.courseId && p.courseName && !p.trashed) found.set(p.courseId, p.courseName);
      }
    }
    return [...found].sort((a, b) => a[1].localeCompare(b[1]));
  }, [query.data]);

  const shown = useMemo(() => {
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    return (query.data ?? []).filter(
      (r) =>
        (!kind || r.kind === kind) &&
        (!course || r.places.some((p) => p.courseId === course && !p.trashed)) &&
        words.every((w) => `${r.title} ${r.note} ${r.url}`.toLowerCase().includes(w)),
    );
  }, [query.data, text, kind, course]);

  const filtered = !!text.trim() || !!kind || !!course;

  return (
    <section aria-labelledby="saved-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="saved-title" className="text-title font-semibold">
          Your saved references
        </h2>
        <Button size="sm" onClick={onAdd}>
          <Plus size={16} aria-hidden />
          Add
        </Button>
      </div>
      {query.isPending ? (
        <LoadingList rows={2} label="Loading references" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={<BookMarked size={26} />}
          title="No saved references yet"
          action={
            <Button variant="primary" onClick={onAdd}>
              <Plus size={16} aria-hidden />
              Save a reference
            </Button>
          }
        >
          Found a guideline page you keep going back to? Paste its address here, add a note, and tie
          it to the lectures it belongs with.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 grid gap-3">
            <div className="relative">
              <Search
                size={18}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="search"
                aria-label="Filter your references"
                placeholder="Filter by title, note or address"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={cn(inputClass, "pl-10")}
              />
            </div>
            <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
              <legend className="sr-only">Kind</legend>
              <Chip pressed={kind === null} onClick={() => setKind(null)}>
                All kinds
              </Chip>
              {REFERENCE_KINDS.map((k) => (
                <Chip key={k} pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                  {REFERENCE_KIND_LABEL[k]}
                </Chip>
              ))}
            </fieldset>
            {courses.length > 0 ? (
              <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
                <legend className="sr-only">Course</legend>
                <Chip pressed={course === null} onClick={() => setCourse(null)}>
                  All courses
                </Chip>
                {courses.map(([id, name]) => (
                  <Chip
                    key={id}
                    pressed={course === id}
                    onClick={() => setCourse(course === id ? null : id)}
                  >
                    {name}
                  </Chip>
                ))}
              </fieldset>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <EmptyState icon={<SearchX size={26} />} title="Nothing matches" compact>
              {filtered ? (
                <button
                  type="button"
                  className={buttonClass({ size: "sm", className: "mt-2" })}
                  onClick={() => {
                    setText("");
                    setKind(null);
                    setCourse(null);
                  }}
                >
                  Clear the filters
                </button>
              ) : null}
            </EmptyState>
          ) : (
            <ul className="grid gap-2.5" aria-label="Your saved references">
              {shown.map((r) => (
                <ReferenceItem key={r.id} reference={r} onEdit={onEdit} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
