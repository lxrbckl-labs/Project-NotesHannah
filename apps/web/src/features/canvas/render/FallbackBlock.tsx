/* biome-ignore-all lint/suspicious/noArrayIndexKey: block content is a static snapshot; position is its identity */
import {
  type Block,
  CALLOUT_DEFAULT_COLORS,
  type CitedText,
  type Inline,
  type MindMapNode,
  richTextToPlain,
} from "@notes/schema";
import { memo, type ReactNode } from "react";

/**
 * The canvas's own block renderer, used until the documents feature passes
 * its real renderers through `renderBlock`. Compact on purpose: a card is a
 * summary, the page view has the full block.
 */

function RichText({ value }: { value: readonly Inline[] }) {
  return (
    <>
      {value.map((item, i) => {
        const key = `${i}`;
        if ("cite" in item)
          return (
            <sup key={key} className="nc-muted">
              {item.cite}
            </sup>
          );
        if ("concept" in item)
          return (
            <span key={key} style={{ textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
              {item.text}
            </span>
          );
        let node: ReactNode = item.text;
        if (item.code) node = <code>{node}</code>;
        if (item.bold) node = <strong>{node}</strong>;
        if (item.italic) node = <em>{node}</em>;
        if (item.underline) node = <u>{node}</u>;
        if (item.strike) node = <s>{node}</s>;
        if (item.highlight)
          node = (
            <mark
              className="nc-mark-highlight"
              data-tint={item.highlight}
              style={{ color: "inherit" }}
            >
              {node}
            </mark>
          );
        return <span key={key}>{node}</span>;
      })}
    </>
  );
}

const cited = (value: CitedText | undefined) => (value ? richTextToPlain(value.text) : "");

function Chips({ items, tint, max = 6 }: { items: CitedText[]; tint?: string; max?: number }) {
  return (
    <div className="nc-chips" data-tint={tint}>
      {items.slice(0, max).map((item, i) => (
        <span key={`${i}-${cited(item)}`} className="nc-chip">
          {cited(item)}
        </span>
      ))}
      {items.length > max && <span className="nc-chip">+{items.length - max}</span>}
    </div>
  );
}

const CALLOUT_ICON: Record<string, string> = {
  info: "ℹ",
  tip: "✓",
  warning: "⚠",
  important: "!",
  definition: "≡",
  exam_tip: "★",
};

function mindMapLines(
  node: MindMapNode,
  depth = 0,
  out: Array<{ depth: number; label: string }> = [],
) {
  out.push({ depth, label: node.label });
  if (depth < 2) for (const child of node.children ?? []) mindMapLines(child, depth + 1, out);
  return out;
}

export const FallbackBlock = memo(function FallbackBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="nc-block">
          <h3>
            <RichText value={block.content.text} />
          </h3>
        </div>
      );
    case "paragraph":
      return (
        <div className="nc-block">
          <p>
            <RichText value={block.content.text} />
          </p>
        </div>
      );
    case "bulleted_list":
    case "numbered_list": {
      const List = block.type === "numbered_list" ? "ol" : "ul";
      return (
        <div className="nc-block">
          <List start={block.type === "numbered_list" ? block.content.start : undefined}>
            {block.content.items.map((item, i) => (
              <li
                key={`${i}-${richTextToPlain(item.text)}`}
                style={{ marginLeft: item.indent * 16 }}
              >
                <RichText value={item.text} />
              </li>
            ))}
          </List>
        </div>
      );
    }
    case "checklist":
      return (
        <div className="nc-block">
          <ul style={{ listStyle: "none", paddingLeft: 0 }}>
            {block.content.items.map((item, i) => (
              <li key={`${i}-${richTextToPlain(item.text)}`}>
                <span aria-hidden="true">{item.checked ? "☑ " : "☐ "}</span>
                <RichText value={item.text} />
              </li>
            ))}
          </ul>
        </div>
      );
    case "quote":
      return (
        <div className="nc-block nc-quote">
          <RichText value={block.content.text} />
          {block.content.attribution && (
            <div className="nc-muted">— {block.content.attribution}</div>
          )}
        </div>
      );
    case "divider":
      return (
        <hr
          className="nc-block"
          style={{ border: 0, borderTop: "1px solid var(--nc-card-border)" }}
        />
      );
    case "callout": {
      const tint = block.style?.color ?? CALLOUT_DEFAULT_COLORS[block.content.kind];
      return (
        <div className="nc-block nc-callout" data-tint={tint}>
          <div className="nc-callout-title">
            <span aria-hidden="true">{CALLOUT_ICON[block.content.kind]}</span>
            <span>
              {block.content.title ??
                block.content.kind.replace("_", " ").replace(/^./, (c) => c.toUpperCase())}
            </span>
          </div>
          <RichText value={block.content.text} />
        </div>
      );
    }
    case "table": {
      const [head, ...rows] = block.content.rows;
      const useHead = block.content.headerRow && head;
      return (
        <div className="nc-block">
          <table className="nc-table">
            {useHead && (
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={`h${i}-${richTextToPlain(cell)}`}>
                      <RichText value={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {(useHead ? rows : block.content.rows).map((row, r) => (
                <tr key={`r${r}-${richTextToPlain(row[0] ?? [])}`}>
                  {row.map((cell, i) => (
                    <td key={`c${i}-${richTextToPlain(cell)}`}>
                      <RichText value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.content.caption && <div className="nc-muted">{block.content.caption}</div>}
        </div>
      );
    }
    case "comparison_table":
      return (
        <div className="nc-block">
          {block.content.title && (
            <div style={{ fontWeight: 650, marginBottom: 4 }}>{block.content.title}</div>
          )}
          <table className="nc-table">
            <thead>
              <tr>
                <th />
                {block.content.attributes.map((a) => (
                  <th key={a}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.content.rows.map((row) => (
                <tr key={row.subject}>
                  <th style={{ color: "inherit" }}>{row.subject}</th>
                  {row.cells.map((cell, i) => (
                    <td key={`${row.subject}-${block.content.attributes[i]}`}>{cited(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "drug_card": {
      const c = block.content;
      return (
        <div className="nc-block">
          <div className="nc-drug-name">{c.name}</div>
          {c.brandNames.length > 0 && (
            <div className="nc-muted" style={{ fontSize: 13 }}>
              {c.brandNames.join(", ")}
            </div>
          )}
          {c.drugClass && <div className="nc-drug-class">{cited(c.drugClass)}</div>}
          {c.mechanism && <p style={{ marginTop: 6 }}>{cited(c.mechanism)}</p>}
          {c.indications.length > 0 && (
            <>
              <div className="nc-drug-section">Used for</div>
              <Chips items={c.indications} tint="blue" />
            </>
          )}
          {c.adverseEffects.length > 0 && (
            <>
              <div className="nc-drug-section">Adverse effects</div>
              <Chips items={c.adverseEffects} tint="red" />
            </>
          )}
          {c.counselling.length > 0 && (
            <>
              <div className="nc-drug-section">Counselling</div>
              <Chips items={c.counselling} tint="green" />
            </>
          )}
        </div>
      );
    }
    case "mnemonic":
      return (
        <div className="nc-block">
          <div className="nc-drug-name" style={{ textTransform: "none" }}>
            {block.content.device}
          </div>
          {block.content.topic && <div className="nc-muted">{block.content.topic}</div>}
          <ul style={{ listStyle: "none", paddingLeft: 0, marginTop: 4 }}>
            {block.content.parts.map((part) => (
              <li key={`${part.key}-${richTextToPlain(part.meaning)}`}>
                <strong>{part.key}</strong> <RichText value={part.meaning} />
              </li>
            ))}
          </ul>
        </div>
      );
    case "image":
    case "labelled_image": {
      const alt = block.content.alt;
      return (
        <div
          className="nc-block"
          style={{
            aspectRatio: "16 / 10",
            borderRadius: 10,
            background: "var(--nc-chrome-hover)",
            display: "grid",
            placeItems: "center",
            padding: 12,
            textAlign: "center",
          }}
        >
          <span className="nc-muted">🖼 {alt}</span>
        </div>
      );
    }
    case "mind_map":
      return (
        <div className="nc-block">
          {mindMapLines(block.content.root).map((line, i) => (
            <div
              key={`${i}-${line.label}`}
              style={{ paddingLeft: line.depth * 14, fontWeight: line.depth === 0 ? 650 : 400 }}
            >
              {line.depth > 0 ? "└ " : ""}
              {line.label}
            </div>
          ))}
        </div>
      );
    case "question":
      return (
        <div className="nc-block nc-muted">
          <span aria-hidden="true">❓ </span>Practice question
        </div>
      );
    default:
      return null;
  }
});
