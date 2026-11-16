import { richTextToPlain } from "@notes/schema";
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
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
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

function CardNodeView({ id, data }: NodeProps<CardNodeType>) {
  const actions = useCanvasActions();
  const { card, blocks, reading, editing, pinned, connectSource, dim, maxHeight } = data;
  const body = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const press = useLongPress(() => actions.longPress(id), actions.isCoarse());

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when what is shown changes
  useLayoutEffect(() => {
    const el = body.current;
    if (el) setClipped(!reading && el.scrollHeight > el.clientHeight + 2);
  }, [blocks, card, reading, maxHeight]);

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
      className={classes.join(" ")}
      data-tint={tint}
      data-testid="canvas-card"
      data-card-id={id}
      data-pinned={pinned ? "true" : undefined}
      style={{ height: card.dimensions ? "100%" : undefined }}
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
          <span className="nc-concept-dot" data-tint={tint ?? "teal"} aria-hidden="true">
            ◆
          </span>
          <span>{content.label ?? "Concept"}</span>
        </div>
      ) : (
        <div
          ref={body}
          className={`nc-card-body${clipped ? " nc-clipped" : ""}${reading || editing ? " nodrag nopan nowheel" : ""}${content.kind === "note" ? " nc-card-note" : ""}`}
          style={{
            ["--card-max" as string]: `${maxHeight - (card.title ? 24 : 0)}px`,
            pointerEvents: editing || reading ? "auto" : undefined,
          }}
        >
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
      )}
      <Handles />
    </div>
  );
}

export const CardNode = memo(CardNodeView);
