// Small builders for study-guide blocks, so the guides read like notes rather than JSON.

export const h = (level, text) => ({ type: "heading", content: { level, text } });
export const p = (text, citations, extra = {}) => ({
  type: "paragraph",
  content: { text },
  citations,
  ...extra,
});
export const ul = (items, citations, extra = {}) => ({
  type: "bulleted_list",
  content: { items },
  citations,
  ...extra,
});
export const ol = (items, citations, extra = {}) => ({
  type: "numbered_list",
  content: { items },
  citations,
  ...extra,
});
export const checklist = (items) => ({ type: "checklist", content: { items } });
export const quote = (text, attribution, citations) => ({
  type: "quote",
  content: { text, attribution },
  citations,
});
export const divider = () => ({ type: "divider" });
export const table = (rows, citations, extra = {}) => {
  const { caption, headerColumn, ...rest } = extra;
  return {
    type: "table",
    content: {
      rows,
      headerRow: true,
      ...(headerColumn ? { headerColumn: true } : {}),
      ...(caption ? { caption } : {}),
    },
    citations,
    ...rest,
  };
};
export const callout = (kind, title, text, citations, extra = {}) => ({
  type: "callout",
  content: { kind, ...(title ? { title } : {}), text },
  citations,
  ...extra,
});
export const compare = (title, attributes, rows, citations, extra = {}) => ({
  type: "comparison_table",
  content: {
    ...(title ? { title } : {}),
    attributes,
    rows: rows.map(([subject, ...cells]) => ({ subject, cells })),
  },
  citations,
  ...extra,
});
export const mnemonic = (device, topic, parts, note, extra = {}) => ({
  type: "mnemonic",
  content: {
    device,
    topic,
    parts: parts.map(([key, meaning]) => ({ key, meaning })),
    ...(note ? { note } : {}),
  },
  ...extra,
});
export const mindMap = (root, citations, extra = {}) => ({
  type: "mind_map",
  content: { root },
  citations,
  ...extra,
});
export const image = (source, alt, caption) => ({
  type: "image",
  content: { source, alt, ...(caption ? { caption } : {}) },
});
export const labelledImage = (source, alt, hotspots, citations) => ({
  type: "labelled_image",
  content: { image: source, alt, hotspots },
  citations,
});
export const question = (questionId) => ({ type: "question", content: { questionId } });
export const drugCard = (content, citations, extra = {}) => ({
  type: "drug_card",
  content,
  citations,
  ...extra,
});
/** A mind map node: label and children. */
export const node = (label, children, color) => ({
  label,
  ...(color ? { color } : {}),
  ...(children?.length ? { children } : {}),
});
/** A field with its own citation, for drug cards and comparison cells. */
export const cited = (text, citations, flags) => ({
  text,
  citations,
  ...(flags ? { flags } : {}),
});
export const gk = (text) => ({ text, citations: [], generalKnowledge: true });
