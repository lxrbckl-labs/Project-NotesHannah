import path from "node:path/posix";
import { XMLParser } from "fast-xml-parser";
import type { Limits } from "../config.js";
import type { Warning } from "./types.js";
import { readEntries } from "./zipscan.js";

type XNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
});

const tag = (n: XNode): string | undefined =>
  Object.keys(n).find((k) => k !== ":@" && k !== "#text");
const kids = (n: XNode): XNode[] => {
  const t = tag(n);
  return t ? ((n[t] as XNode[]) ?? []) : [];
};
const attr = (n: XNode, name: string): string | undefined =>
  (n[":@"] as Record<string, string> | undefined)?.[`@_${name}`];
const find = (nodes: XNode[], name: string): XNode | undefined =>
  nodes.find((n) => tag(n) === name);
const findAll = (nodes: XNode[], name: string): XNode[] => nodes.filter((n) => tag(n) === name);

export interface Paragraph {
  level: number;
  text: string;
}
export type Block =
  | { kind: "title" | "text"; paragraphs: Paragraph[] }
  | { kind: "table"; rows: string[][] };

export interface SlideText {
  slideNumber: number;
  hidden: boolean;
  title: string | null;
  /** Reading-order text: title, then shapes in z-order (PowerPoint's own reading order); tables as tab-separated rows. */
  text: string;
  blocks: Block[];
  notes: string | null;
  /** True when the slide contains charts, SmartArt or OLE objects whose text we do not extract. */
  hasUnextractedObjects: boolean;
}

function paragraphText(p: XNode): string {
  let out = "";
  const walk = (nodes: XNode[]) => {
    for (const n of nodes) {
      const t = tag(n);
      if (t === "a:t")
        out += kids(n)
          .map((x) => (x["#text"] as string) ?? "")
          .join("");
      else if (t === "a:br") out += "\n";
      else if (t === "a:r" || t === "a:fld") walk(kids(n));
    }
  };
  walk(kids(p));
  return out;
}

function txBodyParagraphs(txBody: XNode): Paragraph[] {
  const res: Paragraph[] = [];
  for (const p of findAll(kids(txBody), "a:p")) {
    const text = paragraphText(p).replaceAll("\u000b", "\n");
    const pPr = find(kids(p), "a:pPr");
    const level = pPr ? Number(attr(pPr, "lvl") ?? 0) || 0 : 0;
    if (text.trim() !== "") res.push({ level, text });
  }
  return res;
}

const SKIP_PLACEHOLDERS = new Set(["sldNum", "ftr", "dt", "hdr"]);

interface Collected {
  blocks: Block[];
  unextracted: boolean;
}

function collectShapes(nodes: XNode[], acc: Collected, mode: "slide" | "notes"): void {
  for (const n of nodes) {
    const t = tag(n);
    if (t === "p:sp") {
      const body = kids(n);
      const nvPr = find(kids(find(body, "p:nvSpPr") ?? {}), "p:nvPr");
      const ph = nvPr ? find(kids(nvPr), "p:ph") : undefined;
      const phType = ph ? (attr(ph, "type") ?? "body") : undefined;
      if (phType && SKIP_PLACEHOLDERS.has(phType)) continue;
      if (mode === "notes" && phType !== "body") continue;
      const txBody = find(body, "p:txBody");
      if (!txBody) continue;
      const paragraphs = txBodyParagraphs(txBody);
      if (paragraphs.length === 0) continue;
      acc.blocks.push({
        kind: phType === "title" || phType === "ctrTitle" ? "title" : "text",
        paragraphs,
      });
    } else if (t === "p:grpSp") {
      collectShapes(kids(n), acc, mode);
    } else if (t === "p:graphicFrame") {
      const graphic = find(kids(n), "a:graphic");
      const data = graphic ? find(kids(graphic), "a:graphicData") : undefined;
      const tbl = data ? find(kids(data), "a:tbl") : undefined;
      if (tbl) {
        const rows: string[][] = [];
        for (const tr of findAll(kids(tbl), "a:tr")) {
          const row: string[] = [];
          for (const tc of findAll(kids(tr), "a:tc")) {
            const txBody = find(kids(tc), "a:txBody");
            row.push(
              txBody
                ? txBodyParagraphs(txBody)
                    .map((p) => p.text)
                    .join(" / ")
                : "",
            );
          }
          rows.push(row);
        }
        if (rows.some((r) => r.some((c) => c.trim() !== "")))
          acc.blocks.push({ kind: "table", rows });
      } else if (data) {
        acc.unextracted = true; // chart, SmartArt diagram, OLE
      }
    } else if (t === "mc:AlternateContent") {
      const choice = find(kids(n), "mc:Choice") ?? find(kids(n), "mc:Fallback");
      if (choice) collectShapes(kids(choice), acc, mode);
    }
  }
}

