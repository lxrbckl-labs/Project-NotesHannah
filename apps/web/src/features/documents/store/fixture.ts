import {
  type Actor,
  type Block,
  type BlockInputRaw,
  type Citation,
  type DocumentWithBlocks,
  documentReviewStatus,
  type Revision,
  validateBlockInput,
} from "@notes/schema";
import { FILE_IDS, mockId, pageAt, regionForQuote } from "./mock-pages";

/**
 * An invented pharmacy study guide on beta blockers, as an agent might have
 * written it and she then partly reviewed and edited. Every block passes the
 * shared schema (the fixture throws otherwise).
 */

export const AGENT: Actor = { type: "agent", keyId: mockId("key", 1), label: "Claude Code" };
export const HER: Actor = { type: "user", userId: mockId("usr", 1) };
export const GUIDE_ID = mockId("doc", 1);
export const GUIDE_NODE_ID = mockId("nod", 1);

/** A citation of a mock page, with the region computed from the page layout. */
export function cite(fileId: string, index: number, quote: string, label?: string): Citation {
  const p = pageAt(fileId, index);
  if (!p.text.includes(quote)) throw new Error(`Quote not on page ${index}: ${quote}`);
  const region = regionForQuote(p, quote);
  const citation: Citation = {
    fileId,
    pageId: p.id,
    quote,
    transcriptId: mockId("trn", Number(p.id.slice(-3))),
    transcriptRevision: 1,
  };
  if (region) citation.region = region;
  if (label) citation.label = label;
  return citation;
}

const slide = (n: number, quote: string) => cite(FILE_IDS.deck, n, quote, `Slide ${n}`);
const notes = (quote: string) => cite(FILE_IDS.notes, 1, quote, "Notes p1");

const C = {
  receptorsHeart: slide(
    3,
    "β1 receptors are found mainly in the heart, where stimulation increases heart rate and contractility.",
  ),
  receptorsLung: slide(
    3,
    "β2 receptors are found in bronchial and vascular smooth muscle; stimulation causes relaxation.",
  ),
  antagonise: slide(
    3,
    "Beta blockers competitively antagonise catecholamines at beta-adrenergic receptors.",
  ),
  cardioselective: slide(
    4,
    "Cardioselective agents (atenolol, metoprolol) preferentially block β1 receptors.",
  ),
  doseDependent: slide(4, "Selectivity is dose-dependent and is lost at higher doses."),
  nonSelective: slide(4, "Non-selective agents (propranolol, nadolol) block β1 and β2 receptors."),
  alpha: slide(4, "Carvedilol and labetalol also block α1 receptors (vasodilation)."),
  uses: slide(
    5,
    "Indications: hypertension, angina, heart failure with reduced ejection fraction, secondary prevention after myocardial infarction, rate control in atrial fibrillation.",
  ),
  migraine: slide(5, "Propranolol is also used for migraine prophylaxis and essential tremor."),
  hfMortality: slide(
    5,
    "Only bisoprolol, carvedilol and metoprolol succinate have mortality benefit in heart failure.",
  ),
  adverse: slide(
    6,
    "Common adverse effects: bradycardia, fatigue, cold extremities, sleep disturbance.",
  ),
  hypo: slide(
    6,
    "Beta blockers may mask the tachycardia of hypoglycaemia in patients with diabetes.",
  ),
  asthma: slide(6, "Avoid non-selective agents in asthma: β2 blockade can trigger bronchospasm."),
  abrupt: slide(
    6,
    "Never stop a beta blocker abruptly: taper over 1–2 weeks to avoid rebound tachycardia.",
  ),
  tartrate: slide(7, "Metoprolol tartrate (Lopressor): immediate release, given twice daily."),
  succinate: slide(7, "Metoprolol succinate (Toprol-XL): extended release, once daily."),
  dose: slide(7, "Hypertension: start 25–50 mg PO BID (tartrate), titrate to response."),
  monitor: slide(7, "Monitor heart rate and blood pressure; hold if HR < 50 bpm."),
  cyp: slide(7, "Hepatic metabolism via CYP2D6: fluoxetine and paroxetine raise levels."),
  atenolol: slide(8, "Atenolol: β1-selective, hydrophilic, renally cleared, half-life 6–7 h."),
  metoprolol: slide(8, "Metoprolol: β1-selective, lipophilic, hepatic (CYP2D6), half-life 3–7 h."),
  propranolol: slide(8, "Propranolol: non-selective, highly lipophilic, hepatic, half-life 3–6 h."),
  carvedilol: slide(8, "Carvedilol: non-selective with α1 blockade, hepatic, half-life 7–10 h."),
  receptorMapHeart: cite(FILE_IDS.deck, 2, "β1: heart (SA node, AV node, ventricles).", "Slide 2"),
  receptorMapLung: cite(
    FILE_IDS.deck,
    2,
    "β2: bronchial smooth muscle, vascular smooth muscle, liver.",
    "Slide 2",
  ),
  patel: notes("Dr Patel: never stop a beta blocker abruptly!!"),
  alphaNotes: notes("carvedilol + labetalol also block alpha 1"),
  succNotes: notes("metoprolol succ 25-100 mg once daily ?? ask in tutorial"),
  food: notes("counsel: take with food, don't skip doses"),
  dreams: notes("lipophilic ones (propranolol) cross BBB -> vivid dreams, CNS effects"),
  textbook: cite(
    FILE_IDS.textbook,
    212,
    "Beta blockers reduce mortality after myocardial infarction.",
    "Textbook p212",
  ),
};

