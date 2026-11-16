import type { NodeWithLinks } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronsDownUp, ChevronsUpDown, Plus, Star, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Page, SectionTitle } from "../../components/Page";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { useMe } from "../auth/useAuth";
import { UpcomingExamsCard } from "../exams";
import { useStores } from "../mounts/services";
import { UploadButton } from "../uploads/UploadButton";
import { useLibraryDialogs } from "./dialogs";
import { LibraryTree } from "./LibraryTree";
import { NodeIcon } from "./NodeIcon";
import { nodeTitle } from "./NodeRow";
import { childrenQuery, useChildren, useFavourites, useRecents } from "./queries";
import { nodeHref } from "./rules";
import { useTreeState } from "./treeState";

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Every folder-like node below the top, found level by level, so "expand all" can open them. */
async function allExpandable(client: ReturnType<typeof useQueryClient>): Promise<string[]> {
  const found: string[] = [];
  let level: Array<string | null> = [null];
  for (let depth = 0; depth < 8 && level.length > 0; depth++) {
    const lists = await Promise.all(
      level.map((id) => client.fetchQuery({ ...childrenQuery(id), staleTime: 10_000 })),
    );
    level = [];
    for (const node of lists.flat()) {
      if (node.kind === "document") continue;
      found.push(node.id);
      level.push(node.id);
    }
  }
  return found;
}

/** Restore the saved scroll once the rows have loaded; stop if the person scrolls first. */
function useScrollMemory(ready: boolean) {
  const tree = useTreeState();
  const restoring = useRef(false);

  // A layout effect, so the listener is gone before the next page replaces the content and
  // the browser clamps the scroll position.
  useLayoutEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    let frame = 0;
    const onScroll = () => {
      if (restoring.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => tree.saveScroll(main.scrollTop));
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", onScroll);
    };
  }, [tree]);

  useEffect(() => {
    const main = document.getElementById("main");
    const target = tree.getScroll();
    if (!ready || !main || target <= 0) return;
    restoring.current = true;
    let frame = 0;
    const started = performance.now();
    const stop = () => {
      restoring.current = false;
      cancelAnimationFrame(frame);
      for (const type of ["wheel", "touchstart", "keydown"]) main.removeEventListener(type, stop);
    };
    for (const type of ["wheel", "touchstart", "keydown"]) {
      main.addEventListener(type, stop, { passive: true });
    }
    const step = () => {
      main.scrollTop = target;
      const reached = Math.abs(main.scrollTop - target) < 2;
      if (reached || performance.now() - started > 2500) {
        // let the last scroll event pass before listening again
        setTimeout(stop, 50);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return stop;
  }, [ready, tree]);
}

export function LibraryHome() {
  const me = useMe();
  const client = useQueryClient();
  const terms = useChildren(null);
  const favourites = useFavourites();
  const recents = useRecents();
  const dialogs = useLibraryDialogs();
  const tree = useTreeState();
  const [busy, setBusy] = useState(false);

  const { seed } = tree;
  useEffect(() => {
    if (terms.data) seed(terms.data.map((t) => t.id));
  }, [terms.data, seed]);

  useScrollMemory(!!terms.data);

  async function expandAll() {
    setBusy(true);
    try {
      tree.expandMany(await allExpandable(client));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <header className="dot-grid mb-6 rounded-3xl border border-border bg-surface px-5 py-5 md:px-8 md:py-7">
        <p className="text-sm text-text-muted">{greeting()}</p>
        <h1 className="mt-0.5 text-3xl font-semibold">
          {me.data ? `Hello, ${me.data.displayName}` : "Library"}
        </h1>
        <p className="mt-1.5 text-sm text-text-muted">
          All your terms, courses, lectures and files, in one tree.
        </p>
      </header>

      <section aria-labelledby="tree-title" className="mb-10">
        <SectionTitle
          action={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button onClick={expandAll} disabled={busy} aria-label="Expand all">
                <ChevronsUpDown size={16} aria-hidden />
                <span className="hidden sm:inline">Expand all</span>
              </Button>
              <Button onClick={() => tree.collapseAll()} aria-label="Collapse all">
                <ChevronsDownUp size={16} aria-hidden />
                <span className="hidden sm:inline">Collapse all</span>
              </Button>
              <UploadButton nodeId={null} target="the inbox" variant="secondary">
                <span className="hidden sm:inline">Upload</span>
              </UploadButton>
              <Button onClick={() => dialogs.openCreate(null, "term")} aria-label="New term">
                <Plus size={16} aria-hidden />
                <span className="hidden sm:inline">New term</span>
              </Button>
            </div>
          }
        >
          <span id="tree-title" className="whitespace-nowrap">
            All files
          </span>
        </SectionTitle>
        <div className="rounded-3xl border border-border bg-surface p-2 shadow-card md:p-3">
          {terms.isPending ? (
            <LoadingList rows={4} label="Loading library" />
          ) : terms.isError ? (
            <ErrorState error={terms.error} onRetry={() => terms.refetch()} />
          ) : terms.data.length === 0 ? (
            <EmptyState
              icon={<CalendarRange size={26} />}
              title="Start with a term"
              action={
                <Button variant="primary" onClick={() => dialogs.openCreate(null, "term")}>
                  New term
                </Button>
              }
            >
              A term holds your courses, like Fall 2026.
            </EmptyState>
          ) : (
            <LibraryTree label="All files" variant="page" withInbox />
          )}
        </div>
      </section>

      {import.meta.env.VITE_MOCK_API === "1" ? null : <ExamsStrip />}

      <section aria-labelledby="favourites-title" className="mb-8">
        <SectionTitle>
          <span id="favourites-title">Favourites</span>
        </SectionTitle>
        <ItemStrip
          query={favourites}
          empty="Star a course or lecture and it will wait for you here."
          icon={<Star size={18} />}
        />
      </section>

      <section aria-labelledby="recents-title" className="mb-8">
        <SectionTitle>
          <span id="recents-title">Recently opened</span>
        </SectionTitle>
        <ItemStrip
          query={recents}
          empty="Things you open show up here."
          icon={<CalendarRange size={18} />}
        />
      </section>

      <Link
        to="/trash"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-text-muted hover:bg-surface-muted hover:text-text"
      >
        <Trash2 size={16} aria-hidden /> Trash
      </Link>
    </Page>
  );
}

function ItemStrip({
  query,
  empty,
  icon,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data?: NodeWithLinks[];
    refetch: () => unknown;
  };
  empty: string;
  icon: ReactNode;
}) {
  if (query.isPending) return <LoadingList rows={1} label="Loading" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong px-4 py-4 text-sm text-text-muted">
        {icon}
        {empty}
      </p>
    );
  }
  return (
    <ul className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-3">
      {items.map((n) => (
        <li key={n.id} className="min-w-64 md:min-w-0">
          <Link
            to={nodeHref(n)}
            className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card hover:border-border-strong"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <NodeIcon kind={n.kind} section={n.section} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{nodeTitle(n)}</span>
              <span className="block truncate text-sm text-text-muted">{n.path}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The next few exams, with days remaining and how much she has reviewed (M2). */
function ExamsStrip() {
  const stores = useStores();
  const navigate = useNavigate();
  return (
    <section aria-label="Upcoming exams" className="mb-8">
      <UpcomingExamsCard
        api={stores.practice}
        onPractice={(examId) => navigate(`/practice?exam=${examId}`)}
        onOpenPlanner={() => navigate("/exams")}
      />
    </section>
  );
}
