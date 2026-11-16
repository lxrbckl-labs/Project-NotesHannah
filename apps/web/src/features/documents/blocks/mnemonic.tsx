import { BLOCK_LIMITS, type BlockOf, COLOR_TOKENS, type RichText } from "@notes/schema";
import { Sparkle } from "lucide-react";
import { RichField } from "../editor/RichField";
import { toneVars } from "../ui/hooks";
import { AddButton, Eyebrow, PlainInput, RemoveButton, useBlockEdit } from "./common";

/** A mnemonic (D6): the device large, then each letter with what it stands for. */
export function MnemonicBlock({ block }: { block: BlockOf<"mnemonic"> }) {
  const { editing, active, patch } = useBlockEdit(block);
  const { device, topic, parts, note } = block.content;
  const tools = editing && active;
  const base = block.style?.color;
  const palette = ["purple", "blue", "teal", "green", "orange", "pink", "red", "yellow"] as const;
  const toneFor = (i: number) => base ?? palette[i % palette.length] ?? COLOR_TOKENS[0];
  const setPart = (i: number, value: { key?: string; meaning?: RichText }) =>
    patch({ parts: parts.map((p, j) => (j === i ? { ...p, ...value } : p)) }, "Edit mnemonic");

  return (
    <section
      aria-label={`Mnemonic: ${device}`}
      className="rounded-3xl border border-border bg-surface p-4 shadow-[var(--doc-sheet-shadow)] md:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--doc-purple-bg)] text-[var(--doc-purple-fg)]"
        >
          <Sparkle className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow>Mnemonic</Eyebrow>
          {editing ? (
            <PlainInput
              value={device}
              required
              label="Device"
              className="text-[1.5rem] font-bold tracking-wide"
              onCommit={(v) => patch({ device: v }, "Edit device")}
            />
          ) : (
            <p className="m-0 text-[1.5rem] leading-tight font-bold tracking-[0.04em]">{device}</p>
          )}
          {editing ? (
            <PlainInput
              value={topic ?? ""}
              label="What it helps remember"
              placeholder="What it helps remember"
              className="text-[14px] text-text-muted"
              onCommit={(v) => patch({ topic: v || undefined }, "Edit topic")}
            />
          ) : (
            topic && <p className="m-0 text-[14px] text-text-muted">{topic}</p>
          )}
        </div>
      </div>
      <ol className="mt-4 grid list-none gap-2 p-0 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        {parts.map((part, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
            key={i}
            className="doc-tone flex items-start gap-3 rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-2.5"
            style={toneVars(toneFor(i))}
          >
            <span className="flex min-h-9 min-w-10 max-w-24 shrink-0 items-center justify-center rounded-xl bg-[var(--t-hl)] px-2 py-1 text-[1.25rem] leading-tight font-bold text-[var(--t-fg)]">
              {editing ? (
                <span className="block w-10">
                  <PlainInput
                    value={part.key}
                    required
                    label={`Letter ${i + 1}`}
                    className="text-center"
                    onCommit={(key) => setPart(i, { key })}
                  />
                </span>
              ) : (
                part.key
              )}
            </span>
            <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-snug">
              <RichField
                blockId={block.id}
                field={`parts.${i}`}
                value={part.meaning}
                onCommit={(meaning) => setPart(i, { meaning })}
                block={block}
                flags={block.flags}
                label={`Meaning of ${part.key}`}
                placeholder="What it stands for"
              />
            </div>
            {tools && parts.length > 1 && (
              <RemoveButton
                label={`Remove ${part.key}`}
                onClick={() => patch({ parts: parts.filter((_, j) => j !== i) }, "Remove part")}
              />
            )}
          </li>
        ))}
      </ol>
      {tools && parts.length < BLOCK_LIMITS.mnemonicParts && (
        <div className="mt-2">
          <AddButton
            onClick={() => patch({ parts: [...parts, { key: "?", meaning: [] }] }, "Add part")}
          >
            Letter
          </AddButton>
        </div>
      )}
      {(note?.length || tools) && (
        <div className="mt-3 text-[13.5px] text-text-muted">
          <RichField
            blockId={block.id}
            field="note"
            value={note ?? []}
            onCommit={(value) => patch({ note: value.length ? value : undefined }, "Edit note")}
            block={block}
            label="Mnemonic note"
            placeholder="Note (optional)"
          />
        </div>
      )}
    </section>
  );
}
