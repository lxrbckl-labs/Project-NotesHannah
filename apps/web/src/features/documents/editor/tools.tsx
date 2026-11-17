import { COLOR_TOKENS, type ColorToken } from "@notes/schema";
import type { Editor } from "@tiptap/core";
import {
  Bold,
  Check,
  Code,
  Highlighter,
  Italic,
  Link2,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Popover as RadixPopover } from "radix-ui";
import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Button, IconButton } from "../../../components/ui/button";
import { floatingPanelClass } from "../../../components/ui/popover";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { HUE_LABEL } from "../../../lib/hues";

/**
 * The formatting controls shared by the ribbon, the selection bubble and the
 * phone's keyboard dock. Every control keeps the caret where it is: a press
 * never takes the focus (mouse down is cancelled), and popovers do not move
 * the focus into themselves.
 */

/** "⌘" on Apple devices, "Ctrl+" elsewhere: how shortcuts read in tooltips. */
export const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
export const SHIFT = MOD === "⌘" ? "⇧" : "Shift+";

/** Keep the caret in the text: pressing a toolbar control must not move the focus. */
export const keepCaret = (event: { preventDefault: () => void }) => event.preventDefault();

/** A thin vertical rule between groups of controls. */
export function Divider() {
  return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

/** The look of a square toolbar control that is not an `IconButton` (popover triggers). */
export const toolSquareClass =
  "flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-(--duration-instant) disabled:pointer-events-none disabled:opacity-40 xl:size-9 [&_svg]:size-[18px]";

export function ToolButton({
  label,
  active,
  onPress,
  children,
  shortcut,
  disabled,
  tooltips = true,
  testId,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  /** Hover hints; off on touch, where they never show. */
  tooltips?: boolean;
  testId?: string;
}) {
  const button = (
    <IconButton
      variant="bare"
      label={label}
      pressed={active}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      onMouseDown={keepCaret}
      onClick={onPress}
      data-testid={testId}
      className="disabled:opacity-40 [&_svg]:size-[18px]"
    >
      {children}
    </IconButton>
  );
  if (!tooltips) return button;
  return <Tooltip content={shortcut ? `${label}  ${shortcut}` : label}>{button}</Tooltip>;
}

export interface MarkState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  highlight: string | null;
  link: string | null;
}

const NO_MARKS: MarkState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  highlight: null,
  link: null,
};

/**
 * A value read from an editor, kept current on every transaction, focus and
 * blur. Unlike Tiptap's `useEditorState` it reads the editor afresh when the
 * editor itself changes (the caret moves to another block), so the ribbon
 * never shows the previous block's marks. `fallback` must be a constant.
 */
export function useEditorValue<T>(
  editor: Editor | null,
  select: (editor: Editor) => T,
  fallback: T,
): T {
  const cache = useRef<{ editor: Editor; key: string; value: T } | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return () => {};
      editor.on("transaction", onChange);
      editor.on("focus", onChange);
      editor.on("blur", onChange);
      return () => {
        editor.off("transaction", onChange);
        editor.off("focus", onChange);
        editor.off("blur", onChange);
      };
    },
    [editor],
  );
  const read = () => {
    if (!editor || editor.isDestroyed) return fallback;
    const value = selectRef.current(editor);
    const key = JSON.stringify(value);
    const last = cache.current;
    // The same answer keeps the same object, so React sees no change.
    if (last && last.editor === editor && last.key === key) return last.value;
    cache.current = { editor, key, value };
    return value;
  };
  return useSyncExternalStore(subscribe, read, read);
}

function readMarks(e: Editor): MarkState {
  return {
    bold: e.isActive("bold"),
    italic: e.isActive("italic"),
    underline: e.isActive("underline"),
    strike: e.isActive("strike"),
    code: e.isActive("code"),
    highlight:
      (e.getAttributes("highlight").color as string | undefined) ??
      (e.isActive("highlight") ? "yellow" : null),
    link: (e.getAttributes("link").href as string | undefined) ?? null,
  };
}

/** The marks at the caret or across the selection, live as she types and moves. */
export function useMarks(editor: Editor | null): MarkState {
  return useEditorValue(editor, readMarks, NO_MARKS);
}

/** Run a command on the editor and leave the caret in it. */
export const chainOf = (editor: Editor) => editor.chain().focus();

