import type { NodeWithLinks } from "@notes/schema";
import { MoreHorizontal, Star } from "lucide-react";
import { type CSSProperties, lazy, type ReactNode, Suspense, useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { ActionMenu, ContextActions } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
import type { Hue } from "../../lib/hues";
import { useNodeActions } from "./actions";
import { courseHue } from "./courseHue";
import { InlineName } from "./InlineName";
import { NodeTile } from "./NodeIcon";
import { nodeMeta, nodeTitle } from "./NodeRow";
import { isPending, nodeHref } from "./rules";
import { useNodeMenu } from "./useNodeMenu";

// The spotlight glow is an extra: it loads on its own and the plain card shows until then.
const SpotlightCard = lazy(() => import("../../components/bits/SpotlightCard"));

/**
 * A rounded card for a term, course or section. Sections (fixed) have no menu. A course card and
 * the section cards under a course carry the course colour (`hue`); a term stays neutral.
 */
export function NodeCard({
  node,
  large,
  hue: inherited,
}: {
  node: NodeWithLinks;
  large?: boolean;
  hue?: Hue | null | undefined;
}) {
  const hue = node.kind === "course" ? courseHue(node.id) : node.kind === "term" ? null : inherited;
  const actions = useNodeActions();
  const [renaming, setRenaming] = useState(false);
  const fixed = node.kind === "section";
  const { entries } = useNodeMenu(node, { onRename: () => setRenaming(true) });

  const cardClass = cn(
    "group relative flex gap-3",
    large
      ? "min-h-24 items-center md:min-h-36 md:flex-col md:items-start md:justify-between"
      : "min-h-24 items-start",
    isPending(node) && "opacity-60",
  );
  const inner: ReactNode = (
    <>
      <NodeTile kind={node.kind} section={node.section} hue={hue} size={large ? "lg" : "md"} />
      <div className="min-w-0 flex-1 md:w-full">
        {renaming ? (
          <InlineName
            value={node.name}
            label={`Rename ${node.name}`}
            onCancel={() => setRenaming(false)}
            onCommit={(name) => {
              setRenaming(false);
              void actions.rename(node, name);
            }}
          />
        ) : (
          <Link
            to={nodeHref(node)}
            className="block rounded-inline font-display text-body font-semibold after:absolute after:inset-0 after:rounded-card after:content-['']"
          >
            <span className="flex items-center gap-1.5">
              <span className="truncate">{nodeTitle(node)}</span>
              {node.favourite ? (
                <Star
                  size={14}
                  aria-label="Favorite"
                  className="shrink-0 fill-accent text-accent"
                />
              ) : null}
            </span>
          </Link>
        )}
        <p className="mt-0.5 truncate text-ui text-text-muted">{nodeMeta(node)}</p>
      </div>
      {!fixed ? (
        <div className="relative z-10 -mr-2 -mt-2 shrink-0 self-start md:absolute md:right-3 md:top-3 md:m-0">
          <ActionMenu
            trigger={
              <IconButton aria-label={`Actions for ${node.name}`}>
                <MoreHorizontal size={20} />
              </IconButton>
            }
            entries={entries}
          />
        </div>
      ) : null}
    </>
  );
  const plain = (
    <Card
      data-testid="node-card"
      data-kind={node.kind}
      hue={hue ?? undefined}
      interactive
      className={cardClass}
    >
      {inner}
    </Card>
  );
  const body =
    node.kind === "section" && hue && typeof IntersectionObserver !== "undefined" ? (
      <Suspense fallback={plain}>
        <SpotlightCard
          data-testid="node-card"
          data-kind={node.kind}
          data-hue={hue}
          intensity={0.1}
          style={
            {
              "--spotlight-card-surface": "var(--tone-soft)",
              "--spotlight-card-border": "var(--tone-border)",
            } as CSSProperties
          }
          className={cn(cardClass, "rounded-card! p-4! md:p-5!")}
        >
          {inner}
        </SpotlightCard>
      </Suspense>
    ) : (
      plain
    );
  return fixed ? body : <ContextActions entries={entries}>{body}</ContextActions>;
}
