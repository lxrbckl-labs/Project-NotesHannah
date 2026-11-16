import type { Revision, RevisionSummary } from "@notes/schema";
import { ArrowLeft, PenLine, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BlockContent } from "../blocks/registry";
import { ActionsContext, useActions, useView, ViewContext } from "../context";
import { buildReferenceIndex } from "../model/references";
import { formatWhen } from "../ui/hooks";
import { Button, ConfirmDialog, cx } from "../ui/primitives";

function who(revision: RevisionSummary): string {
  return revision.author.type === "user" ? "You" : (revision.author.label ?? "An agent");
}

/** Revision history (D12): who changed what and when, a preview, and restore. */
export function HistoryPanel({
  onRestored,
  compact,
}: {
  onRestored: (number: number) => void;
  compact: boolean;
}) {
  const actions = useActions();
  const view = useView();
  const [items, setItems] = useState<RevisionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<Revision | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = actions.docRef.current?.revision;

  useEffect(() => {
    let alive = true;
    actions.store.listRevisions(actions.documentId).then(
      (list) => {
        if (!alive) return;
        setItems(list);
        if (!compact && list[0]) setSelected(list[0].number);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [actions.store, actions.documentId, compact]);

  useEffect(() => {
    if (selected === null) return;
    let alive = true;
    setPreview(null);
    actions.store.getRevision(actions.documentId, selected).then(
      (r) => alive && setPreview(r),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [selected, actions.store, actions.documentId]);

  const previewView = useMemo(
    () =>
      preview
        ? {
            ...view,
            editing: false,
            refs: buildReferenceIndex(preview.snapshot.blocks),
            activeCitation: null,
          }
        : null,
    [preview, view],
  );
  const previewActions = useMemo(
    () => ({ ...actions, openCitation: () => {}, askAbout: () => {} }),
    [actions],
  );

  const restore = async () => {
    if (selected === null) return;
    setBusy(true);
    try {
      await actions.controller.restore(selected);
      onRestored(selected);
    } catch {
      actions.notify("The revision couldn’t be restored. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (failed)
    return <p className="p-5 text-sm text-[var(--doc-red-fg)]">History couldn’t be loaded.</p>;
  if (!items) return <p className="p-5 text-sm text-text-muted">Loading history…</p>;

  const list = (
    <ol
      className="m-0 flex list-none flex-col gap-1 p-2"
      aria-label="Revisions"
      data-testid="revision-list"
    >
      {items.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            aria-current={selected === r.number ? "true" : undefined}
            onClick={() => setSelected(r.number)}
            className={cx(
              "flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
              selected === r.number ? "bg-[var(--doc-blue-bg)]" : "hover:bg-surface-muted",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                r.author.type === "user"
                  ? "bg-[var(--doc-green-bg)] text-[var(--doc-green-fg)]"
                  : "bg-[var(--doc-purple-bg)] text-[var(--doc-purple-fg)]",
              )}
            >
              {r.author.type === "user" ? (
                <PenLine className="size-4" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-[14px] font-semibold">Revision {r.number}</span>
                {r.number === current && (
                  <span className="rounded-full bg-surface px-1.5 text-[11px] font-semibold text-text-muted">
                    current
                  </span>
                )}
              </span>
              <span className="block text-[13px] text-text-muted">
                {who(r)} · {formatWhen(r.createdAt)}
              </span>
              {r.summary && <span className="mt-0.5 block text-[13px]">{r.summary}</span>}
              {r.restoredFrom && (
                <span className="block text-[12px] text-text-muted">
                  Restored from revision {r.restoredFrom}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );

  const previewPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {compact && (
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <ArrowLeft className="size-4" /> All revisions
          </Button>
        )}
        <p className="m-0 min-w-0 flex-1 text-[13.5px] text-text-muted">
          {preview
            ? `Revision ${preview.number} · ${preview.snapshot.blocks.length} blocks`
            : "Loading…"}
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={!preview || preview.number === current || busy}
          onClick={() => setConfirm(true)}
          data-testid="restore-revision"
        >
          <RotateCcw className="size-3.5" /> Restore this version
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)] px-5 py-4"
        data-testid="revision-preview"
      >
        {preview && previewView && (
          <ActionsContext.Provider value={previewActions}>
            <ViewContext.Provider value={previewView}>
              <div className="pointer-events-none mx-auto max-w-[44rem] select-none">
                <h2 className="mb-4 text-xl font-bold">{preview.snapshot.title}</h2>
                {preview.snapshot.blocks.map((block) => (
                  <div key={block.id} className="my-3">
                    <BlockContent block={block} />
                  </div>
                ))}
              </div>
            </ViewContext.Provider>
          </ActionsContext.Provider>
        )}
      </div>
    </div>
  );

  return (
    <>
      {compact ? (
        selected === null ? (
          list
        ) : (
          <div className="flex h-[78dvh] flex-col">{previewPane}</div>
        )
      ) : (
        <div className="flex h-[min(78dvh,46rem)] min-h-0">
          <div className="w-72 shrink-0 overflow-y-auto border-r border-border">{list}</div>
          {previewPane}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Restore revision ${selected ?? ""}?`}
        body="The document will go back to this version. Nothing is lost: the current version stays in the history and can be restored again."
        confirmLabel="Restore"
        onConfirm={() => void restore()}
      />
    </>
  );
}
