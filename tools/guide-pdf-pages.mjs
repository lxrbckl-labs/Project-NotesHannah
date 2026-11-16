// Reads which page each named destination of a Chromium PDF is on, with no PDF library.
//
// Chromium writes a named destination for every element id a link points at (the contents links,
// here), in the catalog's /Dests dictionary, as `/name [pageRef /XYZ x y zoom]`. Its object
// dictionaries are not compressed (only the page content streams are), so the page tree and the
// destinations can be read with a few regular expressions. Used by guide-pdf.mjs for the contents
// page numbers, and to check them.
//
//   node tools/guide-pdf-pages.mjs apps/web/public/guide/notes-guide.pdf

import { readFileSync } from "node:fs";

/** The text of every `N 0 obj ... endobj`, by object number, skipping stream bodies. */
function objects(pdf) {
  const text = pdf.toString("latin1");
  const map = new Map();
  const re = /(\d+) 0 obj\s*([\s\S]*?)endobj/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = m[2] ?? "";
    const stream = body.indexOf("stream");
    map.set(Number(m[1]), stream >= 0 ? body.slice(0, stream) : body);
  }
  return { text, map };
}

const ref = (s, key) => {
  const m = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(s);
  return m ? Number(m[1]) : undefined;
};

/** PDF name decoding: #xx escapes. */
const decodeName = (name) =>
  name.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/**
 * @param {Buffer} pdf
 * @returns {{ pages: number, dests: Record<string, number> }} 1-based page numbers by id
 */
export function destinationPages(pdf) {
  const { text, map } = objects(pdf);
  const rootRef = ref(text.slice(text.lastIndexOf("trailer")), "Root") ?? ref(text, "Root");
  const catalog = map.get(rootRef) ?? "";
  const order = [];
  const walk = (n) => {
    const node = map.get(n) ?? "";
    if (/\/Type\s*\/Pages\b/.test(node)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node)?.[1] ?? "";
      for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
    } else order.push(n);
  };
  walk(ref(catalog, "Pages"));
  const pageOf = new Map(order.map((n, i) => [n, i + 1]));

  const dests = {};
  const destsRef = ref(catalog, "Dests");
  let destsText = destsRef !== undefined ? (map.get(destsRef) ?? "") : "";
  if (!destsText) destsText = /\/Dests\s*(<<[\s\S]*?>>)/.exec(catalog)?.[1] ?? "";
  for (const m of destsText.matchAll(/\/([^\s/[\]<>()]+)\s*\[\s*(\d+) 0 R/g)) {
    const page = pageOf.get(Number(m[2]));
    if (page) dests[decodeName(m[1])] = page;
  }
  // A destination given by reference: /name N 0 R, where object N is the array.
  for (const m of destsText.matchAll(/\/([^\s/[\]<>()]+)\s+(\d+) 0 R/g)) {
    const target = map.get(Number(m[2])) ?? "";
    const page = pageOf.get(Number(/\[\s*(\d+) 0 R/.exec(target)?.[1]));
    if (page && !(decodeName(m[1]) in dests)) dests[decodeName(m[1])] = page;
  }
  return { pages: order.length, dests };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node tools/guide-pdf-pages.mjs <file.pdf>");
  console.log(JSON.stringify(destinationPages(readFileSync(file)), null, 2));
}
