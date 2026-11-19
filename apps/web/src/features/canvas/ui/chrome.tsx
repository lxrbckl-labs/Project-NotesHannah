import {
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
import { Chip } from "../../../components/ui/badge";
import { inputClass } from "../../../components/ui/field";
import { HuePicker } from "../../../components/ui/hue-picker";
import { Popover } from "../../../components/ui/popover";
import { SegmentedControl, segmentItemClass } from "../../../components/ui/segmented";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { CONNECTOR_HUE } from "../../../lib/roles";
import { StickerArt, stickerLabel } from "../stickers/Stickers";
import type { IconName } from "./icons";
import { ToolButton, useCanvasPortal } from "./primitives";

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
    <span className="nc-zoom-label" aria-live="off" data-testid="zoom-label">
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
  const container = useCanvasPortal();
  return (
    <Popover
      label="Stickers"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      side="top"
      container={container}
      focusOnOpen={false}
    >
      <div className="nc-sticker-grid">
        {STICKERS.map((s) => (
          <Tooltip key={s} content={`Add ${stickerLabel(s)} sticker`}>
            <button
              type="button"
              className="flex size-14 items-center justify-center rounded-control transition-colors duration-(--duration-instant) hover:bg-surface-muted"
              aria-label={`Add ${stickerLabel(s)} sticker`}
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
            >
              <StickerArt sticker={s} size={36} />
            </button>
          </Tooltip>
        ))}
      </div>
    </Popover>
  );
}

/** The color of a card or frame: the shared HuePicker in a popover. */
export function ColorPicker({
  label,
  value,
  onPick,
  trigger,
}: {
  /** The picker's accessible name, e.g. "Card colour". */
  label: string;
  value: ColorToken | undefined;
  onPick: (c: ColorToken | null) => void;
  trigger: React.ReactNode;
}) {
  const container = useCanvasPortal();
  return (
    <Popover label="Color" trigger={trigger} side="top" container={container} focusOnOpen={false}>
      <HuePicker label={label} value={value ?? null} onChange={onPick} className="max-w-60" />
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
          className={cn(inputClass, "min-w-0 flex-1")}
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
        <ToolButton icon="trash" label="Delete connector" danger onClick={onDelete} />
        <ToolButton
          icon="close"
          label="Close"
          onClick={() => {
            saveLabel();
            onClose();
          }}
        />
      </div>
      <fieldset className="nc-editor-row mt-3">
        <legend className="sr-only">Kind</legend>
        {CONNECTOR_KINDS.map((k) => (
          <Chip
            key={k}
            hue={CONNECTOR_HUE[k]}
            pressed={connector.kind === k}
            onClick={() => onChange({ kind: k })}
          >
            {KIND_LABEL[k]}
          </Chip>
        ))}
      </fieldset>
      <div className="nc-editor-row mt-3">
        <SegmentedControl
          label="Arrow"
          value={connector.direction}
          onValueChange={(d) => onChange({ direction: d })}
          items={CONNECTOR_DIRECTIONS.map((d) => ({
            value: d,
            label: `Arrow ${d}`,
            icon: <span className="text-body leading-none">{DIRECTION_ICON[d]}</span>,
            iconOnly: true,
          }))}
        />
        {/* Line style can be cleared back to the kind's default, so these are toggles. */}
        <fieldset className={cn(SEGMENT_TRACK, "m-0 min-w-0")}>
          <legend className="sr-only">Line</legend>
          {LINE_STYLES.map((l) => (
            <button
              key={l}
              type="button"
              className={segmentItemClass(connector.line === l)}
              aria-pressed={connector.line === l}
              onClick={() => onChange({ line: connector.line === l ? null : l })}
            >
              {l}
            </button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

/** The grey track of a segmented row (as the shared SegmentedControl draws it). */
const SEGMENT_TRACK = "inline-flex gap-1 rounded-card border border-border bg-surface-muted p-1";

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
      className={cn("nc-panel nc-chrome", phone && "nc-panel-phone")}
      aria-label="Frames"
      data-testid="frame-panel"
    >
      <div className="flex items-center">
        <h2 className="nc-panel-title">Frames</h2>
        <ToolButton
          icon="play"
          label="Step through"
          onClick={onStep}
          disabled={frames.length === 0}
        />
        <ToolButton icon="close" label="Close frames" onClick={onClose} />
      </div>
      {ordered.length === 0 && (
        <p className="mx-2.5 mb-2.5 mt-1 text-ui text-text-muted">
          No frames yet. Select cards and press Frame.
        </p>
      )}
      {ordered.map((f, i) => (
        <div key={f.id} className="nc-frame-row" style={{ paddingLeft: depth(f) * 14 }}>
          {editing === f.id ? (
            <input
              className={cn(inputClass, "min-w-0 flex-1")}
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
            <button type="button" className="nc-frame-jump" onClick={() => onJump(f.id)}>
              <span className="nc-frame-step" data-hue={f.color}>
                {i + 1}
              </span>
              <span className="nc-frame-name">{f.title}</span>
              <span className="nc-count">{f.members.length}</span>
            </button>
          )}
          <ToolButton
            icon="edit"
            label={`Rename ${f.title}`}
            onClick={() => {
              setTitle(f.title);
              setEditing(f.id);
            }}
          />
          {!phone && (
            <ToolButton
              icon="up"
              label={`Move ${f.title} earlier`}
              disabled={i === 0}
              onClick={() => onMove(f.id, i - 1)}
            />
          )}
          {!phone && (
            <ToolButton
              icon="down"
              label={`Move ${f.title} later`}
              disabled={i === ordered.length - 1}
              onClick={() => onMove(f.id, i + 1)}
            />
          )}
          <ToolButton
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
      className={cn("nc-stepbar nc-chrome", inline && "nc-stepbar-inline")}
      aria-label="Step through frames"
      data-testid="step-bar"
    >
      <ToolButton icon="left" label="Previous frame" onClick={onPrev} disabled={index <= 0} />
      <span className="nc-step-text">
        <span className="nc-step-count" aria-live="polite">
          {index + 1} / {total}
        </span>
        <span className="nc-step-title" data-testid="step-title">
          {title}
        </span>
      </span>
      <ToolButton icon="right" label="Next frame" onClick={onNext} disabled={index >= total - 1} />
      {!inline && <span className="nc-sep" />}
      <ToolButton icon={exitIcon} label={exitLabel} onClick={onExit} />
    </nav>
  );
}
