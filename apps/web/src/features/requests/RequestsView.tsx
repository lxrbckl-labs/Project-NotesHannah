import { MessageCirclePlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HeaderArt } from "../../components/art/pills";
import { Chip } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { PageHeader } from "../../components/ui/page-header";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { describeError } from "../../lib/api";
import { REQUEST_STATUS_HUE } from "../../lib/roles";
import {
  baselineSeen,
  FILTER_LABEL,
  type Filter,
  isUnread,
  markSeen,
  readSeen,
  STATUS_ORDER,
} from "./model/wording";
import { RequestCard } from "./RequestCard";
import { RequestComposer } from "./RequestComposer";
import type { RequestsViewProps, StudyRequestWithContext } from "./types";
import { RequestsProvider, useRequestsEnv } from "./ui/context";
import { CancelDialog, EditRequestDialog, ReopenDialog } from "./ui/dialogs";
import { useRequests } from "./ui/hooks";

const FILTERS: Filter[] = ["all", ...STATUS_ORDER];

/** Her requests, newest first, with filters by status and the actions she may take. */
export function RequestsView({
  store,
  openSource,
  openNode,
  onOpenDocument,
  onOpenQuestion,
  onOpenConcept,
}: RequestsViewProps) {
  return (
    <RequestsProvider
      store={store}
      context={{ openSource, openNode }}
      navigation={{
        ...(onOpenDocument ? { onOpenDocument } : {}),
        ...(onOpenQuestion ? { onOpenQuestion } : {}),
        ...(onOpenConcept ? { onOpenConcept } : {}),
      }}
    >
      <Screen />
    </RequestsProvider>
  );
}

function Screen() {
  const { store } = useRequestsEnv();
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { items, counts, error, refresh } = useRequests(store, filter);
  const [seen, setSeen] = useState(() => readSeen());
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<StudyRequestWithContext | null>(null);
  const [cancelling, setCancelling] = useState<StudyRequestWithContext | null>(null);
  const [reopening, setReopening] = useState<StudyRequestWithContext | null>(null);

  // What she has looked at is kept after the list is on screen, so "new" shows once per answer.
  const [unreadNow, setUnreadNow] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!items) return;
    if (
      baselineSeen(
        items.filter((r) => r.status === "done" || r.status === "declined").map((r) => r.id),
      )
    ) {
      setSeen(readSeen());
      window.dispatchEvent(new Event("notes-requests-seen"));
      return;
    }
    const fresh = items.filter((r) => isUnread(r, seen)).map((r) => r.id);
    if (fresh.length === 0) return;
    setUnreadNow((prev) => new Set([...prev, ...fresh]));
    setSeen(markSeen(fresh));
    window.dispatchEvent(new Event("notes-requests-seen"));
  }, [items, seen]);

  useEffect(() => {
    if (!notice || notice.bad) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const actions = useMemo(
    () => ({ onEdit: setEditing, onCancel: setCancelling, onReopen: setReopening }),
    [],
  );

  async function run(work: () => Promise<unknown>, done: string) {
    try {
      await work();
      setNotice({ text: done, bad: false });
      await refresh();
    } catch (caught) {
      const { message, hint } = describeError(caught);
      setNotice({ text: `${message}${hint ? ` ${hint}` : ""}`, bad: true });
      await refresh();
      throw caught;
    }
  }

  const total = counts ? counts.waiting + counts.in_progress + counts.done + counts.declined : null;
  const countFor = (f: Filter) => (!counts ? null : f === "all" ? total : counts[f]);

  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 md:px-8 md:pt-8"
      data-testid="requests"
    >
      <PageHeader
        art={<HeaderArt kind="requests" />}
        title="Requests"
        description="Notes you leave for an agent: fix this, explain that, make questions."
        className="mb-4"
        actions={
          <Button variant="primary" data-testid="new-request" onClick={() => setComposing(true)}>
            <MessageCirclePlus size={17} aria-hidden /> New request
          </Button>
        }
      />

      {notice ? (
        <div
          role={notice.bad ? undefined : "status"}
          data-testid="notice"
          className="mt-3 max-w-2xl"
        >
          <Notice tone={notice.bad ? "danger" : "neutral"} icon={notice.bad ? undefined : null}>
            {notice.text}
          </Notice>
        </div>
      ) : null}

      <div className="mt-5 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:gap-8">
        <nav
          aria-label="Filter requests by status"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 py-2.5 md:-mx-8 md:px-8 xl:sticky xl:top-6 xl:mx-0 xl:flex-col xl:self-start xl:overflow-visible xl:px-0 xl:py-0"
        >
          {FILTERS.map((f) => {
            const n = countFor(f);
            return (
              <Chip
                key={f}
                hue={f === "all" ? undefined : REQUEST_STATUS_HUE[f]}
                pressed={filter === f}
                data-testid={`filter-${f}`}
                onClick={() => setFilter(f)}
                className="shrink-0 xl:w-full xl:justify-between"
              >
                <span>{f === "all" ? "All" : FILTER_LABEL[f]}</span>
                {n !== null ? (
                  <>
                    {" "}
                    <span className="ml-1 tabular-nums opacity-80">{n}</span>
                  </>
                ) : null}
              </Chip>
            );
          })}
        </nav>

        <div className="mt-3 min-w-0 xl:mt-0" aria-live="polite">
          {error && !items ? (
            <ErrorState error={error} onRetry={() => void refresh()} />
          ) : !items ? (
            <LoadingList rows={4} label="Loading your requests" />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<MessageCirclePlus size={26} aria-hidden />}
              title={filter === "all" ? "No requests yet" : "Nothing here"}
              action={
                filter === "all" ? (
                  <Button variant="primary" onClick={() => setComposing(true)}>
                    Leave your first request
                  </Button>
                ) : (
                  <Button onClick={() => setFilter("all")}>Show everything</Button>
                )
              }
            >
              {filter === "all"
                ? "When something in your notes is wrong, unclear or missing, leave a request. You can also do it from any page with the Ask button."
                : "No requests are in this state."}
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3.5" data-testid="request-list">
              {items.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  unread={unreadNow.has(request.id)}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <RequestComposer
        open={composing}
        onOpenChange={setComposing}
        target={{ type: "library" }}
        targetLabel="your whole library"
        submit={async (input) => {
          const created = await store.create(input);
          void refresh();
          return created;
        }}
      />
      <EditRequestDialog
        request={editing}
        onClose={() => setEditing(null)}
        onSave={(id, change) =>
          run(() => store.update(id, change), "Request updated.").then(() => setEditing(null))
        }
      />
      <ReopenDialog
        request={reopening}
        onClose={() => setReopening(null)}
        onReopen={(id, note) =>
          run(() => store.reopen(id, note), "Reopened. It is waiting for an agent again.").then(
            () => setReopening(null),
          )
        }
      />
      <CancelDialog
        request={cancelling}
        onClose={() => setCancelling(null)}
        onCancel={async (id) => {
          setCancelling(null);
          await run(() => store.cancel(id), "Request canceled.").catch(() => undefined);
        }}
      />
    </div>
  );
}
