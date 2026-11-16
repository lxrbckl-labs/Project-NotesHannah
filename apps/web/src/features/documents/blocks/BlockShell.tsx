import {
  BLOCK_REGISTRY,
  type Block,
  blockPlainText,
  CALLOUT_KINDS,
  COLOR_TOKENS,
  type ColorToken,
  citationKey,
  isBlockType,
  newId,
} from "@notes/schema";
import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  Check,
  ChevronRight,
  CircleCheck,
  Copy,
  GripVertical,
  MessageCircleQuestion,
  MessageSquarePlus,
  Palette,
  PenLine,
  Plus,
  Repeat2,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { memo, type ReactNode, useState } from "react";
import { IconButton } from "../../../components/ui/button";
import { menuContentClass, menuItemClass, menuSeparatorClass } from "../../../components/ui/menu";
import { Popover } from "../../../components/ui/popover";
import { cn } from "../../../lib/cn";
import { AddReferenceDialog } from "../../references/AddReferenceDialog";
import { useActions, useSignal, useView } from "../context";
import {
  deleteBlocks,
  duplicateBlock,
  moveBy,
  setStyle,
  turnInto,
  turnIntoTargets,
} from "../model/gestures";
import { looseFlags } from "../model/references";
import type { RequestKind } from "../store/types";
import { formatWhen } from "../ui/hooks";
import { FlagIndicator, GeneralKnowledgeTag } from "./cited";
import { NoteGutter } from "./noteGutter";
import { OutsideRefsRow } from "./outside";
import { CiteChip } from "./RichText";
import { BlockBoundary, BlockContent } from "./registry";
import { CALLOUT_META } from "./text";

export const REQUEST_LABELS: Record<RequestKind, string> = {
  wrong: "This is wrong",
  unclear: "This is unclear",
  expand: "Explain more",
  make_questions: "Make questions from this",
};

function actorName(actor: Block["provenance"]["lastEditedBy"]): string {
  return actor.type === "user" ? "you" : (actor.label ?? "an agent");
}

/** Who wrote and last changed a block (D11). */
export function Provenance({ block }: { block: Block }) {
  const p = block.provenance;
  return (
    <div className="flex flex-col gap-1 text-label">
      <p className="m-0">
        Written by <strong className="font-semibold">{actorName(p.createdBy)}</strong> ·{" "}
        {formatWhen(p.createdAt)}
      </p>
      {p.lastEditedAt !== p.createdAt && (
        <p className="m-0">
          Last edited by <strong className="font-semibold">{actorName(p.lastEditedBy)}</strong> ·{" "}
          {formatWhen(p.lastEditedAt)}
        </p>
      )}
      <p className="m-0 text-text-muted">
        {block.origin === "user"
          ? "Your words: regenerating this document leaves this block alone."
          : block.review.status === "reviewed"
            ? "Reviewed by you, so agents leave it alone."
            : "Written by an agent and not yet checked by you."}
      </p>
    </div>
  );
}

const COLOURABLE: string[] = [
  "paragraph",
  "heading",
  "callout",
  "quote",
  "drug_card",
  "comparison_table",
  "mnemonic",
];

/*
 * The block menu has custom content (colour swatches, who wrote the block), so it is composed
 * from Radix DropdownMenu with the shared menu classes rather than built from ActionMenu entries.
 */
function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      {...(disabled ? { disabled } : {})}
      {...(onSelect ? { onSelect } : {})}
      className={menuItemClass(danger)}
    >
      <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex-1">{children}</span>
    </DropdownMenu.Item>
  );
}

function MenuSub({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={menuItemClass()}>
        <span className="flex size-5 items-center justify-center text-text-muted [&_svg]:size-4">
          {icon}
        </span>
        <span className="flex-1">{label}</span>
        <ChevronRight size={16} aria-hidden className="text-text-muted" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} collisionPadding={12} className={menuContentClass}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function MenuSeparator() {
  return <DropdownMenu.Separator className={menuSeparatorClass} />;
}

function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-3 py-1.5 text-xs font-medium text-text-muted">
      {children}
    </DropdownMenu.Label>
  );
}

