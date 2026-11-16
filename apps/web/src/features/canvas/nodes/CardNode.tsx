import { CARD_TEXT, richTextToPlain } from "@notes/schema";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { useCanvasActions } from "../model/actions";
import type { CardNode as CardNodeType } from "../model/flow";
import { StickerArt } from "../stickers/Stickers";
import { Icon } from "../ui/icons";

const LONG_PRESS_MS = 480;
const SIDES = [
  [Position.Top, "t"],
  [Position.Right, "r"],
  [Position.Bottom, "b"],
  [Position.Left, "l"],
] as const;

function Handles() {
  return (
    <>
      {SIDES.map(([position, id]) => (
        <Handle key={id} id={id} type="source" position={position} aria-label="Drag to connect" />
      ))}
    </>
  );
}

/** Long-press on touch: hold still for a moment to start multi-select. */
function useLongPress(onLongPress: () => void, enabled: boolean) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled || e.pointerType !== "touch") return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        onLongPress();
        navigator.vibrate?.(12);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8)
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

function NoteEditor({
  initial,
  onSave,
  onDone,
}: {
  initial: string;
  onSave: (t: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  // A new node stays hidden until React Flow has measured it, and hidden
  // fields cannot take focus: retry for a few frames.
  useLayoutEffect(() => {
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) el.select();
      else if (tries++ < 20) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <textarea
      ref={ref}
      className="nodrag nopan nowheel"
      aria-label="Note text"
      value={text}
      maxLength={2000}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() && text !== initial) onSave(text.trim());
        onDone();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          setText(initial);
          onDone();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

/**
 * The height a card's content needs, whatever box it is drawn in: the border, the title band, and
 * the body at its natural height up to its maximum (taller content clips with a fade).
 */
function naturalHeight(cardEl: HTMLElement): number {
  let height = cardEl.offsetHeight - cardEl.clientHeight; // the border
  for (const child of cardEl.children) {
    const el = child as HTMLElement;
    const style = getComputedStyle(el);
    if (style.position === "absolute" || style.display === "none") continue; // badge, handles
    if (el.classList.contains("nc-card-body")) {
      const max = Number.parseFloat(style.maxHeight);
      height += Number.isFinite(max) ? Math.min(el.scrollHeight, max) : el.scrollHeight;
    } else height += el.offsetHeight;
  }
  return Math.ceil(height);
}

function CardNodeView({ id, data }: NodeProps<CardNodeType>) {
  const actions = useCanvasActions();
  const { card, blocks, reading, editing, pinned, connectSource, dim, maxHeight } = data;
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const press = useLongPress(() => actions.longPress(id), actions.isCoarse());

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when what is shown changes
  useLayoutEffect(() => {
    const el = body.current;
    if (el) setClipped(!reading && el.scrollHeight > el.clientHeight + 2);
  }, [blocks, card, reading, maxHeight]);

  // Tell the layout what the content needs, now and whenever it changes size (a renderer that
  // loads late, a font, an edit). Not while open to read or edit: that state is drawn on top of
  // the map and must not push other cards around. Not while a renderer still shows its loading
  // placeholder: that is not the card's size.
  const measurable = !reading && !editing && !card.dimensions && card.content.kind !== "sticker";
  useLayoutEffect(() => {
    const el = root.current;
    if (!measurable || !el || typeof ResizeObserver === "undefined") return;
    const report = () => {
      if (el.querySelector(".skeleton")) return;
      const size = { width: el.offsetWidth, height: naturalHeight(el) };
      if (size.width > 0 && size.height > 0) actions.measureCard(id, size);
      const b = body.current;
      if (b) setClipped(b.scrollHeight > b.clientHeight + 2);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [actions, id, measurable]);

  const content = card.content;
  if (content.kind === "sticker") {
    return (
      <div
        {...press}
        className={dim ? "nc-dim" : undefined}
        style={{ width: "100%", height: "100%" }}
      >
        <StickerArt sticker={content.sticker} className="nc-sticker" />
        <Handles />
      </div>
    );
  }

  const tint = card.color;
  const classes = ["nc-card"];
  if (reading) classes.push("nc-reading");
  if (connectSource) classes.push("nc-connect-source");
  if (dim) classes.push("nc-dim");

  return (
    <div
      {...press}
      ref={root}
      className={classes.join(" ")}
      data-hue={tint}
      data-testid="canvas-card"
      data-card-id={id}
      data-pinned={pinned ? "true" : undefined}
      // Fills the box the layout gave the node (see buildNodes); open to read or edit, it grows.
      style={{ height: reading || editing ? undefined : "100%" }}
    >
      {pinned && (
        <span className="nc-pin-badge" title="Placed by you" role="img" aria-label="Placed by you">
          <Icon name="pin" size={12} />
        </span>
      )}
      {(card.title || reading || editing) && (
        <div
          className={`nc-card-title${reading || editing ? " nc-card-grip" : ""}`}
          style={{ cursor: reading ? "grab" : undefined }}
        >
          {card.title ?? (reading ? "Reading" : "Note")}
        </div>
      )}
      {content.kind === "concept" ? (
        <div className="nc-card-concept">
          <span className="nc-concept-dot" data-hue={tint ?? "teal"} aria-hidden="true">
            ◆
          </span>
          <span>{content.label ?? "Concept"}</span>
        </div>
      ) : (
        <div
          ref={body}
          className={`nc-card-body${clipped ? " nc-clipped" : ""}${reading || editing ? " nodrag nopan nowheel" : ""}${content.kind === "note" ? " nc-card-note" : ""}`}
          style={{
            // The title band takes its height from the body, so a card is never taller than the
            // layout's maximum for its class (`cardMaxHeight`).
            ["--card-max" as string]: `${maxHeight - (card.title ? CARD_TEXT.titleHeight : 0)}px`,
            pointerEvents: editing || reading ? "auto" : undefined,
          }}
        >
          {/* Its own height is the content's, clipped or not: watched to re-measure the card. */}
          <div ref={inner}>
            {content.kind === "note" ? (
              editing ? (
                <NoteEditor
                  initial={richTextToPlain(content.text)}
                  onSave={(text) => actions.saveNote(id, text)}
                  onDone={actions.stopEditing}
                />
              ) : (
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{richTextToPlain(content.text)}</p>
              )
            ) : (
              blocks.map((block) => <div key={block.id}>{actions.renderBlock(block)}</div>)
            )}
          </div>
        </div>
      )}
      <Handles />
    </div>
  );
}

export const CardNode = memo(CardNodeView);