function spTreeChildren(doc: XNode[], rootTag: string): XNode[] {
  const root = find(doc, rootTag);
  const cSld = root ? find(kids(root), "p:cSld") : undefined;
  const spTree = cSld ? find(kids(cSld), "p:spTree") : undefined;
  return spTree ? kids(spTree) : [];
}

function relsOf(
  xml: string | undefined,
): Map<string, { target: string; type: string; external: boolean }> {
  const m = new Map<string, { target: string; type: string; external: boolean }>();
  if (!xml) return m;
  const doc = parser.parse(xml) as XNode[];
  const rels = find(doc, "Relationships");
  for (const r of rels ? findAll(kids(rels), "Relationship") : []) {
    m.set(attr(r, "Id") ?? "", {
      target: attr(r, "Target") ?? "",
      type: attr(r, "Type") ?? "",
      external: attr(r, "TargetMode") === "External",
    });
  }
  return m;
}

function blocksToText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.kind === "table") parts.push(b.rows.map((r) => r.join("\t")).join("\n"));
    else parts.push(b.paragraphs.map((p) => `${"  ".repeat(p.level)}${p.text}`).join("\n"));
  }
  return parts.join("\n\n");
}

/** Extract slide text and speaker notes straight from the OOXML, in presentation order. */
export async function extractPptxText(
  file: string,
  lim: Limits,
  warnings: Warning[],
): Promise<{ slides: SlideText[]; externalLinks: number }> {
  const files = await readEntries(
    file,
    (n) =>
      /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/.test(
        n,
      ),
    lim.maxXmlEntryBytes,
  );
  const presXml = files.get("ppt/presentation.xml");
  if (!presXml) return { slides: [], externalLinks: 0 };
  const pres = parser.parse(presXml) as XNode[];
  const presRoot = find(pres, "p:presentation");
  const sldIdLst = presRoot ? find(kids(presRoot), "p:sldIdLst") : undefined;
  const presRels = relsOf(files.get("ppt/_rels/presentation.xml.rels"));
  const slides: SlideText[] = [];
  let externalLinks = 0;
  let n = 0;
  for (const sldId of sldIdLst ? findAll(kids(sldIdLst), "p:sldId") : []) {
    n += 1;
    const rel = presRels.get(attr(sldId, "r:id") ?? "");
    if (!rel) continue;
    const slidePath = path.normalize(path.join("ppt", rel.target));
    const slideXml = files.get(slidePath);
    if (!slideXml) {
      warnings.push({
        code: "SLIDE_XML_MISSING",
        message: `slide ${n} part ${slidePath} not readable`,
        page: n,
      });
      slides.push({
        slideNumber: n,
        hidden: false,
        title: null,
        text: "",
        blocks: [],
        notes: null,
        hasUnextractedObjects: false,
      });
      continue;
    }
    const slideDoc = parser.parse(slideXml) as XNode[];
    const hidden = attr(find(slideDoc, "p:sld") ?? {}, "show") === "0";
    const acc: Collected = { blocks: [], unextracted: false };
    collectShapes(spTreeChildren(slideDoc, "p:sld"), acc, "slide");
    // Title first, then the rest in z-order.
    const title = acc.blocks.find((b) => b.kind === "title");
    const ordered = title ? [title, ...acc.blocks.filter((b) => b !== title)] : acc.blocks;

    const slideRels = relsOf(
      files.get(path.join(path.dirname(slidePath), "_rels", `${path.basename(slidePath)}.rels`)),
    );
    for (const r of slideRels.values()) if (r.external) externalLinks += 1;
    let notes: string | null = null;
    const notesRel = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"));
    if (notesRel) {
      const notesXml = files.get(
        path.normalize(path.join(path.dirname(slidePath), notesRel.target)),
      );
      if (notesXml) {
        const nacc: Collected = { blocks: [], unextracted: false };
        collectShapes(spTreeChildren(parser.parse(notesXml) as XNode[], "p:notes"), nacc, "notes");
        const t = blocksToText(nacc.blocks).trim();
        notes = t === "" ? null : t;
      }
    }
    slides.push({
      slideNumber: n,
      hidden,
      title: title && title.kind !== "table" ? title.paragraphs.map((p) => p.text).join(" ") : null,
      text: blocksToText(ordered),
      blocks: ordered,
      notes,
      hasUnextractedObjects: acc.unextracted,
    });
  }
  return { slides, externalLinks };
}