/** Bold, italic, underline, strikethrough and code. */
export function MarkButtons({
  editor,
  marks,
  tooltips = true,
}: {
  editor: Editor | null;
  marks: MarkState;
  tooltips?: boolean;
}) {
  const off = !editor;
  const run = (fn: (e: Editor) => void) => () => {
    if (editor && !editor.isDestroyed) fn(editor);
  };
  return (
    <>
      <ToolButton
        label="Bold"
        shortcut={`${MOD}B`}
        active={marks.bold}
        disabled={off}
        tooltips={tooltips}
        onPress={run((e) => chainOf(e).toggleBold().run())}
      >
        <Bold strokeWidth={2.5} />
      </ToolButton>
      <ToolButton
        label="Italic"
        shortcut={`${MOD}I`}
        active={marks.italic}
        disabled={off}
        tooltips={tooltips}
        onPress={run((e) => chainOf(e).toggleItalic().run())}
      >
        <Italic />
      </ToolButton>
      <ToolButton
        label="Underline"
        shortcut={`${MOD}U`}
        active={marks.underline}
        disabled={off}
        tooltips={tooltips}
        onPress={run((e) => chainOf(e).toggleUnderline().run())}
      >
        <Underline />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        shortcut={`${MOD}${SHIFT}S`}
        active={marks.strike}
        disabled={off}
        tooltips={tooltips}
        onPress={run((e) => chainOf(e).toggleStrike().run())}
      >
        <Strikethrough />
      </ToolButton>
      <ToolButton
        label="Code"
        shortcut={`${MOD}E`}
        active={marks.code}
        disabled={off}
        tooltips={tooltips}
        onPress={run((e) => chainOf(e).toggleCode().run())}
      >
        <Code />
      </ToolButton>
    </>
  );
}

/** A swatch grid in a popover that never takes the focus, so the selection stays. */
export function SwatchPopover({
  trigger,
  tooltip,
  label,
  side,
  children,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  /** Hover hint; null on touch. */
  tooltip: string | null;
  label: string;
  side: "top" | "bottom";
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const button = <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>;
  return (
    <RadixPopover.Root
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      {tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button}
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(floatingPanelClass, "p-2.5")}
          aria-label={label}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

/** One colour in a picker: the look comes from the hue, a tick marks the current one. */
function Swatch({
  token,
  chosen,
  label,
  look,
  onPick,
}: {
  token: ColorToken;
  chosen: boolean;
  label: string;
  look: "mark" | "text";
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={chosen}
      title={HUE_LABEL[token]}
      onMouseDown={keepCaret}
      onClick={onPick}
      data-hue={token}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-control border transition-transform duration-(--duration-instant) hover:scale-105 pointer-coarse:size-11",
        look === "mark"
          ? "border-tone-border bg-tone-mark text-text"
          : "border-tone-border bg-surface font-semibold text-tone-text",
        chosen && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
      )}
    >
      {look === "text" ? (
        <span aria-hidden className="text-ui">
          A
        </span>
      ) : (
        chosen && <Check aria-hidden className="size-3.5" />
      )}
    </button>
  );
}

