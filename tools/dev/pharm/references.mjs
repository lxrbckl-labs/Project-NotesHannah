// Her saved references for the pharmacy demo set, and three agent-written blocks that name an
// outside reference (shown as their own chip, apart from her sources). Shared by
// `pnpm local:seed:pharm` and `pnpm local:seed:pharm:references`.
//
// Links only: titles and notes are our own words, and nothing is fetched from any site. Addresses
// are organisation index pages or DOIs (stable by design), never deep links that could move.

const PG = "https://www.pharmguides.com";

/** `places` are lecture keys of the demo set; an empty list leaves the reference untied. */
export const REFERENCES = [
  {
    title: "PharmGuides: guidelines by category",
    url: `${PG}/categories/`,
    kind: "guideline",
    note: "Where I start when I need the current guideline for a topic.",
    places: ["htn", "hf"],
    favourite: true,
  },
  {
    title: "PharmGuides: DoseDex",
    url: `${PG}/dosedex/`,
    kind: "chart",
    note: "Emergency doses, for checking the code-cart drugs from the adrenergic lecture.",
    places: ["adr"],
  },
  {
    title: "PharmGuides: AntibioticDex",
    url: `${PG}/antibioticdex/`,
    kind: "chart",
    note: "Spectrum chart for next term's infectious disease block.",
    places: [],
  },
  {
    title: "ACC/AHA high blood pressure guideline (2017)",
    url: "https://doi.org/10.1161/HYP.0000000000000065",
    kind: "guideline",
    note: "BP categories and targets; the lecture follows it.",
    places: ["htn"],
  },
  {
    title: "AHA/ACC/HFSA heart failure guideline (2022)",
    url: "https://doi.org/10.1161/CIR.0000000000001063",
    kind: "guideline",
    note: "The four drug pillars for HFrEF and the order to start them.",
    places: ["hf"],
  },
  {
    title: "AGS Beers Criteria (2023)",
    url: "https://doi.org/10.1111/jgs.18372",
    kind: "guideline",
    note: "Drugs to avoid in older adults; handy for the beta blocker and alpha agonist cases.",
    places: ["beta", "adr"],
  },
  {
    title: "IDSA practice guidelines",
    url: "https://www.idsociety.org/practice-guideline/practice-guidelines/",
    kind: "guideline",
    note: "Infectious disease guideline index for next term.",
    places: [],
  },
  {
    title: "DailyMed drug labels",
    url: "https://dailymed.nlm.nih.gov/dailymed/",
    kind: "article",
    note: "Official package inserts, for checking a dose or a boxed warning.",
    places: ["beta", "htn"],
  },
];

/**
 * Blocks an agent adds to its own guides to show what reference attribution looks like. Our own
 * wording; each names the saved reference (by address) it was checked against.
 */
export const ATTRIBUTED_BLOCKS = [
  {
    lecture: "htn",
    text: "Cross-check: the BP categories in this lecture match the current ACC/AHA guideline, where stage 1 starts at 130/80.",
    url: "https://doi.org/10.1161/HYP.0000000000000065",
    title: "ACC/AHA high blood pressure guideline",
  },
  {
    lecture: "hf",
    text: "Cross-check: the guideline lists four drug classes to start for HFrEF; the lecture covers all four.",
    url: "https://doi.org/10.1161/CIR.0000000000001063",
    title: "AHA/ACC/HFSA heart failure guideline",
  },
  {
    lecture: "adr",
    text: "For emergency doses of the agents in this lecture, check DoseDex rather than memorizing them from the slides.",
    url: `${PG}/dosedex/`,
    title: "DoseDex",
  },
];

/**
 * Save the references she does not have yet (matched by address) and tie them to the lectures.
 * Runs in her session, so they show as hers. Returns what was saved and skipped.
 */
export async function writeReferences({ call, list, lectures }) {
  const have = new Map((await list("/references?limit=500")).map((r) => [r.url, r]));
  const saved = [];
  const skipped = [];
  const ids = new Map();
  for (const ref of REFERENCES) {
    const existing = have.get(ref.url);
    if (existing) {
      skipped.push(ref.title);
      ids.set(ref.url, existing.id);
      continue;
    }
    const { reference } = await call("POST", "/references", {
      title: ref.title,
      url: ref.url,
      kind: ref.kind,
      note: ref.note,
      favourite: ref.favourite ?? false,
      nodeIds: ref.places.map((key) => lectures[key].id),
    });
    ids.set(ref.url, reference.id);
    saved.push(ref.title);
  }
  return { saved, skipped, ids };
}

/**
 * Add the attributed blocks at the end of the agent's guides, as the agent, unless a block with the
 * same text is already there. `agent` calls the API with an agent key; `guides` maps lecture keys
 * to document IDs.
 */
export async function writeAttributedBlocks({ call, agent, guides, ids }) {
  let added = 0;
  for (const spec of ATTRIBUTED_BLOCKS) {
    const documentId = guides[spec.lecture];
    if (!documentId) continue;
    const { blocks } = await call("GET", `/documents/${documentId}/content?limit=1000`);
    if (JSON.stringify(blocks).includes(spec.text)) continue;
    await (await agent())("POST", `/documents/${documentId}/blocks`, {
      blocks: [
        {
          type: "callout",
          content: { kind: "tip", text: spec.text },
          references: [
            {
              title: spec.title,
              url: spec.url,
              ...(ids.get(spec.url) ? { referenceId: ids.get(spec.url) } : {}),
            },
          ],
        },
      ],
      position: "end",
    });
    added += 1;
  }
  return added;
}
