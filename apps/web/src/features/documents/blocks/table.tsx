import type { BlockOf, RichText } from "@notes/schema";
import { BLOCK_LIMITS } from "@notes/schema";
import { cn } from "../../../lib/cn";
import { RichField } from "../editor/RichField";
import { AddButton, PlainInput, RemoveButton, useBlockEdit } from "./common";

export function TableBlock({ block }: { block: BlockOf<"table"> }) {
  const { editing, active, patch } = useBlockEdit(block);
  const { rows, headerRow, headerColumn, caption } = block.content;
  const columns = rows[0]?.length ?? 1;
  const setCell = (r: number, c: number, value: RichText) =>
    patch(
      {
        rows: rows.map((row, i) =>
          i === r ? row.map((cell, j) => (j === c ? value : cell)) : row,
        ),
      },
      "Edit cell",
    );
  const addRow = () =>
    patch({ rows: [...rows, Array.from({ length: columns }, () => [])] }, "Add row");
  const addColumn = () => patch({ rows: rows.map((row) => [...row, []]) }, "Add column");
  const removeRow = (r: number) => patch({ rows: rows.filter((_, i) => i !== r) }, "Remove row");
  const removeColumn = (c: number) =>
    patch({ rows: rows.map((row) => row.filter((_, j) => j !== c)) }, "Remove column");
  const tools = editing && active;
  return (
    <figure className="m-0">
      <div className="doc-scroll-x -mx-1 px-1 pb-1">
        <table className="w-full min-w-max border-separate border-spacing-0 overflow-hidden rounded-card border border-border text-body leading-normal">
          {tools && (
            <thead>
              <tr>
                {Array.from({ length: columns }, (_, c) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                    key={c}
                    className="h-8 border-b border-border bg-surface-muted/50 p-0 text-right"
                  >
                    {columns > 1 && (
                      <RemoveButton
                        label={`Remove column ${c + 1}`}
                        onClick={() => removeColumn(c)}
                      />
                    )}
                  </th>
                ))}
                <th aria-hidden className="w-9 border-b border-border bg-surface-muted/50" />
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
              <tr key={r} data-testid="table-row">
                {row.map((cell, c) => {
                  const header = (headerRow && r === 0) || (headerColumn && c === 0);
                  const Cell = header ? "th" : "td";
                  return (
                    <Cell
                      // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                      key={c}
                      scope={header ? (r === 0 ? "col" : "row") : undefined}
                      className={cn(
                        "min-w-28 max-w-80 border-border px-3.5 py-2.5 text-left align-top",
                        r > 0 && "border-t",
                        c > 0 && "border-l",
                        header ? "bg-surface-muted font-semibold" : "bg-surface font-normal",
                      )}
                    >
                      <RichField
                        blockId={block.id}
                        field={`cell-${r}-${c}`}
                        value={cell}
                        onCommit={(value) => setCell(r, c, value)}
                        block={block}
                        flags={block.flags}
                        label={`Row ${r + 1}, column ${c + 1}`}
                        placeholder=" "
                      />
                    </Cell>
                  );
                })}
                {tools && (
                  <td
                    className={cn(
                      "w-9 border-l border-border bg-surface-muted/50 p-0 text-center align-middle",
                      r > 0 && "border-t",
                    )}
                  >
                    {rows.length > 1 && (
                      <RemoveButton label={`Remove row ${r + 1}`} onClick={() => removeRow(r)} />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tools && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <AddButton onClick={addRow} testId="add-row">
            Row
          </AddButton>
          {columns < BLOCK_LIMITS.tableColumns && (
            <AddButton onClick={addColumn} testId="add-column">
              Column
            </AddButton>
          )}
          <label className="ml-1 inline-flex min-h-9 items-center gap-2 text-label text-text-muted">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => patch({ headerRow: e.target.checked }, "Header row")}
              className="size-4 accent-accent"
            />
            Header row
          </label>
          <label className="inline-flex min-h-9 items-center gap-2 text-label text-text-muted">
            <input
              type="checkbox"
              checked={headerColumn}
              onChange={(e) => patch({ headerColumn: e.target.checked }, "Header column")}
              className="size-4 accent-accent"
            />
            Header column
          </label>
        </div>
      )}
      {(caption || tools) && (
        <figcaption className="mt-2 text-center text-label text-text-muted">
          {tools ? (
            <PlainInput
              value={caption ?? ""}
              label="Table caption"
              placeholder="Caption (optional)"
              className="text-center"
              onCommit={(value) => patch({ caption: value || undefined }, "Edit caption")}
            />
          ) : (
            caption
          )}
        </figcaption>
      )}
    </figure>
  );
}