/** Highlighter colours for the selected words (a mark on the run). */
export function HighlightPicker({
  editor,
  current,
  side = "bottom",
  tooltips = true,
}: {
  editor: Editor | null;
  current: string | null;
  side?: "top" | "bottom";
  tooltips?: boolean;
}) {
  const trigger = (
    <button
      type="button"
      aria-label="Highlight colour"
      disabled={!editor}
      onMouseDown={keepCaret}
      data-hue={current ?? "yellow"}
      className={cn(
        toolSquareClass,
        "relative text-text-muted hover:bg-surface-muted hover:text-text",
      )}
    >
      <Highlighter />
      {/* The current highlighter colour, as a bar under the pen. */}
      <span
        aria-hidden
        className={cn(
          "absolute right-2 bottom-1.5 left-2 h-1 rounded-pill xl:right-1.5 xl:bottom-1 xl:left-1.5",
          current ? "bg-tone-solid" : "bg-hue-yellow-solid opacity-60",
        )}
      />
    </button>
  );
  const pick = (fn: (e: Editor) => void) => {
    if (editor && !editor.isDestroyed) fn(editor);
  };
  return (
    <SwatchPopover
      label="Highlight colours"
      side={side}
      trigger={trigger}
      tooltip={tooltips ? `Highlight  ${MOD}${SHIFT}H` : null}
    >
      <p className="m-0 mb-2 text-caption font-medium text-text-muted">Highlight</p>
      <div className="grid grid-cols-5 gap-1.5">
        {COLOR_TOKENS.map((token) => (
          <Swatch
            key={token}
            token={token}
            look="mark"
            chosen={current === token}
            label={`${HUE_LABEL[token]} highlight`}
            onPick={() => pick((e) => chainOf(e).setMark("highlight", { color: token }).run())}
          />
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 w-full"
        onMouseDown={keepCaret}
        onClick={() => pick((e) => chainOf(e).unsetMark("highlight").run())}
      >
        No highlight
      </Button>
    </SwatchPopover>
  );
}

/**
 * The block's colour. The schema stores one colour per block (text colour for
 * text blocks, the accent of a callout or card), not per word, so the control
 * says "Block colour" and colours the whole block.
 */
export function BlockColourPicker({
  current,
  onPick,
  disabled,
  side = "bottom",
  tooltips = true,
}: {
  current: ColorToken | null;
  onPick: (token: ColorToken | null) => void;
  disabled?: boolean;
  side?: "top" | "bottom";
  tooltips?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <button
      type="button"
      aria-label="Block colour"
      disabled={disabled}
      onMouseDown={keepCaret}
      data-hue={current ?? undefined}
      className={cn(
        toolSquareClass,
        "relative text-text-muted hover:bg-surface-muted hover:text-text",
      )}
    >
      <span
        aria-hidden
        className={cn("text-[17px] leading-none font-semibold", current && "text-tone-text")}
      >
        A
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute right-2.5 bottom-1.5 left-2.5 h-1 rounded-pill xl:right-2 xl:bottom-1 xl:left-2",
          current ? "bg-tone-solid" : "bg-text",
        )}
      />
    </button>
  );
  return (
    <SwatchPopover
      label="Block colours"
      side={side}
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      tooltip={tooltips ? "Block colour (the whole block)" : null}
    >
      <p className="m-0 mb-2 text-caption font-medium text-text-muted">Colour of the whole block</p>
      <div className="grid grid-cols-5 gap-1.5">
        {COLOR_TOKENS.map((token) => (
          <Swatch
            key={token}
            token={token}
            look="text"
            chosen={current === token}
            label={`${HUE_LABEL[token]} block`}
            onPick={() => {
              onPick(token);
              setOpen(false);
            }}
          />
        ))}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 w-full"
        onMouseDown={keepCaret}
        onClick={() => {
          onPick(null);
          setOpen(false);
        }}
      >
        Default colour
      </Button>
    </SwatchPopover>
  );
}

/** Add, change or remove a link on the selected words. */
export function LinkPicker({
  editor,
  current,
  side = "bottom",
  tooltips = true,
  onOpenChange,
}: {
  editor: Editor | null;
  current: string | null;
  side?: "top" | "bottom";
  tooltips?: boolean;
  /** The address field takes the focus: the phone dock stays up while it is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [href, setHref] = useState("");
  const chain = () => (editor && !editor.isDestroyed ? chainOf(editor) : null);
  const trigger = (
    <button
      type="button"
      aria-label="Link"
      aria-pressed={Boolean(current)}
      disabled={!editor}
      onMouseDown={keepCaret}
      className={cn(
        toolSquareClass,
        current
          ? "bg-accent text-accent-contrast"
          : "text-text-muted hover:bg-surface-muted hover:text-text",
      )}
    >
      <Link2 />
    </button>
  );
  return (
    <RadixPopover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setHref(current ?? "https://");
      }}
    >
      {tooltips ? (
        <Tooltip content="Link">
          <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
        </Tooltip>
      ) : (
        <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      )}
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(e) => {
            // Back to the text, not to the button.
            e.preventDefault();
            if (editor && !editor.isDestroyed) editor.commands.focus();
          }}
          className={cn(floatingPanelClass, "flex w-[min(20rem,calc(100vw-24px))] gap-1.5 p-2")}
        >
          <form
            className="flex flex-1 gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const url = href.trim();
              if (/^https?:\/\/\S+\.\S+/.test(url))
                chain()?.extendMarkRange("link").setLink({ href: url }).run();
              else if (!url) chain()?.extendMarkRange("link").unsetLink().run();
              setOpen(false);
            }}
          >
            <input
              aria-label="Link address"
              value={href}
              onChange={(e) => setHref(e.target.value)}
              className="min-w-0 flex-1 rounded-control border border-border-strong bg-surface px-2.5 py-1.5 text-ui outline-none focus:border-accent pointer-coarse:text-body"
              placeholder="https://"
              inputMode="url"
            />
            <Button type="submit" variant="primary" size="sm">
              {current ? "Update" : "Add"}
            </Button>
            {current && (
              <Button
                variant="ghostDanger"
                size="sm"
                className="px-2"
                onClick={() => {
                  chain()?.extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove
              </Button>
            )}
          </form>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
