import { Fragment, type ReactNode } from "react";

/** Inline light markdown: **bold**, *italic*, `code`. */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

export function Inline({
  text,
  emphasiseNumbers = false,
}: {
  text: string;
  emphasiseNumbers?: boolean;
}) {
  const parts = text.split(INLINE).filter((p) => p !== "");
  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}-${part.slice(0, 8)}`;
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
          return <strong key={key}>{numbers(part.slice(2, -2), emphasiseNumbers)}</strong>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
          return (
            <code key={key} className="rounded bg-surface-muted px-1 py-0.5 text-[0.92em]">
              {part.slice(1, -1)}
            </code>
          );
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
          return <em key={key}>{numbers(part.slice(1, -1), emphasiseNumbers)}</em>;
        return <Fragment key={key}>{numbers(part, emphasiseNumbers)}</Fragment>;
      })}
    </>
  );
}

function numbers(text: string, on: boolean): ReactNode {
  if (!on) return text;
  return text.split(/(\d[\d.,]*)/g).map((p, i) =>
    /^\d/.test(p) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
      <span key={i} className="pr-num">
        {p}
      </span>
    ) : (
      p
    ),
  );
}

/** Light markdown blocks: paragraphs, line breaks, `- ` and `1. ` lists. */
export function Markdown({
  text,
  className = "",
  emphasiseNumbers = false,
}: {
  text: string;
  className?: string;
  emphasiseNumbers?: boolean;
}) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const key = `b${bi}`;
        if (lines.every((l) => /^\s*[-*] /.test(l)))
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {lines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static text
                <li key={i}>
                  <Inline text={l.replace(/^\s*[-*] /, "")} emphasiseNumbers={emphasiseNumbers} />
                </li>
              ))}
            </ul>
          );
        if (lines.every((l) => /^\s*\d+\. /.test(l)))
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5">
              {lines.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static text
                <li key={i}>
                  <Inline text={l.replace(/^\s*\d+\. /, "")} emphasiseNumbers={emphasiseNumbers} />
                </li>
              ))}
            </ol>
          );
        return (
          <p key={key}>
            {lines.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static text
              <Fragment key={i}>
                {i > 0 && <br />}
                <Inline text={l} emphasiseNumbers={emphasiseNumbers} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
