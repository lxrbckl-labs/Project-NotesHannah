import {
  COLOR_TOKENS,
  CONNECTOR_DIRECTIONS,
  CONNECTOR_KINDS,
  type ColorToken,
  type Connector,
  type ConnectorDirection,
  type ConnectorKind,
  type Frame,
  LINE_STYLES,
  type LineStyle,
  STICKERS,
  type Sticker,
} from "@notes/schema";
import { useStore } from "@xyflow/react";
import { useEffect, useState } from "react";
import { StickerArt, stickerLabel } from "../stickers/Stickers";
import type { IconName } from "./icons";
import { IconButton, Popover } from "./primitives";

export const KIND_LABEL: Record<ConnectorKind, string> = {
  leads_to: "leads to",
  causes: "causes",
  treats: "treats",
  contrasts: "contrasts",
  part_of: "part of",
  related: "related",
};

const DIRECTION_ICON: Record<ConnectorDirection, string> = {
  forward: "→",
  backward: "←",
  both: "↔",
  none: "—",
};

export function ZoomLabel() {
  const zoom = useStore((s) => Math.round(s.transform[2] * 100));
  return (
    <span className="nc-btn nc-zoom-label" aria-live="off" data-testid="zoom-label">
      {zoom}%
    </span>
  );
}

export function StickerPicker({
  onPick,
  trigger,
}: {
  onPick: (s: Sticker) => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover label="Stickers" open={open} onOpenChange={setOpen} trigger={trigger}>
      <div className="nc-sticker-grid">
        {STICKERS.map((s) => (
          <button
            key={s}
            type="button"
            className="nc-btn"
            aria-label={`Add ${stickerLabel(s)} sticker`}
            onClick={() => {
              onPick(s);
              setOpen(false);
            }}
          >
            <StickerArt sticker={s} size={36} />
          </button>
        ))}
      </div>
    </Popover>
  );
}

export function ColorPicker({
  value,
  onPick,
  trigger,
}: {
  value: ColorToken | undefined;
  onPick: (c: ColorToken | null) => void;
  trigger: React.ReactNode;
}) {
  return (
    <Popover label="Colour" trigger={trigger}>
      <div className="nc-seg" style={{ maxWidth: 220 }}>
        <button
          type="button"
          className="nc-btn"
          aria-label="No colour"
          aria-pressed={!value}
          onClick={() => onPick(null)}
        >
          <span className="nc-swatch nc-swatch-none" />
        </button>
        {COLOR_TOKENS.map((c) => (
          <button
            key={c}
            type="button"
            className="nc-btn"
            aria-label={`${c} colour`}
            aria-pressed={value === c}
            onClick={() => onPick(c)}
            data-tint={c}
          >
            <span className="nc-swatch" />
          </button>
        ))}
      </div>
    </Popover>
  );
}

