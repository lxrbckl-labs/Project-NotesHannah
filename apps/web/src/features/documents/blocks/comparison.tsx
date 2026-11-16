import { BLOCK_LIMITS, type BlockOf, type CitedText, type RichText } from "@notes/schema";
import { useActions } from "../context";
import { toneVars } from "../ui/hooks";
import { cx } from "../ui/primitives";
import { CitedEntry } from "./cited";
import { AddButton, PlainInput, RemoveButton, useBlockEdit } from "./common";

type Comparison = BlockOf<"comparison_table">;
const empty = (): CitedText => ({ text: [], citations: [], flags: [] });

/**
 * Comparison table (D5): drugs down the side, attributes across. On a phone
 * it scrolls sideways with the drug column pinned.
 */
export function ComparisonBlock({ block }: { block: Comparison }) {
  const { editing, active, patch } = useBlockEdit(block);
  const { openConcept } = useActions();
  const { title, attributes, rows } = block.content;
  const tools = editing && active;
  const tone = block.style?.color ?? "blue";

  const setCell = (r: number, c: number, text: RichText) =>
    patch(
      {
        rows: rows.map((row, i) =>
          i === r
            ? { ...row, cells: row.cells.map((cell, j) => (j === c ? { ...cell, text } : cell)) }
            : row,
        ),
      },
      "Edit comparison",
    );
  const setAttribute = (c: number, value: string) =>
    patch({ attributes: attributes.map((a, j) => (j === c ? value : a)) }, "Rename attribute");
  const setSubject = (r: number, subject: string) =>
    patch({ rows: rows.map((row, i) => (i === r ? { ...row, subject } : row)) }, "Rename row");
  const addRow = () =>
    patch(
      { rows: [...rows, { subject: `Drug ${rows.length + 1}`, cells: attributes.map(empty) }] },
      "Add row",
    );
  const removeRow = (r: number) => patch({ rows: rows.filter((_, i) => i !== r) }, "Remove row");
  const addAttribute = () =>
    patch(
      {
        attributes: [...attributes, `Attribute ${attributes.length + 1}`],
        rows: rows.map((row) => ({ ...row, cells: [...row.cells, empty()] })),
      },
      "Add attribute",
    );
  const removeAttribute = (c: number) =>
    patch(
      {
        attributes: attributes.filter((_, j) => j !== c),
        rows: rows.map((row) => ({ ...row, cells: row.cells.filter((_, j) => j !== c) })),
      },
      "Remove attribute",
    );

  return (
    <figure className="doc-tone m-0" style={toneVars(tone)} data-testid="comparison-table">
      {(title || tools) && (
        <figcaption className="mb-2 text-[15px] font-semibold">
          {tools ? (
            <PlainInput
              value={title ?? ""}
              label="Comparison title"
              placeholder="Title (optional)"
              onCommit={(value) => patch({ title: value || undefined }, "Edit title")}
            />
          ) : (
            title
          )}
        </figcaption>
      )}
      <div
        className="doc-scroll-x rounded-2xl border border-border bg-surface"
        data-testid="comparison-scroll"
      >
        <table className="w-full min-w-max border-separate border-spacing-0 text-[14.5px] leading-snug">
          <thead>
            <tr>
              <th
                scope="col"
                className="doc-sticky-col min-w-32 border-b border-[var(--t-border)] bg-[var(--t-bg)] px-3.5 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-fg)]"
              >
                <span className="sr-only">Drug</span>
              </th>
              {attributes.map((attribute, c) => (
                <th
                  // biome-ignore lint/suspicious/noArrayIndexKey: attributes are positional
                  key={c}
                  scope="col"
                  className="min-w-36 max-w-64 border-b border-l border-[var(--t-border)] border-l-border/60 bg-[var(--t-bg)] px-3.5 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-fg)]"
                >
                  {tools ? (
                    <span className="flex items-center gap-1">
                      <PlainInput
                        value={attribute}
                        required
                        label={`Attribute ${c + 1}`}
                        onCommit={(v) => setAttribute(c, v)}
                      />
                      {attributes.length > 1 && (
                        <RemoveButton
                          label={`Remove ${attribute}`}
                          onClick={() => removeAttribute(c)}
                        />
                      )}
                    </span>
                  ) : (
                    attribute
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
              <tr key={r} className="group/row">
                <th
                  scope="row"
                  className={cx(
                    "doc-sticky-col border-r border-border/60 bg-surface px-3.5 py-3 text-left align-top font-semibold shadow-[1px_0_0_var(--color-border)]",
                    r > 0 && "border-t border-t-border/60",
                  )}
                >
                  {tools ? (
                    <span className="flex items-center gap-1">
                      <PlainInput
                        value={row.subject}
                        required
                        label={`Row ${r + 1} name`}
                        onCommit={(v) => setSubject(r, v)}
                      />
                      {rows.length > 2 && (
                        <RemoveButton
                          label={`Remove ${row.subject}`}
                          onClick={() => removeRow(r)}
                        />
                      )}
                    </span>
                  ) : row.concept ? (
                    <button
                      type="button"
                      className="doc-concept text-left"
                      onClick={() => openConcept(row.concept as string)}
                    >
                      {row.subject}
                    </button>
                  ) : (
                    row.subject
                  )}
                </th>
                {row.cells.map((cell, c) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                    key={c}
                    className={cx(
                      "max-w-64 border-l border-border/60 px-3.5 py-3 align-top",
                      r > 0 && "border-t border-t-border/60",
                    )}
                  >
                    <CitedEntry
                      block={block}
                      field={`rows.${r}.cells.${c}`}
                      value={cell}
                      editing={editing}
                      label={`${row.subject}, ${attributes[c] ?? ""}`}
                      onCommit={(text) => setCell(r, c, text)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tools && (
        <div className="mt-2 flex flex-wrap gap-2">
          {rows.length < BLOCK_LIMITS.comparisonRows && (
            <AddButton onClick={addRow} testId="add-comparison-row">
              Row
            </AddButton>
          )}
          {attributes.length < BLOCK_LIMITS.comparisonColumns && (
            <AddButton onClick={addAttribute} testId="add-attribute">
              Attribute
            </AddButton>
          )}
        </div>
      )}
    </figure>
  );
}
