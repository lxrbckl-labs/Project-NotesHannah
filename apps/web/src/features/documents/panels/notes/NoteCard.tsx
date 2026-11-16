import { type ColorToken, MARGIN_NOTE_LIMITS, type MarginNote } from "@notes/schema";
import { Check, Link2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { type KeyboardEvent, type Ref, useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../../../../components/ui/button";
import { cn } from "../../../../lib/cn";
import { CATEGORICAL_HUES, HUE_LABEL } from "../../../../lib/hues";
import { formatWhen } from "../../ui/hooks";

const NONE = "none";

/** Her note's colour: none, or one of the palette's lively hues. Small swatches with a full hit area. */
export function NoteColours({
  value,
  onChange,
}: {
  value: ColorToken | null;
  onChange: (colour: ColorToken | null) => void;
}) {
  return (
    <RadioGroup.Root
      aria-label="Note colour"
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : (v as ColorToken))}
      orientation="horizontal"
      className="flex flex-wrap gap-1"
    >
      <RadioGroup.Item
        value={NONE}
        aria-label="No colour"
        className="hit-area flex size-7 items-center justify-center rounded-pill border-2 border-border-strong bg-surface data-[state=checked]:ring-2 data-[state=checked]:ring-text data-[state=checked]:ring-offset-1 data-[state=checked]:ring-offset-surface"
      >
        <span aria-hidden className="h-0.5 w-3.5 rotate-45 rounded-pill bg-border-strong" />
      </RadioGroup.Item>
      {CATEGORICAL_HUES.map((hue) => (
        <RadioGroup.Item
          key={hue}
          value={hue}
          data-hue={hue}
          aria-label={HUE_LABEL[hue]}
          className="hit-area flex size-7 items-center justify-center rounded-pill border-2 border-tone-solid bg-tone-soft data-[state=checked]:ring-2 data-[state=checked]:ring-text data-[state=checked]:ring-offset-1 data-[state=checked]:ring-offset-surface"
        >
          <RadioGroup.Indicator>
            <Check aria-hidden size={12} strokeWidth={3} className="text-tone-text" />
          </RadioGroup.Indicator>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** Writing or changing a note: plain text with line breaks; ⌘/Ctrl+Enter saves, Escape cancels. */
export function NoteEditor({
  initialText = "",
  initialColour = null,
  quote,
  label,
  saveLabel,
  onSave,
  onCancel,
}: {
  initialText?: string;
  initialColour?: ColorToken | null;
  quote?: string | null;
  label: string;
  saveLabel: string;
  onSave: (text: string, colour: ColorToken | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [colour, setColour] = useState<ColorToken | null>(initialColour);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Grow with the text, up to a point, so a long note is not a tiny scroll box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure after each change of text
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [text]);
  const save = () => {
    if (text.trim()) onSave(text, colour);
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="flex flex-col gap-2" data-testid="note-editor">
      {quote ? (
        <p className="m-0 line-clamp-2 border-l-2 border-border-strong pl-2 text-label text-text-muted italic">
          “{quote}”
        </p>
      ) : null}
      <textarea
        ref={area}
        aria-label={label}
        value={text}
        maxLength={MARGIN_NOTE_LIMITS.textChars}
        rows={3}
        placeholder="A note to yourself…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        className="min-h-20 w-full resize-none rounded-control border border-border-strong bg-surface px-2.5 py-2 text-ui leading-snug text-text outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft"
      />
      <NoteColours value={colour} onChange={setColour} />
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={save}
          disabled={!text.trim()}
          data-testid="note-save"
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * One side note. Her words, when it was written, and (when she is looking at it) its actions:
 * done, change, colour and delete. A detached one says which words it was on and can be put back
 * on the block she is reading.
 */
export function NoteCard({
  note,
  focused,
  detached,
  here,
  cardRef,
  onFocus,
  onUpdate,
  onDelete,
  onReattach,
  onShowBlock,
  className,
}: {
  note: MarginNote;
  focused: boolean;
  detached: boolean;
  /** Its block is in view (list mode). */
  here?: boolean;
  cardRef?: Ref<HTMLElement>;
  onFocus: () => void;
  onUpdate: (patch: { text?: string; colour?: ColorToken | null; resolved?: boolean }) => void;
  onDelete: () => void;
  onReattach?: () => void;
  /** List mode: go to the block. */
  onShowBlock?: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!focused) setEditing(false);
  }, [focused]);
  return (
    <article
      ref={cardRef}
      data-testid="side-note"
      data-note-id={note.id}
      data-anchor={note.blockId}
      data-focused={focused ? "true" : undefined}
      data-resolved={note.resolved ? "true" : undefined}
      data-detached={detached ? "true" : undefined}
      data-here={here ? "true" : undefined}
      data-hue={note.colour ?? undefined}
      aria-label={`Side note${note.resolved ? ", resolved" : ""}: ${note.text.slice(0, 80)}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, textarea, a, [role=radio]")) return;
        onFocus();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onFocus();
        }
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card is focusable so the keyboard can look at it
      tabIndex={0}
      className={cn(
        // An outline, not a ring: the card's own shadow would paint over a ring.
        "rounded-card border bg-surface px-3 py-2.5 text-ui shadow-card outline-offset-1 transition-[box-shadow,border-color,opacity] duration-(--duration-fast)",
        note.colour ? "border-l-4 border-tone-border border-l-tone-solid" : "border-border",
        focused
          ? "shadow-pop outline-2 outline-accent"
          : "outline-none focus-visible:outline-2 focus-visible:outline-accent",
        note.resolved && !focused && "opacity-70",
        here && !focused && "border-accent-border",
        className,
      )}
    >
      {detached ? (
        <p className="m-0 mb-1.5 text-label text-text-muted">
          Was on: <span className="italic">“{note.snippet || "a block that is gone"}”</span>
        </p>
      ) : note.quote ? (
        <p className="m-0 mb-1.5 line-clamp-2 border-l-2 border-border-strong pl-2 text-label text-text-muted italic">
          “{note.quote}”
        </p>
      ) : null}
      {editing ? (
        <NoteEditor
          initialText={note.text}
          initialColour={note.colour}
          label="Change the side note"
          saveLabel="Save"
          onSave={(text, colour) => {
            setEditing(false);
            onUpdate({
              ...(text.trim() !== note.text ? { text } : {}),
              ...(colour !== note.colour ? { colour } : {}),
            });
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p
          className={cn(
            "m-0 whitespace-pre-wrap break-words leading-snug text-text",
            !focused && "line-clamp-6",
            note.resolved && "text-text-muted",
          )}
          data-testid="side-note-text"
        >
          {note.text}
        </p>
      )}
      {!editing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="mr-auto text-caption text-text-muted">
            {note.resolved ? (
              <span className="inline-flex items-center gap-1 font-medium text-success">
                <Check aria-hidden className="size-3" /> Done ·{" "}
              </span>
            ) : null}
            {note.updatedAt !== note.createdAt ? "edited " : ""}
            {formatWhen(note.updatedAt)}
          </span>
          {focused && (
            <>
              {onShowBlock && !detached && (
                <IconButton label="Show in the page" size="sm" onClick={onShowBlock}>
                  <Link2 className="size-4" />
                </IconButton>
              )}
              {detached && onReattach ? (
                <Button size="sm" onClick={onReattach} data-testid="note-reattach">
                  <Link2 aria-hidden className="size-3.5" /> Attach here
                </Button>
              ) : null}
              {!detached && (
                <IconButton
                  label={note.resolved ? "Reopen" : "Mark as done"}
                  size="sm"
                  data-testid="note-resolve"
                  onClick={() => onUpdate({ resolved: !note.resolved })}
                >
                  {note.resolved ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                </IconButton>
              )}
              <IconButton
                label="Change"
                size="sm"
                data-testid="note-edit"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" />
              </IconButton>
              <IconButton
                label="Delete"
                size="sm"
                variant="ghostDanger"
                data-testid="note-delete"
                onClick={onDelete}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      )}
    </article>
  );
}
