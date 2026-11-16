import { Keyboard } from "lucide-react";
import { Popover as RadixPopover } from "radix-ui";
import type { ReactNode } from "react";
import { floatingPanelClass } from "../../../components/ui/popover";
import { Tooltip } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/cn";
import { keepCaret, MOD, SHIFT, toolSquareClass } from "./tools";

/**
 * The cheat sheet behind the keyboard button: what to type at the start of a
 * line, inside text and on the keyboard. This is where she learns "# " and
 * "**bold**" without reading any docs.
 */

const LINE_STARTS: Array<[string, string]> = [
  ["# ", "Heading 1"],
  ["## ", "Heading 2"],
  ["### ", "Heading 3"],
  ["- ", "Bulleted list"],
  ["1. ", "Numbered list"],
  ["[] ", "Checklist"],
  ["> ", "Quote"],
  ["!! ", "Warning callout"],
  ["?? ", "Tip callout"],
  ["--- ⏎", "Divider"],
  ["/", "Any block"],
];

const IN_TEXT: Array<[string, ReactNode]> = [
  ["**bold**", <strong key="b">bold</strong>],
  ["*italic*", <em key="i">italic</em>],
  ["`code`", <code key="c">code</code>],
  ["~~strike~~", <s key="s">strike</s>],
  [
    "==highlight==",
    <mark key="h" className="doc-hl">
      highlight
    </mark>,
  ],
];

const KEYS: Array<[string, string]> = [
  [`${MOD}B`, "Bold"],
  [`${MOD}I`, "Italic"],
  [`${MOD}U`, "Underline"],
  [`${MOD}${SHIFT}S`, "Strikethrough"],
  [`${MOD}E`, "Code"],
  [`${MOD}${SHIFT}H`, "Highlight"],
  ["Tab", "Indent a list item"],
  [`${SHIFT}Tab`, "Outdent"],
  [`${MOD}Z`, "Undo"],
  [`${SHIFT}${MOD}Z`, "Redo"],
  ["Esc", "Stop editing the block"],
];

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-7 rounded-inline border border-border-strong border-b-2 bg-surface px-1.5 py-px text-center font-mono text-caption whitespace-nowrap text-text">
      {children}
    </kbd>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="m-0 mb-1.5 text-caption font-semibold tracking-[0.06em] text-text-muted uppercase">
        {title}
      </h3>
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-label">
        {children}
      </dl>
    </section>
  );
}

export function ShortcutList() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="shortcut-list">
      <Section title="Start a line with">
        {LINE_STARTS.map(([keys, what]) => (
          <div key={keys} className="contents">
            <dt>
              <Kbd>{keys}</Kbd>
            </dt>
            <dd className="m-0">{what}</dd>
          </div>
        ))}
      </Section>
      <div className="grid content-start gap-4">
        <Section title="While typing">
          {IN_TEXT.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd className="m-0">{what}</dd>
            </div>
          ))}
        </Section>
        <Section title="Keys">
          {KEYS.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd className="m-0">{what}</dd>
            </div>
          ))}
        </Section>
      </div>
    </div>
  );
}

/** The keyboard button and its popover. */
export function ShortcutHelp({ tooltips = true }: { tooltips?: boolean }) {
  const trigger = (
    <RadixPopover.Trigger asChild>
      <button
        type="button"
        aria-label="Typing shortcuts"
        data-testid="shortcut-help"
        onMouseDown={keepCaret}
        className={cn(
          toolSquareClass,
          "text-text-muted hover:bg-surface-muted hover:text-text data-[state=open]:bg-surface-muted",
        )}
      >
        <Keyboard />
      </button>
    </RadixPopover.Trigger>
  );
  return (
    <RadixPopover.Root>
      {tooltips ? <Tooltip content="Typing shortcuts">{trigger}</Tooltip> : trigger}
      <RadixPopover.Portal>
        <RadixPopover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Typing shortcuts"
          // A cheat sheet to glance at while typing: the caret stays in the text.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            floatingPanelClass,
            "max-h-[min(80vh,var(--radix-popover-content-available-height))] w-[min(36rem,calc(100vw-24px))] overflow-y-auto p-4",
          )}
        >
          <p className="m-0 mb-3 text-ui font-semibold">Shortcuts</p>
          <ShortcutList />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
