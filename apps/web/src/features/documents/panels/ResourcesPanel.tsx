import {
  attributionLabel,
  type Block,
  blockPlainText,
  type CitationStatus,
  citationKey,
  isBlockType,
  richTextToPlain,
} from "@notes/schema";
import { BookMarked, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/cn";
import { DOCUMENT_HUE } from "../../../lib/roles";
import { useActions, useSignal } from "../context";
import type { ReferenceIndex } from "../model/references";

/** One resource of one block: a numbered source of hers, or an outside reference. */
interface Entry {
  key: string;
  blockId: string;
  kind: "source" | "outside";
  number: number;
  label: string;
  detail: string;
  url: string | null;
  unavailable: boolean;
  /** The block's first words, so she knows which part of the page it belongs to. */
  context: string;
}

interface Group {
  key: string;
  headingId: string | null;
  title: string;
  entries: Entry[];
}

const words = (text: string, n = 70) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1).trimEnd()}…` : flat;
};

/** The document's resources by section, each entry anchored to the block that uses it. */
export function resourceGroups(
  blocks: readonly Block[],
  refs: ReferenceIndex,
  status: ReadonlyMap<string, CitationStatus>,
  names: ReadonlyMap<string, { fileName: string | null; pageIndex: number | null }>,
): Group[] {
  const sourcesOf = new Map<string, Array<ReferenceIndex["references"][number]>>();
  for (const ref of refs.references) {
    for (const use of ref.uses) {
      const list = sourcesOf.get(use.blockId) ?? [];
      if (!list.includes(ref)) list.push(ref);
      sourcesOf.set(use.blockId, list);
    }
  }
  const groups: Group[] = [{ key: "top", headingId: null, title: "Introduction", entries: [] }];
  for (const block of blocks) {
    if (block.type === "heading") {
      groups.push({
        key: block.id,
        headingId: block.id,
        title: richTextToPlain(block.content.text) || "Untitled section",
        entries: [],
      });
    }
    const group = groups[groups.length - 1] as Group;
    const context = words(isBlockType(block.type) ? blockPlainText(block) : "");
    for (const ref of sourcesOf.get(block.id) ?? []) {
      const key = citationKey(ref.citation);
      const meta = names.get(key);
      const state = status.get(key) ?? "available";
      group.entries.push({
        key: `${block.id}:${key}`,
        blockId: block.id,
        kind: "source",
        number: ref.number,
        label: ref.citation.label ?? `Source ${ref.number}`,
        detail:
          state === "source_trashed"
            ? "Source in the trash"
            : state === "source_deleted"
              ? "Source deleted"
              : [meta?.fileName, meta?.pageIndex ? `page ${meta.pageIndex}` : null]
                  .filter(Boolean)
                  .join(" · "),
        url: null,
        unavailable: state !== "available",
        context,
      });
    }
    for (const r of block.references ?? []) {
      let host = "";
      try {
        host = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {
        host = r.url;
      }
      group.entries.push({
        key: `${block.id}:${r.url}`,
        blockId: block.id,
        kind: "outside",
        number: 0,
        label: attributionLabel(r),
        detail: host,
        url: r.url,
        unavailable: false,
        context,
      });
    }
  }
  return groups.filter((g) => g.entries.length > 0);
}

/**
 * Resources, anchored to position (P2): the slide and page sources and the outside references of
 * the part of the document in view. Entries for blocks in view are highlighted and the current
 * section is open; the rest stay a tap away. Tapping an entry jumps to its block; its button opens
 * the source (the source panel) or the outside page (a new tab).
 */
export const ResourcesPanel = memo(function ResourcesPanel({
  blocks,
  refs,
  status,
  names,
  onJump,
}: {
  blocks: readonly Block[];
  refs: ReferenceIndex;
  status: ReadonlyMap<string, CitationStatus>;
  names: ReadonlyMap<string, { fileName: string | null; pageIndex: number | null }>;
  onJump: (blockId: string) => void;
}) {
  const actions = useActions();
  const groups = useMemo(
    () => resourceGroups(blocks, refs, status, names),
    [blocks, refs, status, names],
  );
  const reading = useSignal(actions.reading, (s) => s);
  const hovered = useSignal(actions.hovered, (id) => id);
  const inView = useMemo(() => new Set(reading.inView), [reading.inView]);
  // The current section: the group holding the block at the reading line, or the last one above it.
  const current = useMemo(() => {
    const at = reading.headingId;
    if (groups.some((g) => g.headingId === at)) return at === null ? "top" : at;
    return groups.find((g) => g.entries.some((e) => inView.has(e.blockId)))?.key ?? null;
  }, [groups, reading.headingId, inView]);
  // Sections she opened or shut by hand, until she scrolls to another section.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLDivElement>(null);
  const pointerInside = useRef(false);

  useEffect(() => {
    setManual({});
    const box = list.current;
    if (!box || !current || pointerInside.current) return;
    const head = box.querySelector<HTMLElement>(`[data-group="${current}"]`);
    if (!head) return;
    // Move only this list, never the page.
    const offset = head.offsetTop - box.offsetTop;
    if (offset < box.scrollTop || offset > box.scrollTop + box.clientHeight - 80)
      box.scrollTop = offset - 4;
  }, [current]);

  if (groups.length === 0) {
    return (
      <p className="m-0 px-4 py-4 text-ui text-text-muted" data-testid="resources-empty">
        No sources or outside references here yet. When a block cites a slide or a reference, it
        shows up here beside it.
      </p>
    );
  }

  return (
    <div
      ref={list}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      data-testid="resources"
      onPointerEnter={() => {
        pointerInside.current = true;
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        actions.hovered.set(null);
      }}
    >
      {groups.map((group) => {
        const open = manual[group.key] ?? group.key === current;
        const live = group.entries.filter((e) => inView.has(e.blockId)).length;
        return (
          <section key={group.key} className="mb-1" data-testid="resource-group">
            <button
              type="button"
              data-group={group.key}
              aria-expanded={open}
              aria-current={group.key === current ? "location" : undefined}
              onClick={() => setManual((m) => ({ ...m, [group.key]: !open }))}
              className={cn(
                "flex min-h-10 w-full items-center gap-2 rounded-control px-2 text-left text-ui font-semibold pointer-coarse:min-h-11",
                group.key === current ? "text-text" : "text-text-muted hover:text-text",
              )}
            >
              <ChevronRight
                aria-hidden
                className={cn(
                  "size-4 shrink-0 transition-transform duration-(--duration-fast)",
                  open && "rotate-90",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{group.title}</span>
              <span className="rounded-pill border border-border px-1.5 text-caption font-medium tabular-nums">
                {live > 0 ? `${live} here · ` : ""}
                {group.entries.length}
              </span>
            </button>
            {open && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 pl-2">
                {group.entries.map((entry) => (
                  <ResourceRow
                    key={entry.key}
                    entry={entry}
                    here={inView.has(entry.blockId)}
                    linked={hovered === entry.blockId}
                    onJump={onJump}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
});

function ResourceRow({
  entry,
  here,
  linked,
  onJump,
}: {
  entry: Entry;
  here: boolean;
  linked: boolean;
  onJump: (blockId: string) => void;
}) {
  const actions = useActions();
  const hue =
    entry.kind === "outside"
      ? "teal"
      : entry.unavailable
        ? DOCUMENT_HUE.citationMissing
        : DOCUMENT_HUE.citation;
  return (
    <li
      data-testid="resource"
      data-block={entry.blockId}
      data-here={here ? "true" : undefined}
      data-linked={linked ? "true" : undefined}
      className={cn(
        "group flex items-stretch gap-1 rounded-card border transition-colors duration-(--duration-instant)",
        linked
          ? "border-accent-border bg-accent-soft"
          : here
            ? "border-border bg-surface-muted"
            : "border-transparent",
      )}
      onPointerEnter={() => actions.hovered.set(entry.blockId)}
    >
      <button
        type="button"
        onClick={() => onJump(entry.blockId)}
        onFocus={() => actions.hovered.set(entry.blockId)}
        onBlur={() => actions.hovered.set(null)}
        aria-label={`${entry.label}${entry.detail ? `, ${entry.detail}` : ""}: go to “${entry.context}”`}
        className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-card px-2 py-1.5 text-left"
      >
        <span
          data-hue={hue}
          className={cn(
            "mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-pill border px-1 text-caption font-semibold text-tone-text tabular-nums",
            entry.unavailable
              ? "border-dashed border-tone-solid"
              : "border-tone-border bg-tone-soft",
          )}
        >
          {entry.kind === "outside" ? (
            <BookMarked aria-hidden className="size-3.5" />
          ) : (
            entry.number
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium leading-snug">{entry.label}</span>
          {entry.detail && (
            <span className="block truncate text-label text-text-muted">{entry.detail}</span>
          )}
          <span className="mt-0.5 block truncate text-label text-text-muted italic">
            {entry.context || "(no text)"}
          </span>
        </span>
      </button>
      {entry.kind === "outside" && entry.url ? (
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${entry.label} in a new tab`}
          className="flex w-11 shrink-0 items-center justify-center rounded-card text-text-muted hover:bg-surface-muted hover:text-text"
        >
          <ExternalLink aria-hidden className="size-4" />
        </a>
      ) : (
        <button
          type="button"
          aria-label={`Open source ${entry.number}`}
          data-testid="resource-open"
          disabled={entry.number === 0}
          onClick={() => actions.openCitation(entry.number)}
          className="flex w-11 shrink-0 items-center justify-center rounded-card text-text-muted hover:bg-surface-muted hover:text-text"
        >
          <FileText aria-hidden className="size-4" />
        </button>
      )}
    </li>
  );
}
