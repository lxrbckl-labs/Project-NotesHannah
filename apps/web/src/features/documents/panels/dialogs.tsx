import { useEffect, useState } from "react";
import { REQUEST_LABELS } from "../blocks/BlockShell";
import { useActions } from "../context";
import { type PageChoice, REQUEST_KINDS, type RequestKind } from "../store/types";
import type { Layout } from "../ui/hooks";
import { Button, cx, Sheet } from "../ui/primitives";

const HINTS: Record<RequestKind, string> = {
  wrong: "An agent will check it against your sources and correct it.",
  unclear: "An agent will rewrite it more plainly.",
  expand: "An agent will add more detail and examples.",
  make_questions: "An agent will write practice questions from it.",
};

/** "Ask about this" (L1, L5): a request about one block, sent through the store. */
export function RequestDialog({
  blockId,
  initialKind,
  onClose,
  layout,
}: {
  blockId: string | null;
  initialKind: RequestKind;
  onClose: () => void;
  layout: Layout;
}) {
  const actions = useActions();
  const [kind, setKind] = useState<RequestKind>(initialKind);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset for each block asked about
  useEffect(() => {
    setKind(initialKind);
    setNote("");
  }, [initialKind, blockId]);

  const send = async () => {
    if (!blockId) return;
    setSending(true);
    try {
      await actions.store.createRequest({
        documentId: actions.documentId,
        blockId: actions.controller.serverId(blockId),
        kind,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      actions.notify("Request sent. You’ll see the reply under Requests.", "success");
      onClose();
    } catch {
      actions.notify("The request couldn’t be sent. Try again.", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open={blockId !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Ask about this block"
      description="An agent picks this up from your requests."
      side={layout === "phone" ? "bottom" : "center"}
      testId="request-dialog"
    >
      <div className="flex flex-col gap-4 px-5 pb-5">
        <fieldset className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2">
          <legend className="sr-only">What do you need?</legend>
          {REQUEST_KINDS.map((k) => (
            <label
              key={k}
              className={cx(
                "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-[14px] transition-colors",
                kind === k
                  ? "border-[var(--doc-blue-solid)] bg-[var(--doc-blue-bg)] text-[var(--doc-blue-fg)]"
                  : "border-border hover:bg-surface-muted",
              )}
            >
              <input
                type="radio"
                name="request-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="accent-[var(--doc-blue-solid)]"
              />
              {REQUEST_LABELS[k]}
            </label>
          ))}
        </fieldset>
        <p className="m-0 -mt-1 text-[13px] text-text-muted">{HINTS[kind]}</p>
        <label className="flex flex-col gap-1.5 text-[13.5px] font-medium">
          Anything to add? (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={
              kind === "wrong" ? "e.g. the slide says 25 mg, not 50 mg" : "Your words for the agent"
            }
            className="resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-[15px] font-normal outline-none focus:border-[var(--doc-focus)]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void send()}
            disabled={sending}
            data-testid="send-request"
          >
            {sending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

/** Choose a page of her uploads for a new image or labelled image. */
export function PagePicker({
  open,
  onClose,
  onPick,
  layout,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (page: PageChoice) => void;
  layout: Layout;
}) {
  const { store } = useActions();
  const [pages, setPages] = useState<PageChoice[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    store.listPages().then(
      (list) => alive && setPages(list),
      () => alive && setPages([]),
    );
    return () => {
      alive = false;
    };
  }, [open, store]);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Choose a page"
      description="Pick one of your uploaded pages."
      side={layout === "phone" ? "bottom" : "center"}
      wide
    >
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 md:grid-cols-4">
        {pages === null && <p className="col-span-full text-sm text-text-muted">Loading pages…</p>}
        {pages?.length === 0 && (
          <p className="col-span-full text-sm text-text-muted">
            No pages yet. Upload a file first.
          </p>
        )}
        {pages?.map((page) => (
          <button
            key={page.pageId}
            type="button"
            onClick={() => onPick(page)}
            className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-2 text-left transition-colors hover:border-[var(--doc-focus)]"
          >
            <img
              src={page.thumbUrl}
              alt=""
              className="aspect-[4/3] w-full rounded-lg border border-border object-cover object-top"
            />
            <span className="truncate text-[12.5px] font-medium">{page.fileName}</span>
            <span className="text-[12px] text-text-muted">Page {page.pageIndex}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
