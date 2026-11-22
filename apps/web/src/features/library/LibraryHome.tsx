import type { NodeWithLinks } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  History,
  Lightbulb,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useBadges } from "../../app/badges";
import { PillCluster } from "../../components/art/pills";
import { Page, SectionTitle } from "../../components/Page";
import { ActionBar, ActionButton, ActionDivider, ActionLink } from "../../components/ui/action-bar";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { UpcomingExamsCard } from "../exams";
import { useStores } from "../mounts/services";
import { PageFileDrop } from "../uploads/PageFileDrop";
import { useUploadPicker } from "../uploads/UploadProvider";
import { useCourseHue } from "./courseHue";
import { useLibraryDialogs } from "./dialogs";
import { LibraryTree } from "./LibraryTree";
import { NodeTile } from "./NodeIcon";
import { nodeTitle } from "./NodeRow";
import { childrenQuery, useChildren, useFavourites, useRecents } from "./queries";
import { nodeHref } from "./rules";
import { useTreeState } from "./treeState";

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
  const client = useQueryClient();
  const terms = useChildren(null);
  const favourites = useFavourites();
  const recents = useRecents();
  const dialogs = useLibraryDialogs();
  const pick = useUploadPicker();
  const tree = useTreeState();
  const [busy, setBusy] = useState(false);
  const badges = useBadges();

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
      {/* Files dropped on the library home go to the inbox, like its Upload files button. */}
      <PageFileDrop target={{ nodeId: null, label: "the inbox" }} />
      {/* No greeting card (Alex, 2026-11-16): the page opens on what she had open last. */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <h1 className="font-display text-heading font-semibold leading-tight md:text-display">
          Library
        </h1>
        <PillCluster className="-mb-1" />
      </div>

      <FoldSection id="recents" title="Recently Opened" className="mb-4">
        <ItemStrip
          query={recents}
          empty="Things you open show up here."
          icon={<History size={18} />}
        />
      </FoldSection>

      {/* Favorites, then Concepts and References, sit right under Recently Opened (Alex, 2026-11-21). */}
      <FoldSection id="favourites" title="Favorites" className="mb-1">
        <ItemStrip
          query={favourites}
          empty="Star a course or lecture and it will wait for you here."
          icon={<Star size={18} />}
        />
      </FoldSection>

      <div className="mb-10 flex flex-wrap gap-2">
        <Link to="/concepts" data-testid="home-concepts-link" className={buttonClass()}>
          <Lightbulb size={16} aria-hidden /> Concepts
          {badges.review > 0 ? (
            <Badge tone="warning" size="sm">
              {badges.review} to review
            </Badge>
          ) : null}
        </Link>
        <Link to="/references" data-testid="home-references-link" className={buttonClass()}>
          <BookMarked size={16} aria-hidden /> References
        </Link>
      </div>

      <section aria-labelledby="tree-title" className="mb-10">
        <SectionTitle
          action={
            <ActionBar label="Library actions" labels="never">
              <ActionButton
                icon={<ChevronsUpDown aria-hidden />}
                label="Expand all"
                onClick={expandAll}
                disabled={busy}
              />
              <ActionButton
                icon={<ChevronsDownUp aria-hidden />}
                label="Collapse all"
                onClick={() => tree.collapseAll()}
              />
              <ActionDivider />
              <ActionButton
                icon={<Upload aria-hidden />}
                label="Upload files"
                onClick={() => pick({ nodeId: null, label: "the inbox" })}
              />
              <ActionButton
                icon={<CalendarPlus aria-hidden />}
                label="New term"
                onClick={() => dialogs.openCreate(null, "term")}
              />
              <ActionDivider />
              <ActionLink to="/trash" icon={<Trash2 aria-hidden />} label="Trash" />
            </ActionBar>
          }
        >
          <span id="tree-title" className="whitespace-nowrap">
            All files
          </span>
        </SectionTitle>
        <Card padding="sm" className="p-2 md:p-3">
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
        </Card>
      </section>

      {import.meta.env.VITE_MOCK_API === "1" ? null : <ExamsStrip />}
    </Page>
  );
}

const FOLD_KEY = "notes-library-folded";

function readFolded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

/**
 * A home section whose heading folds it away: the arrow sits left of the title, as on the sidebars,
 * and each section's state is remembered on this device.
 */
function FoldSection({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => !readFolded()[id]);
  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFolded(), [id]: !next }));
    } catch {
      // Private window: the section still folds, it just is not remembered.
    }
  }
  return (
    <section aria-labelledby={`${id}-title`} className={className} data-testid={`fold-${id}`}>
      <h2 className="mb-2 text-base font-semibold text-text">
        <button
          type="button"
          id={`${id}-title`}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={toggle}
          className="-ml-1 flex items-center gap-1.5 rounded-control py-1 pl-1 pr-2 hover:bg-surface-muted"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={`shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
          />
          {title}
        </button>
      </h2>
      <div
        id={`${id}-body`}
        inert={!open}
        className={`-mx-3 grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          {/* The spare room keeps the cards' shadows from being cut while the section slides. */}
          <div className="px-3 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </section>
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
      <p className="flex items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface/55 px-4 py-4 backdrop-blur-md text-ui text-text-muted">
        {icon}
        {empty}
      </p>
    );
  }
  return (
    <ul className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-3">
      {items.map((n) => (
        <li key={n.id} className="min-w-64 md:min-w-0">
          <StripItem node={n} />
        </li>
      ))}
    </ul>
  );
}

function StripItem({ node }: { node: NodeWithLinks }) {
  const hue = useCourseHue(node);
  return (
    <Link to={nodeHref(node)} className="block rounded-card focus-visible:outline-offset-2">
      <Card padding="sm" interactive className="flex min-h-16 items-center gap-3">
        <NodeTile kind={node.kind} section={node.section} hue={hue} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{nodeTitle(node)}</span>
          <span className="block truncate text-ui text-text-muted">{node.path}</span>
        </span>
      </Card>
    </Link>
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
