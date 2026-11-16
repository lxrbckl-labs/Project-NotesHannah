import { type Block, type BlockOf, isBlockType } from "@notes/schema";
import { Component, type ReactNode } from "react";
import { ComparisonBlock } from "./comparison";
import { DrugCardBlock } from "./drug";
import { ImageBlock, LabelledImageBlock } from "./images";
import { ListBlockView } from "./lists";
import { MindMapBlock } from "./mindmap";
import { DividerBlock, QuestionBlock, UnknownBlock } from "./misc";
import { MnemonicBlock } from "./mnemonic";
import { TableBlock } from "./table";
import { CalloutBlock, HeadingBlock, ParagraphBlock, QuoteBlock } from "./text";

/** The renderer for every block type in the registry; anything else gets the fallback. */
export function BlockContent({ block }: { block: Block }) {
  if (!isBlockType(block.type))
    return <UnknownBlock type={String(block.type)} content={block.content} />;
  switch (block.type) {
    case "paragraph":
      return <ParagraphBlock block={block} />;
    case "heading":
      return <HeadingBlock block={block} />;
    case "bulleted_list":
    case "numbered_list":
    case "checklist":
      return <ListBlockView block={block as BlockOf<"bulleted_list">} />;
    case "quote":
      return <QuoteBlock block={block} />;
    case "divider":
      return <DividerBlock />;
    case "table":
      return <TableBlock block={block} />;
    case "image":
      return <ImageBlock block={block} />;
    case "callout":
      return <CalloutBlock block={block} />;
    case "drug_card":
      return <DrugCardBlock block={block} />;
    case "comparison_table":
      return <ComparisonBlock block={block} />;
    case "mnemonic":
      return <MnemonicBlock block={block} />;
    case "labelled_image":
      return <LabelledImageBlock block={block} />;
    case "mind_map":
      return <MindMapBlock block={block} />;
    case "question":
      return <QuestionBlock block={block} />;
    default:
      return (
        <UnknownBlock
          type={String((block as { type: unknown }).type)}
          content={(block as { content: unknown }).content}
        />
      );
  }
}

/** Keeps one broken block from taking the document down. */
export class BlockBoundary extends Component<
  { type: string; content: unknown; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed)
      return <UnknownBlock type={this.props.type} content={this.props.content} />;
    return this.props.children;
  }
}
