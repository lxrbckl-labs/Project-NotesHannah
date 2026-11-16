import type { NodeProps } from "@xyflow/react";
import { memo, useState } from "react";
import { useCanvasActions } from "../model/actions";
import type { FrameNode as FrameNodeType } from "../model/flow";

function FrameNodeView({ id, data }: NodeProps<FrameNodeType>) {
  const actions = useCanvasActions();
  const { frame, step, active, dim, dropTarget, count } = data;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(frame.title);
  const classes = ["nc-frame"];
  if (active) classes.push("nc-frame-active");
  if (dim) classes.push("nc-dim");
  return (
    <div
      className={dropTarget ? "nc-drop-target" : undefined}
      style={{ width: "100%", height: "100%" }}
    >
      <div
        className={classes.join(" ")}
        data-tint={frame.color}
        data-testid="canvas-frame"
        data-frame-id={id}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: double-click to rename is a shortcut; the frame list renames by keyboard and touch */}
        <div
          className="nc-frame-head"
          onDoubleClick={() => {
            setTitle(frame.title);
            setEditing(true);
          }}
        >
          <span className="nc-frame-step">
            <span className="nc-sr">Step </span>
            {step}
          </span>
          {editing ? (
            <input
              className="nodrag nopan"
              aria-label="Frame title"
              // biome-ignore lint/a11y/noAutofocus: renaming starts with the field focused
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (title.trim() && title.trim() !== frame.title)
                  actions.renameFrame(id, title.trim());
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setTitle(frame.title);
                  setEditing(false);
                }
              }}
              style={{
                font: "inherit",
                fontWeight: 650,
                height: 30,
                borderRadius: 8,
                border: "1px solid var(--nc-select)",
                padding: "0 8px",
                background: "var(--nc-card)",
                color: "inherit",
              }}
            />
          ) : (
            <span className="nc-frame-title">{frame.title}</span>
          )}
          <span className="nc-count">
            {count}
            <span className="nc-sr"> cards</span>
          </span>
        </div>
      </div>
    </div>
  );
}

export const FrameNode = memo(FrameNodeView);