/** Fixed citation used where a deleted source is shown. */
const deletedSource: Citation = {
  fileId: FILE_IDS.deleted,
  pageId: mockId("pag", 41),
  quote: "Sotalol also prolongs the QT interval.",
  label: "Handout",
};

const CONCEPTS = {
  metoprolol: mockId("con", 1),
  atenolol: mockId("con", 2),
  propranolol: mockId("con", 3),
  carvedilol: mockId("con", 4),
  betaBlocker: mockId("con", 5),
};

type Who = "agent" | "agent_reviewed" | "her" | "her_edited";

const BASE_TIME = Date.parse("2026-11-10T14:00:00.000Z");
const minutes = (n: number) => new Date(BASE_TIME + n * 60_000).toISOString();

function block(raw: BlockInputRaw, who: Who, n: number, idBase = 100): Block {
  const result = validateBlockInput(raw, { writer: who === "her" ? "user" : "agent" });
  if (!result.ok) {
    throw new Error(`Fixture block ${raw.type} is invalid: ${JSON.stringify(result.problems)}`);
  }
  const created = who === "her" ? HER : AGENT;
  const edited = who === "her" || who === "her_edited" ? HER : AGENT;
  const reviewed = who === "her" || who === "agent_reviewed";
  return {
    ...result.block,
    id: mockId("blk", idBase + n),
    origin: who === "her" || who === "her_edited" ? "user" : "agent",
    review: reviewed
      ? { status: "reviewed", reviewedAt: minutes(600 + n) }
      : { status: "unverified", reviewedAt: null },
    provenance: {
      createdBy: created,
      createdAt: minutes(n),
      lastEditedBy: edited,
      lastEditedAt: who === "her_edited" ? minutes(900 + n) : minutes(n),
    },
  } as Block;
}

