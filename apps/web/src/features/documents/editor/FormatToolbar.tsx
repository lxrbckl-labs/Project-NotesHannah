import { COLOR_TOKENS } from "@notes/schema";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Check,
  Code,
  Highlighter,
  Italic,
  Link2,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { Popover as RadixPopover } from "radix-ui";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../../../components/ui/button";
import { floatingPanelClass } from "../../../components/ui/popover";
import { cn } from "../../../lib/cn";
import { useActions, useSignal } from "../context";
import { useKeyboardInset } from "../ui/hooks";

function ToolButton({
  label,
  active,
  onPress,
  children,
  shortcut,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  children: ReactNode;
  shortcut?: string;
}) {
  return (
    <IconButton
      label={shortcut ? `${label} (${shortcut})` : label}
      pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className="[&_svg]:size-4"
    >
      {children}
    </IconButton>
  );
}

function Tools({ editor, touch }: { editor: Editor; touch: boolean }) {
  const actions = useActions();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight:
        (e.getAttributes("highlight").color as string | undefined) ??
        (e.isActive("highlight") ? "yellow" : null),
      link: (e.getAttributes("link").href as string | undefined) ?? null,
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const chain = () => editor.chain().focus();
  const mod =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <>
      <ToolButton
        label="Bold"
        shortcut={`${mod}B`}
        active={state.bold}
        onPress={() => chain().toggleBold().run()}
      >
        <Bold />
      </ToolButton>
      <ToolButton
        label="Italic"
        shortcut={`${mod}I`}
        active={state.italic}
        onPress={() => chain().toggleItalic().run()}
      >
        <Italic />
      </ToolButton>
      <ToolButton
        label="Underline"
        shortcut={`${mod}U`}
        active={state.underline}
        onPress={() => chain().toggleUnderline().run()}
      >
        <Underline />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={state.strike}
        onPress={() => chain().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolButton>
      <ToolButton label="Code" active={state.code} onPress={() => chain().toggleCode().run()}>
        <Code />
      </ToolButton>
      <RadixPopover.Root>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label="Highlight colour"
            onMouseDown={(e) => e.preventDefault()}
            data-hue={state.highlight ?? undefined}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-(--duration-instant) xl:size-9 [&_svg]:size-4",
              state.highlight ? "bg-tone-mark text-text" : "text-text-muted hover:bg-surface-muted",
            )}
          >
            <Highlighter />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            side={touch ? "top" : "bottom"}
            sideOffset={8}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            className={cn(floatingPanelClass, "grid grid-cols-6 gap-1.5 p-2")}
            aria-label="Highlight colours"
          >
            {COLOR_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                aria-label={`${token} highlight`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chain().setMark("highlight", { color: token }).run()}
                data-hue={token}
                className="flex size-8 items-center justify-center rounded-control border border-tone-border bg-tone-mark pointer-coarse:size-11"
              >
                {state.highlight === token && <Check aria-hidden className="size-3.5" />}
              </button>
            ))}
            <button
              type="button"
              aria-label="No highlight"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => chain().unsetMark("highlight").run()}
              className="flex size-8 items-center justify-center rounded-control border border-border-strong text-caption text-text-muted pointer-coarse:size-11"
            >
              None
            </button>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
      <RadixPopover.Root
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (open) setHref(state.link ?? "https://");
        }}
      >
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label="Link"
            aria-pressed={Boolean(state.link)}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-control transition-colors duration-(--duration-instant) xl:size-9 [&_svg]:size-4",
              state.link
                ? "bg-accent text-accent-contrast"
                : "text-text-muted hover:bg-surface-muted hover:text-text",
            )}
          >
            <Link2 />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            side={touch ? "top" : "bottom"}
            sideOffset={8}
            collisionPadding={12}
            className={cn(floatingPanelClass, "flex w-[min(20rem,calc(100vw-24px))] gap-1.5 p-2")}
          >
            <form
              className="flex flex-1 gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const url = href.trim();
                if (/^https?:\/\/\S+\.\S+/.test(url))
                  chain().extendMarkRange("link").setLink({ href: url }).run();
                else if (!url) chain().extendMarkRange("link").unsetLink().run();
                setLinkOpen(false);
              }}
            >
              <input
                aria-label="Link address"
                value={href}
                onChange={(e) => setHref(e.target.value)}
                className="min-w-0 flex-1 rounded-control bg-surface-muted px-2.5 py-1.5 text-ui outline-none pointer-coarse:text-body"
                placeholder="https://"
                inputMode="url"
              />
              <Button type="submit" variant="primary" size="sm">
                {state.link ? "Update" : "Add"}
              </Button>
              {state.link && (
                <Button
                  variant="ghostDanger"
                  size="sm"
                  className="px-2"
                  onClick={() => {
                    chain().extendMarkRange("link").unsetLink().run();
                    setLinkOpen(false);
                  }}
                >
                  Remove
                </Button>
              )}
            </form>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
      {touch && (
        <>
          <span aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-border" />
          <ToolButton label="Undo" onPress={() => actions.controller.undo()}>
            <Undo2 />
          </ToolButton>
          <ToolButton label="Redo" onPress={() => actions.controller.redo()}>
            <Redo2 />
          </ToolButton>
          <Button
            variant="ghostAccent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.commands.blur()}
            className="ml-auto shrink-0 font-semibold"
          >
            Done
          </Button>
        </>
      )}
    </>
  );
}

/**
 * Text formatting: floating above the selection on a computer, docked
 * above the on-screen keyboard on touch.
 */
export function FormatToolbar({ touch }: { touch: boolean }) {
  const actions = useActions();
  const editor = useSignal(actions.activeEditor, (e) => e);
  const inset = useKeyboardInset();
  const selection = useEditorState({
    editor,
    selector: (ctx) => {
      const e = ctx.editor;
      if (!e) return null;
      const { from, to, empty } = e.state.selection;
      return { from, to, empty, focused: e.isFocused };
    },
  });
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (touch || !editor || !selection || selection.empty) {
      setPos(null);
      return;
    }
    try {
      const start = editor.view.coordsAtPos(selection.from);
      const end = editor.view.coordsAtPos(selection.to);
      const width = 330;
      const left = Math.max(
        8,
        Math.min((start.left + end.left) / 2 - width / 2, window.innerWidth - width - 8),
      );
      const top = start.top - 52 < 8 ? end.bottom + 8 : start.top - 52;
      setPos({ top, left });
    } catch {
      setPos(null);
    }
  }, [editor, selection, touch]);

  useEffect(() => {
    if (!editor) setPos(null);
  }, [editor]);

  if (!editor || editor.isDestroyed) return null;
  if (touch) {
    if (!selection?.focused) return null;
    return createPortal(
      <div
        role="toolbar"
        aria-label="Text formatting"
        data-testid="format-toolbar"
        className="fixed inset-x-0 z-(--z-dock) flex items-center gap-0.5 overflow-x-auto border-t border-border bg-(--color-chrome) px-2 py-1 pb-[max(4px,env(safe-area-inset-bottom))] text-text shadow-pop backdrop-blur"
        style={{ bottom: inset }}
      >
        <Tools editor={editor} touch />
      </div>,
      document.body,
    );
  }
  if (!pos) return null;
  return createPortal(
    <div
      role="toolbar"
      aria-label="Text formatting"
      data-testid="format-toolbar"
      className="anim-pop fixed z-(--z-dock) flex items-center gap-0.5 rounded-card border border-border bg-surface p-1 text-text shadow-pop"
      style={{ top: pos.top, left: pos.left }}
    >
      <Tools editor={editor} touch={false} />
    </div>,
    document.body,
  );
}
