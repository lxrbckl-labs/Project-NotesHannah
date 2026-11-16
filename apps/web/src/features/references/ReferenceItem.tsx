import { REFERENCE_KIND_LABEL, type SavedReference } from "@notes/schema";
import { MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Badge } from "../../components/ui/badge";
import { IconButton } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { ActionMenu } from "../../components/ui/menu";
import { useToast } from "../../components/ui/toast";
import { cn } from "../../lib/cn";
import { ExternalLink } from "./ExternalLink";
import { useReferenceMutations, useReferenceUse } from "./queries";
import { BUILT_IN_RESOURCES } from "./registry";

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One saved reference: the title opens the page; pin, edit and delete beside it. */
export function ReferenceItem({
  reference: r,
  onEdit,
  compact,
}: {
  reference: SavedReference;
  onEdit: (r: SavedReference) => void;
  /** In a lecture's strip: no places, no note. */
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const mutations = useReferenceMutations();
  const toast = useToast();
  const site = BUILT_IN_RESOURCES.find((s) => s.id === r.source);
  const places = r.places.filter((p) => !p.trashed);

  const pin = () =>
    mutations.update.mutate(
      { id: r.id, input: { favourite: !r.favourite } },
      { onError: (e) => toast.error(e) },
    );

  return (
    <li
      data-testid="reference-item"
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-card border border-border bg-surface",
        compact ? "px-3 py-2" : "px-3.5 py-3 shadow-card",
      )}
    >
      <div className="min-w-0 flex-1">
        <ExternalLink
          href={r.url}
          className="break-words font-medium text-text underline-offset-2 hover:text-accent hover:underline"
        >
          {r.title}
        </ExternalLink>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-text-muted">
          <span className="min-w-0 truncate">{hostOf(r.url)}</span>
          {r.kind ? <Badge size="sm">{REFERENCE_KIND_LABEL[r.kind]}</Badge> : null}
          {site ? (
            <Badge size="sm" tone="info">
              From {site.name}
            </Badge>
          ) : null}
          {r.favourite ? (
            <Badge size="sm" tone="accent" icon={<Pin />}>
              Pinned
            </Badge>
          ) : null}
        </div>
        {!compact && r.note ? (
          <p className="mt-1.5 whitespace-pre-line break-words text-ui">{r.note}</p>
        ) : null}
        {!compact && places.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Where ${r.title} belongs`}>
            {places.map((p) => (
              <li key={p.nodeId} className="min-w-0 max-w-full">
                <Link
                  to={`/library/${p.nodeId}`}
                  title={p.path}
                  className="hit-area inline-flex max-w-full items-center rounded-pill border border-border bg-bg px-2.5 py-0.5 text-label hover:bg-surface-muted"
                >
                  <span className="truncate">{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {!compact ? <UsedIn id={r.id} title={r.title} /> : null}
      </div>
      <IconButton
        size="sm"
        pressed={r.favourite}
        label={r.favourite ? `Unpin ${r.title}` : `Pin ${r.title}`}
        onClick={pin}
      >
        <Pin size={16} />
      </IconButton>
      <ActionMenu
        trigger={
          <IconButton size="sm" label={`Actions for ${r.title}`}>
            <MoreHorizontal size={18} />
          </IconButton>
        }
        entries={[
          { type: "item", label: "Edit", icon: <Pencil size={16} />, onSelect: () => onEdit(r) },
          { type: "separator" },
          {
            type: "item",
            label: "Delete",
            icon: <Trash2 size={16} />,
            danger: true,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete this reference?"
        description={`"${r.title}" leaves your saved references. The page itself and your library are not touched.`}
        confirmLabel="Delete"
        danger
        busy={mutations.remove.isPending}
        onConfirm={() =>
          mutations.remove.mutate(r.id, {
            onSuccess: () => {
              setConfirming(false);
              toast.show("Reference deleted");
            },
            onError: (e) => toast.error(e),
          })
        }
      />
    </li>
  );
}

/** Which of her notes draw on this reference: a back-link to each, loaded when she asks. */
function UsedIn({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const used = useReferenceUse(id, open);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="hit-area rounded-inline text-caption font-medium text-text-muted underline-offset-2 hover:text-text hover:underline"
      >
        {open ? "Hide where it is used" : "Where it is used"}
      </button>
      {open ? (
        used.isPending ? (
          <p className="text-caption text-text-muted">Looking…</p>
        ) : used.isError ? (
          <p className="text-caption text-danger">Could not load.</p>
        ) : used.data.length === 0 ? (
          <p className="text-caption text-text-muted">Not used in your notes yet.</p>
        ) : (
          <ul className="mt-1 grid gap-1" aria-label={`Notes that use ${title}`}>
            {used.data.map((u) => (
              <li key={u.blockId}>
                <Link
                  to={`/doc/${u.nodeId}?block=${u.blockId}`}
                  className="text-ui text-accent underline-offset-2 hover:underline"
                >
                  {u.documentTitle}
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