/** The guide's blocks, as writer inputs with who wrote them. */
export function guideInputs(): Array<{ raw: BlockInputRaw; who: Who }> {
  return [
    {
      who: "agent",
      raw: {
        type: "callout",
        content: {
          kind: "definition",
          title: "Beta blocker",
          text: [
            { text: "A drug that " },
            { text: "competitively", italic: true },
            {
              text: " blocks β-adrenergic receptors, blunting the effects of adrenaline and noradrenaline on the heart, lungs and vessels.",
            },
            { cite: 1 },
          ],
        },
        citations: [C.antagonise],
      },
    },
    {
      who: "agent_reviewed",
      raw: { type: "heading", content: { level: 2, text: "Receptors and selectivity" } },
    },
    {
      who: "agent_reviewed",
      raw: {
        type: "paragraph",
        content: {
          text: [
            { text: "β1 receptors", bold: true },
            { text: " sit mainly in the heart, where they raise rate and contractility" },
            { cite: 1 },
            { text: ". " },
            { text: "β2 receptors", bold: true },
            { text: " relax bronchial and vascular smooth muscle" },
            { cite: 2 },
            { text: ". Cardioselective drugs such as " },
            { concept: CONCEPTS.metoprolol, text: "metoprolol" },
            { text: " " },
            { text: "preferentially", italic: true },
            { text: " block β1, " },
            { text: "but selectivity fades at higher doses", highlight: "yellow" },
            { cite: 3 },
            { text: "." },
          ],
        },
        citations: [C.receptorsHeart, C.receptorsLung, C.doseDependent],
      },
    },
    {
      who: "agent",
      raw: {
        type: "bulleted_list",
        content: {
          items: [
            {
              text: [
                { text: "Cardioselective (β1): ", bold: true },
                { text: "atenolol, bisoprolol, metoprolol" },
                { cite: 1 },
              ],
            },
            { text: "Selectivity is lost at higher doses", indent: 1 },
            {
              text: [
                { text: "Non-selective (β1 + β2): ", bold: true },
                { text: "propranolol, nadolol" },
                { cite: 2 },
              ],
            },
            {
              text: [
                { text: "Also block α1: ", bold: true },
                { text: "carvedilol, labetalol" },
                { cite: 3 },
              ],
            },
            { text: "Vasodilation adds to the fall in blood pressure", indent: 1 },
          ],
        },
        citations: [C.cardioselective, C.nonSelective, C.alpha],
        flags: [
          {
            kind: "uncertain",
            quote: "bisoprolol",
            note: "Bisoprolol is not on slide 4; it comes from the clinical uses slide. Check it belongs here.",
          },
        ],
      },
    },
    {
      who: "her",
      raw: {
        type: "callout",
        content: {
          kind: "exam_tip",
          title: "Exam tip",
          text: [
            { text: "Cardioselective = " },
            { text: "A", bold: true },
            { text: "tenolol, " },
            { text: "B", bold: true },
            { text: "isoprolol, " },
            { text: "M", bold: true },
            { text: "etoprolol. Think “" },
            { text: "ABM", highlight: "orange" },
            { text: "”: the heart-only ones." },
          ],
        },
      },
    },
    {
      who: "agent",
      raw: {
        type: "labelled_image",
        content: {
          image: { fileId: FILE_IDS.deck, pageId: pageAt(FILE_IDS.deck, 2).id },
          alt: "Diagram of the lungs, heart, liver and kidney with their beta receptors",
          hotspots: [
            {
              x: 0.672,
              y: 0.66,
              label: "β1: heart",
              detail: "Raises rate and contractility (SA node, AV node, ventricles).",
              concept: CONCEPTS.betaBlocker,
            },
            {
              x: 0.594,
              y: 0.27,
              label: "β2: bronchial smooth muscle",
              detail: "Relaxation opens the airways; blocking it can cause bronchospasm.",
            },
            {
              x: 0.844,
              y: 0.72,
              label: "β2: liver",
              detail: "Glycogenolysis, which is why hypoglycaemia warnings matter.",
            },
            {
              x: 0.516,
              y: 0.78,
              label: "β1: kidney",
              detail: "Renin release from juxtaglomerular cells.",
            },
          ],
        },
        citations: [C.receptorMapHeart, C.receptorMapLung],
      },
    },
    {
      who: "agent_reviewed",
      raw: { type: "heading", content: { level: 2, text: "Clinical uses" } },
    },
    {
      who: "agent_reviewed",
      raw: {
        type: "numbered_list",
        content: {
          items: [
            "Hypertension",
            "Angina",
            {
              text: [
                { text: "Heart failure with reduced ejection fraction (" },
                { text: "only bisoprolol, carvedilol, metoprolol succinate", italic: true },
                { text: ")" },
                { cite: 2 },
              ],
            },
            "Secondary prevention after myocardial infarction",
            "Rate control in atrial fibrillation",
            {
              text: [
                { text: "Propranolol only: migraine prophylaxis, essential tremor" },
                { cite: 3 },
              ],
            },
          ],
        },
        citations: [C.uses, C.hfMortality, C.migraine],
      },
    },
    {
      who: "agent",
      raw: {
        type: "paragraph",
        content: {
          text: "In most current hypertension guidelines, beta blockers are not first-line for uncomplicated hypertension; thiazides, ACE inhibitors, ARBs or calcium channel blockers usually come first unless there is another reason to use one.",
        },
        generalKnowledge: true,
      },
    },
    {
      who: "agent",
      raw: {
        type: "paragraph",
        content: {
          text: [
            { text: "After a heart attack, beta blockers reduce mortality" },
            { cite: 1 },
            {
              text: ", which is why most patients leave hospital on one. Sotalol is the odd one out: it also prolongs the QT interval",
            },
            { cite: 2 },
            { text: "." },
          ],
        },
        citations: [C.textbook, deletedSource],
      },
    },
    { who: "agent_reviewed", raw: { type: "heading", content: { level: 2, text: "Metoprolol" } } },
    {
      who: "agent",
      raw: {
        type: "drug_card",
        content: {
          name: "metoprolol",
          concept: CONCEPTS.metoprolol,
          brandNames: ["Lopressor", "Toprol-XL"],
          drugClass: { text: "Cardioselective (β1) beta blocker", citations: [C.cardioselective] },
          mechanism: {
            text: "Competitively blocks β1 receptors in the heart, lowering heart rate, contractility and renin release.",
            citations: [C.antagonise],
          },
          indications: [
            { text: "Hypertension", citations: [C.uses] },
            { text: "Angina", citations: [C.uses] },
            { text: "Heart failure (succinate only)", citations: [C.hfMortality] },
          ],
          adverseEffects: [
            { text: "Bradycardia, fatigue", citations: [C.adverse] },
            { text: "Cold extremities, sleep disturbance", citations: [C.adverse] },
            { text: "May mask hypoglycaemia in diabetes", citations: [C.hypo] },
          ],
          contraindications: [
            { text: "Severe bradycardia or heart block", generalKnowledge: true },
            {
              text: "Use caution in asthma (less than non-selective agents)",
              citations: [C.asthma],
            },
          ],
          interactions: [
            {
              text: "CYP2D6 inhibitors (fluoxetine, paroxetine) raise levels",
              citations: [C.cyp],
              flags: [
                {
                  kind: "drug_name",
                  quote: "paroxetine",
                  note: "Read from a small font on the slide; confirm the spelling.",
                },
              ],
            },
          ],
          monitoring: [
            {
              text: "Heart rate and blood pressure; hold if HR < 50 bpm",
              citations: [C.monitor],
              flags: [{ kind: "unit", quote: "50 bpm" }],
            },
          ],
          counselling: [
            { text: "Do not stop suddenly; taper over 1–2 weeks", citations: [C.abrupt, C.patel] },
            { text: "Take with food, at the same time each day", citations: [C.food] },
          ],
          dosingNotes: [
            {
              text: "Hypertension: start 25–50 mg PO BID (tartrate)",
              citations: [C.dose],
              flags: [
                {
                  kind: "dose",
                  quote: "25–50 mg",
                  note: "Check the starting dose against the slide.",
                },
              ],
            },
            {
              text: "Succinate (XL): 25–100 mg once daily",
              citations: [C.succNotes],
              flags: [
                {
                  kind: "dose",
                  quote: "25–100 mg",
                  note: "From your handwritten notes, marked “ask in tutorial”.",
                },
                {
                  kind: "source_conflict",
                  note: "The slide gives no succinate dose; only your notes do.",
                },
              ],
            },
          ],
        },
        citations: [C.tartrate, C.succinate],
      },
    },
    {
      who: "agent_reviewed",
      raw: { type: "heading", content: { level: 2, text: "Comparing the agents" } },
    },
    {
      who: "agent",
      raw: {
        type: "comparison_table",
        content: {
          title: "Beta blockers side by side",
          attributes: ["Selectivity", "Lipid solubility", "Elimination", "Half-life"],
          rows: [
            {
              subject: "Atenolol",
              concept: CONCEPTS.atenolol,
              cells: [
                { text: "β1", citations: [C.atenolol] },
                { text: "Low (hydrophilic)", citations: [C.atenolol] },
                { text: "Renal", citations: [C.atenolol] },
                { text: "6–7 h", citations: [C.atenolol] },
              ],
            },
            {
              subject: "Metoprolol",
              concept: CONCEPTS.metoprolol,
              cells: [
                { text: "β1", citations: [C.metoprolol] },
                { text: "Moderate", citations: [C.metoprolol] },
                { text: "Hepatic (CYP2D6)", citations: [C.metoprolol] },
                { text: "3–7 h", citations: [C.metoprolol] },
              ],
            },
            {
              subject: "Propranolol",
              concept: CONCEPTS.propranolol,
              cells: [
                { text: "β1 + β2", citations: [C.propranolol] },
                { text: "High: vivid dreams, CNS effects", citations: [C.propranolol, C.dreams] },
                { text: "Hepatic", citations: [C.propranolol] },
                { text: "3–6 h", citations: [C.propranolol] },
              ],
            },
            {
              subject: "Carvedilol",
              concept: CONCEPTS.carvedilol,
              cells: [
                { text: "β1 + β2 + α1", citations: [C.carvedilol] },
                { text: "High", generalKnowledge: true },
                { text: "Hepatic", citations: [C.carvedilol] },
                {
                  text: "7–10 h",
                  citations: [C.carvedilol],
                  flags: [
                    { kind: "decimal", quote: "7–10 h", note: "Could read 7–19 h on the slide." },
                  ],
                },
              ],
            },
          ],
        },
        citations: [],
      },
    },
    {
      who: "her_edited",
      raw: {
        type: "table",
        content: {
          rows: [
            ["Adverse effect", "Why it happens"],
            ["Bradycardia", [{ text: "β1 blockade at the " }, { text: "SA node", bold: true }]],
            ["Bronchospasm", "β2 blockade in the airways (non-selective agents)"],
            [
              "Hidden hypoglycaemia",
              [
                { text: "Tremor and " },
                { text: "tachycardia", italic: true },
                { text: " are β-mediated warning signs" },
                { cite: 1 },
              ],
            ],
            ["Cold hands and feet", "Less β2-mediated vasodilation"],
          ],
          headerRow: true,
          caption: "Why the side effects follow from the receptors",
        },
        citations: [C.hypo],
      },
    },
    { who: "agent_reviewed", raw: { type: "heading", content: { level: 2, text: "Cautions" } } },
    {
      who: "agent",
      raw: {
        type: "callout",
        content: {
          kind: "warning",
          title: "Asthma",
          text: [
            { text: "Avoid " },
            { text: "non-selective", bold: true },
            { text: " beta blockers in asthma: β2 blockade can trigger bronchospasm." },
            { cite: 1 },
          ],
        },
        citations: [C.asthma],
      },
    },
    {
      who: "agent",
      raw: {
        type: "mnemonic",
        content: {
          device: "BAD",
          topic: "When to think twice about a beta blocker",
          parts: [
            { key: "B", meaning: "Bradycardia and heart block" },
            { key: "A", meaning: "Asthma (non-selective agents)" },
            {
              key: "D",
              meaning: [{ text: "Diabetes: " }, { text: "masks hypoglycaemia", italic: true }],
            },
          ],
          note: "A memory aid, not from your slides.",
        },
        generalKnowledge: true,
      },
    },
    {
      who: "agent_reviewed",
      raw: {
        type: "quote",
        content: {
          text: "Never stop a beta blocker abruptly: taper over 1–2 weeks to avoid rebound tachycardia.",
          attribution: "Dr Patel, lecture 7",
        },
        citations: [C.abrupt, C.patel],
        flags: [
          {
            kind: "illegible",
            note: "The handwritten source has an unclear word after “abruptly”.",
          },
        ],
      },
    },
    {
      who: "agent_reviewed",
      raw: {
        type: "mind_map",
        content: {
          root: {
            label: "Beta blockers",
            children: [
              {
                label: "Cardioselective (β1)",
                color: "blue",
                children: [
                  { label: "Atenolol" },
                  { label: "Bisoprolol" },
                  { label: "Metoprolol", concept: CONCEPTS.metoprolol },
                ],
              },
              {
                label: "Non-selective",
                color: "orange",
                children: [{ label: "Propranolol" }, { label: "Nadolol" }],
              },
              {
                label: "α1 + β",
                color: "purple",
                children: [{ label: "Carvedilol" }, { label: "Labetalol" }],
              },
              {
                label: "Adverse effects",
                color: "red",
                children: [
                  { label: "Bradycardia" },
                  { label: "Fatigue" },
                  { label: "Bronchospasm" },
                  { label: "Masked hypoglycaemia" },
                ],
              },
            ],
          },
        },
        citations: [C.cardioselective, C.nonSelective, C.alphaNotes],
      },
    },
    {
      who: "agent",
      raw: {
        type: "image",
        content: {
          source: {
            fileId: FILE_IDS.deck,
            pageId: pageAt(FILE_IDS.deck, 4).id,
            region: { x: 0, y: 0, width: 1, height: 0.62 },
          },
          alt: "Slide 4: cardioselective and non-selective agents",
          caption: "Slide 4 from the lecture, cropped",
        },
      },
    },
    { who: "her", raw: { type: "divider" } },
    { who: "her", raw: { type: "heading", content: { level: 2, text: "Before the exam" } } },
    {
      who: "her",
      raw: {
        type: "checklist",
        content: {
          items: [
            { text: "Learn the cardioselective agents", checked: true },
            "Redo quiz 3 on adrenergic drugs",
            "Ask about the metoprolol succinate dose in tutorial",
          ],
        },
      },
    },
    { who: "agent", raw: { type: "question", content: { questionId: mockId("qst", 1) } } },
  ];
}