/** A submenu on a computer; on a narrow touch screen its items are shown in place. */
function Section({
  touch,
  label,
  icon,
  children,
}: {
  touch: boolean;
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  if (!touch)
    return (
      <MenuSub label={label} icon={icon}>
        {children}
      </MenuSub>
    );
  return (
    <>
      <MenuSeparator />
      <MenuLabel>{label}</MenuLabel>
      {children}
    </>
  );
}

function BlockMenu({
  block,
  trigger,
  index,
  count,
  open,
  onOpenChange,
}: {
  block: Block;
  trigger: ReactNode;
  index: number;
  count: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const actions = useActions();
  const { documentId, perform, controller } = actions;
  const targets = isBlockType(block.type) ? turnIntoTargets(block) : [];
  const reviewed = block.review.status === "reviewed";
  const colorable = COLOURABLE.includes(block.type);
  const order = actions.docRef.current?.blockIds ?? [];
  const { isTouch } = useView();
  const [addingRef, setAddingRef] = useState(false);
  const outside = block.references ?? [];
  const setReferences = (references: NonNullable<Block["references"]>, label: string) =>
    perform(
      [
        {
          call: {
            operation: "update_block",
            input: { mode: "patch", documentId, blockId: block.id, patch: { references } },
          },
        },
      ],
      label,
    );
  return (
    <>
      <AddReferenceDialog
        open={addingRef}
        onOpenChange={setAddingRef}
        onPick={(picked) => {
          setAddingRef(false);
          setReferences(
            [...outside.filter((r) => r.url !== picked.url), picked].slice(-5),
            "Add a reference",
          );
        }}
      />
      <DropdownMenu.Root
        modal={false}
        {...(open !== undefined ? { open } : {})}
        {...(onOpenChange ? { onOpenChange } : {})}
      >
        <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Block actions"
            className={cn(menuContentClass, "min-w-56")}
          >
            {targets.length > 0 && (
              <Section touch={isTouch} label="Turn into" icon={<Repeat2 />}>
                {targets.map((type) => (
                  <MenuItem
                    key={type}
                    onSelect={() => perform(turnInto(documentId, block, type), "Turn into")}
                  >
                    {BLOCK_REGISTRY[type].label}
                  </MenuItem>
                ))}
              </Section>
            )}
            {block.type === "callout" && (
              <Section
                touch={isTouch}
                label="Callout kind"
                icon={CALLOUT_META[block.content.kind].icon}
              >
                {CALLOUT_KINDS.map((kind) => (
                  <MenuItem
                    key={kind}
                    icon={block.content.kind === kind ? <Check /> : CALLOUT_META[kind].icon}
                    onSelect={() =>
                      perform(
                        [
                          {
                            call: {
                              operation: "update_block",
                              input: {
                                mode: "patch",
                                documentId,
                                blockId: block.id,
                                patch: { content: { kind } },
                              },
                            },
                          },
                        ],
                        "Callout kind",
                      )
                    }
                  >
                    {CALLOUT_META[kind].label}
                  </MenuItem>
                ))}
              </Section>
            )}
            {colorable && isTouch && (
              <>
                <MenuSeparator />
                <MenuLabel>Colour</MenuLabel>
                <fieldset className="m-0 grid grid-cols-6 gap-1.5 border-0 px-3 pt-0 pb-2">
                  <legend className="sr-only">Colour</legend>
                  <button
                    type="button"
                    aria-label="Default colour"
                    className="flex size-11 items-center justify-center rounded-control border border-border-strong"
                    onClick={() => {
                      perform(setStyle(documentId, block.id, null), "Colour");
                      onOpenChange?.(false);
                    }}
                  >
                    {!block.style && <Check aria-hidden className="size-4" />}
                  </button>
                  {COLOR_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      aria-label={`${token} colour`}
                      data-hue={token}
                      className="flex size-11 items-center justify-center rounded-control border border-tone-border bg-tone-solid text-surface"
                      onClick={() => {
                        perform(setStyle(documentId, block.id, { color: token }), "Colour");
                        onOpenChange?.(false);
                      }}
                    >
                      {block.style?.color === token && <Check aria-hidden className="size-4" />}
                    </button>
                  ))}
                </fieldset>
              </>
            )}
            {colorable && !isTouch && (
              <MenuSub label="Colour" icon={<Palette />}>
                <MenuItem
                  icon={
                    !block.style ? (
                      <Check />
                    ) : (
                      <span className="size-3.5 rounded-pill border border-border-strong" />
                    )
                  }
                  onSelect={() => perform(setStyle(documentId, block.id, null), "Colour")}
                >
                  Default
                </MenuItem>
                {COLOR_TOKENS.map((token: ColorToken) => (
                  <MenuItem
                    key={token}
                    icon={
                      block.style?.color === token ? (
                        <Check />
                      ) : (
                        <span data-hue={token} className="size-3.5 rounded-pill bg-tone-solid" />
                      )
                    }
                    onSelect={() =>
                      perform(setStyle(documentId, block.id, { color: token }), "Colour")
                    }
                  >
                    <span className="capitalize">{token}</span>
                  </MenuItem>
                ))}
                {block.type === "paragraph" && (
                  <>
                    <MenuSeparator />
                    <MenuLabel>Background</MenuLabel>
                    {(["yellow", "blue", "green", "purple", "gray"] as const).map((token) => (
                      <MenuItem
                        key={token}
                        icon={
                          <span
                            data-hue={token}
                            className="size-3.5 rounded-inline border border-tone-border bg-tone-soft"
                          />
                        }
                        onSelect={() =>
                          perform(
                            setStyle(documentId, block.id, {
                              ...(block.style ?? {}),
                              background: token,
                            }),
                            "Background",
                          )
                        }
                      >
                        <span className="capitalize">{token} background</span>
                      </MenuItem>
                    ))}
                  </>
                )}
              </MenuSub>
            )}
            <MenuItem
              icon={<Copy />}
              onSelect={() =>
                perform(duplicateBlock(documentId, block, newId("block")), "Duplicate")
              }
            >
              Duplicate
            </MenuItem>
            <MenuItem
              icon={<ArrowUp />}
              disabled={index === 0}
              onSelect={() => {
                const calls = moveBy(documentId, order, block.id, -1);
                if (calls) perform(calls, "Move up");
              }}
            >
              Move up
            </MenuItem>
            <MenuItem
              icon={<ArrowDown />}
              disabled={index === count - 1}
              onSelect={() => {
                const calls = moveBy(documentId, order, block.id, 1);
                if (calls) perform(calls, "Move down");
              }}
            >
              Move down
            </MenuItem>
            <MenuSeparator />
            {block.type !== "divider" &&
              (reviewed ? (
                <MenuItem
                  icon={<RotateCcw />}
                  onSelect={() => controller.review("unverified", [block.id])}
                >
                  Mark as not reviewed
                </MenuItem>
              ) : (
                <MenuItem
                  icon={<CircleCheck />}
                  onSelect={() => controller.review("reviewed", [block.id])}
                >
                  Mark as reviewed
                </MenuItem>
              ))}
            <MenuItem icon={<MessageCircleQuestion />} onSelect={() => actions.askAbout(block.id)}>
              Ask about this…
            </MenuItem>
            <MenuItem
              icon={<MessageSquarePlus />}
              onSelect={() => actions.sideNotes.compose(block.id)}
            >
              Add a side note
            </MenuItem>
            {block.type !== "divider" && (
              <MenuItem icon={<BookMarked />} onSelect={() => setAddingRef(true)}>
                Add a reference…
              </MenuItem>
            )}
            {outside.length > 0 && (
              <MenuItem
                icon={<BookMarked />}
                onSelect={() => setReferences([], "Remove references")}
              >
                Remove its references
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 />}
              danger
              onSelect={() => perform(deleteBlocks(documentId, [block.id]), "Delete block")}
            >
              Delete
            </MenuItem>
            <MenuSeparator />
            <div className="px-3 py-2">
              <Provenance block={block} />
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}

function SourcesRow({ block }: { block: Block }) {
  const unique = block.citations.filter(
    (c, i) => block.citations.findIndex((d) => citationKey(d) === citationKey(c)) === i,
  );
  if (unique.length === 0) return null;
  return (
    <span
      className="inline-flex flex-wrap items-center gap-x-1 gap-y-1"
      data-testid="block-sources"
    >
      <span className="mr-0.5 text-caption font-medium text-text-muted">
        {unique.length === 1 ? "Source" : "Sources"}
      </span>
      {unique.map((citation) => (
        <CiteChip key={citationKey(citation)} citation={citation} label />
      ))}
    </span>
  );
}

/** A block with its trust signals (D10, D11, K3, K4) and, when editing, its handles and menu. */
export const BlockShell = memo(function BlockShell({
  block,
  index,
  count,
}: {
  block: Block;
  index: number;
  count: number;
}) {
  const actions = useActions();
  const { editing, isTouch } = useView();
  const active = useSignal(actions.active, (id) => id === block.id);
  // A Resources entry under the pointer lights its block up, and the other way round.
  const linked = useSignal(actions.hovered, (id) => id === block.id);
  const unverified = block.review.status === "unverified" && block.type !== "divider";
  const byAgent = block.provenance.lastEditedBy.type === "agent";
  const loose = looseFlags(block.flags ?? [], [
    isBlockType(block.type) ? blockPlainText(block) : "",
  ]);
  const [menuOpen, setMenuOpen] = useState(false);
  const style = block.style;
  const textual = block.type === "paragraph" || block.type === "heading";
  const showFooter =
    block.citations.length > 0 ||
    (block.references?.length ?? 0) > 0 ||
    block.generalKnowledge ||
    loose.length > 0 ||
    unverified;

  const addAfter = (anchor: DOMRect | null) => actions.openInsertMenu(block.id, false, anchor);

  return (
    <div
      data-block-id={block.id}
      data-testid="block"
      data-type={block.type}
      data-review={block.review.status}
      data-active={active ? "true" : undefined}
      data-linked={linked ? "true" : undefined}
      className={cn(
        "doc-block group/block relative scroll-mt-24",
        block.type === "heading" ? "mt-7 mb-1 first:mt-0" : "my-2.5",
        // An invisible strip in the left margin keeps the hover alive on the way from the
        // text to the + and the handle, so they do not blink out halfway.
        editing &&
          !isTouch &&
          "before:absolute before:inset-y-0 before:right-full before:w-6 before:content-['']",
      )}
      onPointerDownCapture={() => {
        if (editing && !active) actions.setActive(block.id);
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") actions.hovered.set(block.id);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse" && actions.hovered.get() === block.id)
          actions.hovered.set(null);
      }}
    >
      <NoteGutter blockId={block.id} />
      {/* Who last edited: a slim bar in the left margin; tap for details. */}
      <Popover
        label="Who wrote this"
        side="right"
        align="start"
        trigger={
          <button
            type="button"
            data-testid="provenance"
            aria-label={`${unverified ? "Not yet reviewed. " : ""}Last edited by ${actorName(block.provenance.lastEditedBy)}`}
            className={cn(
              "absolute top-1 bottom-1 -left-3 w-1 rounded-pill after:absolute after:-inset-x-1.5 after:inset-y-0 after:content-[''] md:-left-4",
              unverified
                ? "bg-warning-solid"
                : byAgent
                  ? "bg-hue-purple-solid/25"
                  : "bg-transparent hover:bg-hue-green-solid/30",
            )}
          />
        }
      >
        <div className="flex gap-2.5">
          {byAgent ? (
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-hue-purple-solid" />
          ) : (
            <PenLine aria-hidden className="mt-0.5 size-4 shrink-0 text-hue-green-solid" />
          )}
          <Provenance block={block} />
        </div>
      </Popover>

      {/* Computer: hover gutter with + and the drag handle / menu. */}
      {editing && !isTouch && (
        <div
          className={cn(
            // Out of the flow and only faded in: hovering never moves the text.
            "absolute top-0 right-[calc(100%+1.125rem)] flex items-center gap-0.5 pl-2 opacity-0 transition-opacity duration-(--duration-fast) group-hover/block:opacity-100 focus-within:opacity-100",
            // Level with the first line of text.
            block.type === "heading" && block.content.level === 1 ? "h-9" : "h-8",
            (active || menuOpen) && "opacity-100",
          )}
        >
          <IconButton
            label="Insert a block below"
            size="sm"
            onClick={(e) => addAfter(e.currentTarget.getBoundingClientRect())}
          >
            <Plus className="size-4" />
          </IconButton>
          <BlockMenu
            block={block}
            index={index}
            count={count}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <button
                type="button"
                aria-label="Drag to move, or click for block actions"
                data-testid="block-handle"
                className="flex h-7 w-5 cursor-grab items-center justify-center rounded-inline text-text-muted hover:bg-surface-muted active:cursor-grabbing"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  // Keep the menu shut on press: a press may become a drag. A click opens it.
                  e.preventDefault();
                  actions.startDrag(block.id, e.nativeEvent, false);
                }}
                onClick={() => {
                  if (!actions.justDragged()) setMenuOpen(true);
                }}
              >
                <GripVertical className="size-4" />
              </button>
            }
          />
        </div>
      )}

      {/* Touch: actions for the selected block. */}
      {editing && isTouch && active && (
        <div
          className="anim-pop absolute -top-12 right-0 z-(--z-raised) flex items-center gap-0.5 rounded-card border border-border bg-surface p-0.5 shadow-pop"
          data-testid="touch-actions"
        >
          <IconButton
            label="Move up"
            disabled={index === 0}
            onClick={() => {
              const calls = moveBy(
                actions.documentId,
                actions.docRef.current?.blockIds ?? [],
                block.id,
                -1,
              );
              if (calls) actions.perform(calls, "Move up");
            }}
          >
            <ArrowUp className="size-4.5" />
          </IconButton>
          <IconButton
            label="Move down"
            disabled={index === count - 1}
            onClick={() => {
              const calls = moveBy(
                actions.documentId,
                actions.docRef.current?.blockIds ?? [],
                block.id,
                1,
              );
              if (calls) actions.perform(calls, "Move down");
            }}
          >
            <ArrowDown className="size-4.5" />
          </IconButton>
          <button
            type="button"
            aria-label="Press and hold to drag"
            className="flex size-11 touch-none items-center justify-center rounded-control text-text-muted"
            onPointerDown={(e) => actions.startDrag(block.id, e.nativeEvent, true)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <GripVertical className="size-4.5" />
          </button>
          <IconButton
            label="Insert a block below"
            onClick={(e) => addAfter(e.currentTarget.getBoundingClientRect())}
          >
            <Plus className="size-4.5" />
          </IconButton>
          <BlockMenu
            block={block}
            index={index}
            count={count}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <IconButton label="Block actions" data-testid="block-menu-touch">
                <span aria-hidden className="text-lg leading-none">
                  ⋯
                </span>
              </IconButton>
            }
          />
        </div>
      )}

      <div
        className={cn(
          "doc-block-body",
          textual && style?.background && "rounded-control bg-tone-soft px-3 py-1.5",
        )}
        data-hue={style ? (style.color ?? style.background ?? "gray") : undefined}
      >
        <BlockBoundary type={block.type} content={block.content}>
          <BlockContent block={block} />
        </BlockBoundary>
      </div>

      {showFooter && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-label">
          <SourcesRow block={block} />
          <OutsideRefsRow block={block} />
          {block.generalKnowledge && <GeneralKnowledgeTag />}
          {loose.length > 0 && <FlagIndicator flags={loose} />}
          {unverified && (
            <span
              className="ml-auto inline-flex items-center gap-1 rounded-pill border border-warning-border bg-warning-soft py-0.5 pr-0.5 pl-2.5 text-caption font-medium text-warning"
              data-testid="unverified-badge"
            >
              <TriangleAlert aria-hidden className="size-3.5" />
              Unverified
              <button
                type="button"
                data-testid="mark-reviewed"
                onClick={() => actions.controller.review("reviewed", [block.id])}
                className="relative ml-1 inline-flex h-6 items-center gap-1 rounded-pill bg-surface px-2 font-semibold text-text shadow-card transition-colors duration-(--duration-instant) hover:bg-success-soft hover:text-success after:absolute after:-inset-2.5 after:content-['']"
              >
                <Check aria-hidden className="size-3.5" />
                Mark reviewed
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
});