/** Edit a connector's label, kind, direction and line. Docked at the top so it works the same by touch. */
export function ConnectorEditor({
  connector,
  onChange,
  onDelete,
  onClose,
  autoFocus,
}: {
  connector: Connector;
  onChange: (patch: {
    label?: string | null;
    kind?: ConnectorKind;
    direction?: ConnectorDirection;
    line?: LineStyle | null;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  const [label, setLabel] = useState(connector.label ?? "");
  useEffect(() => setLabel(connector.label ?? ""), [connector.label]);
  const saveLabel = () => {
    const next = label.trim();
    if (next !== (connector.label ?? "")) onChange({ label: next ? next.slice(0, 80) : null });
  };
  return (
    <div
      className="nc-editor nc-chrome"
      role="dialog"
      aria-label="Edit connector"
      data-testid="connector-editor"
    >
      <div className="nc-editor-row">
        <input
          type="text"
          aria-label="Connector label"
          placeholder="Label, e.g. lowers heart rate"
          value={label}
          maxLength={80}
          // biome-ignore lint/a11y/noAutofocus: a new connector asks for its label straight away
          autoFocus={autoFocus}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              saveLabel();
              onClose();
            }
            if (e.key === "Escape") onClose();
          }}
        />
        <IconButton icon="trash" label="Delete connector" danger onClick={onDelete} />
        <IconButton
          icon="close"
          label="Close"
          onClick={() => {
            saveLabel();
            onClose();
          }}
        />
      </div>
      <fieldset
        className="nc-editor-row"
        style={{ marginTop: 8, border: 0, padding: 0, marginInline: 0 }}
      >
        <legend className="nc-sr">Kind</legend>
        {CONNECTOR_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="nc-kind"
            aria-pressed={connector.kind === k}
            style={{ ["--edge-color" as string]: `var(--edge-${k})` }}
            onClick={() => onChange({ kind: k })}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </fieldset>
      <div className="nc-editor-row nc-seg" style={{ marginTop: 8 }}>
        {CONNECTOR_DIRECTIONS.map((d) => (
          <button
            key={d}
            type="button"
            className="nc-btn"
            aria-label={`Arrow ${d}`}
            aria-pressed={connector.direction === d}
            onClick={() => onChange({ direction: d })}
          >
            {DIRECTION_ICON[d]}
          </button>
        ))}
        <span className="nc-sep" />
        {LINE_STYLES.map((l) => (
          <button
            key={l}
            type="button"
            className="nc-btn"
            aria-pressed={connector.line === l}
            onClick={() => onChange({ line: connector.line === l ? null : l })}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Frames in step order, nested by parent, to jump to, rename, reorder and delete. */
export function FramePanel({
  frames,
  phone,
  onJump,
  onRename,
  onDelete,
  onMove,
  onClose,
  onStep,
}: {
  frames: Frame[];
  phone: boolean;
  onJump: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, order: number) => void;
  onClose: () => void;
  onStep: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const ordered = [...frames].sort((a, b) => a.order - b.order);
  const depth = (f: Frame): number => {
    let d = 0;
    let cur = f.parent ? frames.find((x) => x.id === f.parent) : undefined;
    while (cur && d < 5) {
      d += 1;
      cur = cur.parent ? frames.find((x) => x.id === cur?.parent) : undefined;
    }
    return d;
  };
  return (
    <section
      className="nc-panel nc-chrome"
      aria-label="Frames"
      data-testid="frame-panel"
      style={
        phone
          ? {
              top: "auto",
              bottom: "calc(76px + env(safe-area-inset-bottom))",
              left: 12,
              right: 12,
              width: "auto",
              maxHeight: "55%",
            }
          : undefined
      }
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2 style={{ flex: 1 }}>Frames</h2>
        <IconButton
          icon="play"
          label="Step through"
          onClick={onStep}
          disabled={frames.length === 0}
        />
        <IconButton icon="close" label="Close frames" onClick={onClose} />
      </div>
      {ordered.length === 0 && (
        <p className="nc-muted" style={{ margin: "4px 10px 10px" }}>
          No frames yet. Select cards and press Frame.
        </p>
      )}
      {ordered.map((f, i) => (
        <div key={f.id} className="nc-frame-row" style={{ paddingLeft: depth(f) * 14 }}>
          {editing === f.id ? (
            <input
              aria-label="Frame title"
              // biome-ignore lint/a11y/noAutofocus: renaming starts with the field focused
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title.trim() !== f.title) onRename(f.id, title.trim());
                setEditing(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <button type="button" className="nc-btn nc-frame-jump" onClick={() => onJump(f.id)}>
              <span className="nc-frame-step" data-tint={f.color}>
                {i + 1}
              </span>
              <span className="nc-frame-name">{f.title}</span>
              <span className="nc-count">{f.members.length}</span>
            </button>
          )}
          <IconButton
            icon="edit"
            label={`Rename ${f.title}`}
            onClick={() => {
              setTitle(f.title);
              setEditing(f.id);
            }}
          />
          {!phone && (
            <IconButton
              icon="up"
              label={`Move ${f.title} earlier`}
              disabled={i === 0}
              onClick={() => onMove(f.id, i - 1)}
            />
          )}
          {!phone && (
            <IconButton
              icon="down"
              label={`Move ${f.title} later`}
              disabled={i === ordered.length - 1}
              onClick={() => onMove(f.id, i + 1)}
            />
          )}
          <IconButton
            icon="trash"
            label={`Delete frame ${f.title}`}
            danger
            onClick={() => onDelete(f.id)}
          />
        </div>
      ))}
    </section>
  );
}

export function StepBar({
  inline,
  index,
  total,
  title,
  onPrev,
  onNext,
  onExit,
  exitLabel = "Exit step-through",
  exitIcon = "close",
}: {
  inline?: boolean;
  index: number;
  total: number;
  title: string;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  exitLabel?: string;
  exitIcon?: IconName;
}) {
  return (
    <nav
      className={`nc-stepbar nc-chrome${inline ? " nc-stepbar-inline" : ""}`}
      aria-label="Step through frames"
      data-testid="step-bar"
    >
      <IconButton icon="left" label="Previous frame" onClick={onPrev} disabled={index <= 0} />
      <span className="nc-step-count" aria-live="polite">
        {index + 1} / {total}
      </span>
      <span className="nc-step-title" data-testid="step-title">
        {title}
      </span>
      <IconButton icon="right" label="Next frame" onClick={onNext} disabled={index >= total - 1} />
      <span className="nc-sep" />
      <IconButton icon={exitIcon} label={exitLabel} onClick={onExit} />
    </nav>
  );
}
