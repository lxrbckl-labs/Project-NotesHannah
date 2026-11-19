import type { SavedReference } from "@notes/schema";
import { BookMarked, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/ui/button";
import { Sheet } from "../../components/ui/sheet";
import { ErrorState, Skeleton } from "../../components/ui/states";
import { useReferencesAt } from "./queries";
import { type FormPlace, type FormSubject, ReferenceForm } from "./ReferenceForm";
import { ReferenceItem } from "./ReferenceItem";

/** The kinds of library place that show the references tied to them. */
export const SHOWS_REFERENCES = new Set(["course", "folder", "lecture", "document"]);

/**
 * The references tied to a place (and, for a course or folder, to anything inside it), in a
 * compact strip, with "Add a reference here" which opens the form already tied to the place.
 */
export function ReferencesStrip({
  place,
  inSheet,
}: {
  place: FormPlace;
  /** Inside a sheet that already says "References": no heading of its own. */
  inSheet?: boolean;
}) {
  const query = useReferencesAt(place.nodeId);
  const [form, setForm] = useState<FormSubject | null>(null);
  const add = () => setForm({ mode: "new", places: [place] });
  return (
    <section
      aria-label="References"
      className={inSheet ? "" : "mb-6"}
      data-testid="references-strip"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {inSheet ? (
          <span />
        ) : (
          <h2 className="flex items-center gap-2 text-body font-semibold">
            <BookMarked size={18} aria-hidden className="text-text-muted" />
            References
          </h2>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            to="/references"
            className="hit-area rounded-inline px-2 py-1 text-ui text-text-muted hover:text-text"
          >
            All references
          </Link>
          <Button size="sm" onClick={add}>
            <Plus size={16} aria-hidden />
            Add a reference here
          </Button>
        </div>
      </div>
      <StripList query={query} onEdit={(reference) => setForm({ mode: "edit", reference })} />
      <ReferenceForm subject={form} onClose={() => setForm(null)} />
    </section>
  );
}

function StripList({
  query,
  onEdit,
}: {
  query: ReturnType<typeof useReferencesAt>;
  onEdit: (r: SavedReference) => void;
}) {
  if (query.isPending) return <Skeleton className="h-12" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border-strong bg-surface/55 px-4 py-3 backdrop-blur-md text-ui text-text-muted">
        No references tied here yet.
      </p>
    );
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2" aria-label="References tied here">
      {query.data.map((r) => (
        <ReferenceItem key={r.id} reference={r} onEdit={onEdit} compact />
      ))}
    </ul>
  );
}

/** For a document's own bar: a "References" button with the count, opening the strip in a sheet. */
export function ReferencesButton({ place }: { place: FormPlace }) {
  const query = useReferencesAt(place.nodeId);
  const [open, setOpen] = useState(false);
  const count = query.data?.length ?? 0;
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        aria-label={`References${count ? ` (${count})` : ""}`}
        data-testid="doc-references"
      >
        <BookMarked size={16} aria-hidden />
        <span className="hidden sm:inline">References</span>
        {count ? <span className="text-text-muted">{count}</span> : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="References" placement="side">
        <ReferencesStrip place={place} inSheet />
      </Sheet>
    </>
  );
}
