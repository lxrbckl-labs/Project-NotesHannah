import { type Block, COLOR_TOKENS } from "@notes/schema";
import { ChevronRight, MoreHorizontal, Palette, Plus, Redo2, Undo2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "../../../components/ui/menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { HUE_LABEL } from "../../../lib/hues";
import { useActions } from "../context";
import { useScrollEdges } from "../ui/hooks";
import { BlockStyleMenu } from "./BlockStyleMenu";
import {
  ActionButtons,
  anchorBlockId,
  type ToolAction,
  useIndentActions,
  useListActions,
  useQuickInserts,
} from "./BlockTools";
import { colourBlock, useCaretTarget } from "./caret";
import { ShortcutHelp } from "./ShortcutHelp";
import {
  BlockColourPicker,
  Divider,
  HighlightPicker,
  keepCaret,
  LinkPicker,
  MarkButtons,
  MOD,
  SHIFT,
  ToolButton,
  useMarks,
} from "./tools";

/** Blocks whose colour the schema keeps (see the block menu's "Colour"). */
const COLOURABLE = new Set([
  "paragraph",
  "heading",
  "callout",
  "quote",
  "drug_card",
  "comparison_table",
  "mnemonic",
]);

/**
 * How many groups fold into "More", from the least used: one-tap inserts,
 * then indent, then the list toggles, then the block color.
 */
const MAX_FOLD = 4;

/** Width of the fade at a cut edge (the same as the shared ScrollCue's). */
const FADE = 28;

/**
 * The formatting ribbon, Word and AFFiNE style: always shown under the
 * document's bar while editing on a tablet or a computer. It reflects the
 * block and the marks where the caret is, and acts on that editor even when a
 * ribbon menu has the focus for a moment. With no text being edited it rests,
 * grayed out, so it still reads as "this page can be formatted".
 */
export function Ribbon({
  blocks,
  canUndo,
  canRedo,
  touch,
}: {
  blocks: readonly Block[];
  canUndo: boolean;
  canRedo: boolean;
  touch: boolean;
}) {
  const actions = useActions();
  const target = useCaretTarget(blocks);
  const { editor, block } = target;
  const marks = useMarks(editor);
  const lists = useListActions(target);
  const indents = useIndentActions(target);
  const quick = useQuickInserts(target);
  const tips = !touch;

  // Fold groups into "More" until the row fits; start over when the space changes.
  const outer = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fold, setFold] = useState(0);
  // Folding everything that folds is still not enough (an upright iPad beside the app's sidebar):
  // the row wraps onto a second line rather than hide tools off the edge.
  const [wrap, setWrap] = useState(false);
  useEffect(() => {
    const el = outer.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      setWidth((w) => (w === next ? w : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fitted = useRef(0);
  useLayoutEffect(() => {
    const el = row.current;
    const box = outer.current;
    if (!el || !box || width === 0) return;
    if (fitted.current !== width) {
      // More or less room: unfold everything and fit again, one group per pass, before paint.
      fitted.current = width;
      if (fold !== 0 || wrap) {
        setFold(0);
        setWrap(false);
        return;
      }
    }
    if (el.scrollWidth > box.clientWidth + 1) {
      if (fold < MAX_FOLD) setFold(fold + 1);
      else if (!wrap) setWrap(true);
    }
  }, [fold, width, wrap]);

  // Should it still be too wide (very narrow), the row scrolls inside itself and the cut edge
  // fades, as the shared ScrollCue does, so a half-shown button reads as "more this way".
  const edges = useScrollEdges(outer);
  const mask =
    edges.start || edges.end
      ? `linear-gradient(to right, ${edges.start ? "transparent 0" : "#000 0"}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.end ? "transparent 100%" : "#000 100%"})`
      : undefined;

  const colourable = Boolean(block && COLOURABLE.has(block.type));
  const colour = block?.style?.color ?? null;
  const pickColour = (token: (typeof COLOR_TOKENS)[number] | null) => {
    if (block) colourBlock(actions, block, token, editor);
  };

  const folded: ToolAction[][] = [];
  if (fold >= 1) folded.push(quick);
  if (fold >= 2) folded.push(indents);
  if (fold >= 3) folded.push(lists);

  const openInsert = (anchor: DOMRect) => {
    const empty = block?.type === "paragraph" && block.content.text.length === 0;
    actions.openInsertMenu(anchorBlockId(actions, block), empty, anchor, "", "plus");
  };

  return (
    <div
      ref={outer}
      role="toolbar"
      aria-label="Formatting"
      data-testid="format-ribbon"
      data-live={editor ? "true" : "false"}
      data-more-start={edges.start}
      data-more-end={edges.end}
      className="relative z-(--z-sticky) shrink-0 overflow-x-auto overscroll-x-contain border-b border-border bg-surface [scrollbar-width:none]"
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      <div
        ref={row}
        data-wrap={wrap ? "true" : undefined}
        className={cn(
          "mx-auto flex items-center gap-0.5 px-2 py-1 md:px-3 xl:py-1.5",
          wrap ? "w-full flex-wrap justify-center" : "w-max",
        )}
      >
        <ToolButton
          label="Undo"
          shortcut={`${MOD}Z`}
          disabled={!canUndo}
          tooltips={tips}
          onPress={() => actions.controller.undo()}
        >
          <Undo2 />
        </ToolButton>
        <ToolButton
          label="Redo"
          shortcut={`${SHIFT}${MOD}Z`}
          disabled={!canRedo}
          tooltips={tips}
          onPress={() => actions.controller.redo()}
        >
          <Redo2 />
        </ToolButton>
        <Divider />
        <BlockStyleMenu target={target} />
        <Divider />
        <MarkButtons editor={editor} marks={marks} tooltips={tips} />
        <Divider />
        <HighlightPicker editor={editor} current={marks.highlight} tooltips={tips} />
        {fold < 4 && (
          <BlockColourPicker
            current={colour}
            onPick={pickColour}
            disabled={!editor || !colourable}
            tooltips={tips}
          />
        )}
        <LinkPicker editor={editor} current={marks.link} tooltips={tips} />
        {fold < 3 && (
          <>
            <Divider />
            <ActionButtons items={lists} tooltips={tips} />
          </>
        )}
        {fold < 2 && <ActionButtons items={indents} tooltips={tips} />}
        <Divider />
        <InsertButton onOpen={openInsert} tooltips={tips} />
        {fold < 1 && <ActionButtons items={quick} tooltips={tips} />}
        {fold > 0 && (
          <MoreMenu
            groups={folded}
            colour={
              fold >= 4
                ? { current: colour, disabled: !editor || !colourable, onPick: pickColour }
                : null
            }
            onClosed={() => {
              if (editor && !editor.isDestroyed && !editor.isFocused) editor.commands.focus();
            }}
          />
        )}
        <Divider />
        <ShortcutHelp tooltips={tips} />
      </div>
    </div>
  );
}

function InsertButton({
  onOpen,
  tooltips,
}: {
  onOpen: (anchor: DOMRect) => void;
  tooltips: boolean;
}) {
  const button = (
    <button
      type="button"
      data-testid="ribbon-insert"
      onMouseDown={keepCaret}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-control border border-border-strong bg-surface pr-3 pl-2 text-ui font-medium text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted xl:min-h-9"
    >
      <Plus aria-hidden className="size-4 text-accent" strokeWidth={2.5} />
      Insert
    </button>
  );
  return tooltips ? (
    <Tooltip content="Table, image, callout, drug card and more">{button}</Tooltip>
  ) : (
    button
  );
}

/** What did not fit, as a menu. */
function MoreMenu({
  groups,
  colour,
  onClosed,
}: {
  groups: ToolAction[][];
  colour: {
    current: string | null;
    disabled: boolean;
    onPick: (token: (typeof COLOR_TOKENS)[number] | null) => void;
  } | null;
  onClosed: () => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <Tooltip content="More formatting">
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="More formatting"
            data-testid="ribbon-more"
            onMouseDown={keepCaret}
            className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors duration-(--duration-instant) hover:bg-surface-muted hover:text-text data-[state=open]:bg-surface-muted xl:size-9 [&_svg]:size-[18px]"
          >
            <MoreHorizontal />
          </button>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label="More formatting"
          className={cn(menuContentClass, "min-w-56")}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onClosed();
          }}
        >
          {colour && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={menuItemClass()} disabled={colour.disabled}>
                <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
                  <Palette />
                </span>
                <span className="flex-1">Block color</span>
                <ChevronRight aria-hidden className="size-4 text-text-muted" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={4}
                  collisionPadding={12}
                  className={menuContentClass}
                >
                  <DropdownMenu.Item
                    className={menuItemClass()}
                    onSelect={() => colour.onPick(null)}
                  >
                    <span className="size-3.5 rounded-pill border border-border-strong" />
                    Default
                  </DropdownMenu.Item>
                  {COLOR_TOKENS.map((token) => (
                    <DropdownMenu.Item
                      key={token}
                      className={menuItemClass()}
                      onSelect={() => colour.onPick(token)}
                    >
                      <span data-hue={token} className="size-3.5 rounded-pill bg-tone-solid" />
                      <span className="flex-1">{HUE_LABEL[token]}</span>
                      {colour.current === token && (
                        <span className="text-caption text-text-muted">Now</span>
                      )}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}
          {groups.map((group, g) => (
            <div key={group[0]?.id ?? g}>
              {(g > 0 || colour) && <DropdownMenu.Separator className={menuSeparatorClass} />}
              {group.map((item) => (
                <DropdownMenu.Item
                  key={item.id}
                  disabled={item.disabled}
                  className={menuItemClass()}
                  onSelect={item.run}
                  data-testid={`more-${item.id}`}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center [&_svg]:size-4",
                      item.pressed ? "text-accent" : "text-text-muted",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <kbd className="text-caption text-text-muted">{item.shortcut}</kbd>
                  )}
                </DropdownMenu.Item>
              ))}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