function makeBlocks(idBase = 100): Block[] {
  return guideInputs().map(({ raw, who }, i) => block(raw, who, i + 1, idBase));
}

export function guideDocument(): DocumentWithBlocks {
  const blocks = makeBlocks();
  return {
    id: GUIDE_ID,
    nodeId: GUIDE_NODE_ID,
    kind: "study_guide",
    title: "Beta blockers",
    blockIds: blocks.map((b) => b.id),
    blocks,
    reviewStatus: documentReviewStatus(blocks),
    revision: 4,
    createdBy: AGENT,
    createdAt: minutes(0),
    lastEditedBy: HER,
    updatedAt: minutes(960),
    trashedAt: null,
  };
}

/** A long document (the guide repeated) for performance checks. */
export function largeDocument(copies = 14): DocumentWithBlocks {
  const blocks: Block[] = [];
  for (let c = 0; c < copies; c++) blocks.push(...makeBlocks(1000 + c * 100));
  return {
    ...guideDocument(),
    id: mockId("doc", 2),
    title: "Beta blockers (long copy)",
    blocks,
    blockIds: blocks.map((b) => b.id),
    reviewStatus: documentReviewStatus(blocks),
  };
}

/** Earlier revisions of the guide (D12), oldest first. */
export function guideRevisions(doc: DocumentWithBlocks): Revision[] {
  const agentOnly = doc.blocks
    .filter((b) => b.provenance.createdBy.type === "agent")
    .map((b) => ({
      ...b,
      origin: "agent" as const,
      review: { status: "unverified" as const, reviewedAt: null },
      provenance: { ...b.provenance, lastEditedBy: AGENT, lastEditedAt: b.provenance.createdAt },
    })) as Block[];
  const first = agentOnly.filter(
    (b) => !["drug_card", "comparison_table", "mind_map"].includes(b.type),
  );
  const snapshot = (blocks: Block[]) => ({ title: doc.title, kind: doc.kind, blocks });
  return [
    {
      id: mockId("rev", 1),
      documentId: doc.id,
      number: 1,
      author: AGENT,
      createdAt: minutes(5),
      summary: `Created with ${first.length} blocks`,
      restoredFrom: null,
      snapshot: snapshot(first),
    },
    {
      id: mockId("rev", 2),
      documentId: doc.id,
      number: 2,
      author: AGENT,
      createdAt: minutes(40),
      summary: "Inserted 3 blocks: drug card, comparison, mind map",
      restoredFrom: null,
      snapshot: snapshot(agentOnly),
    },
    {
      id: mockId("rev", 3),
      documentId: doc.id,
      number: 3,
      author: HER,
      createdAt: minutes(610),
      summary: "Reviewed 9 blocks",
      restoredFrom: null,
      snapshot: snapshot(
        agentOnly.map((b) => {
          const now = doc.blocks.find((d) => d.id === b.id);
          return now && now.review.status === "reviewed" ? { ...b, review: now.review } : b;
        }),
      ),
    },
    {
      id: mockId("rev", 4),
      documentId: doc.id,
      number: 4,
      author: HER,
      createdAt: minutes(960),
      summary: "Edited the table, added an exam tip and a checklist",
      restoredFrom: null,
      snapshot: snapshot(doc.blocks),
    },
  ];
}
