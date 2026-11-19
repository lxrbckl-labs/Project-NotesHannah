import {
  type Actor,
  applyCanvasChange,
  applySetStructure,
  type Block,
  type BlockInputRaw,
  type Canvas,
  deriveCanvas,
  stampNewBlock,
  validateBlockInput,
} from "@notes/schema";
import type { MemoryDocument } from "./memory-store";

/**
 * An invented but realistic study map: a beta-blocker study guide (blocks),
 * a canvas an agent structured (frames, labelled connectors, notes,
 * stickers, a concept card) and a few things she placed by hand.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Stable IDs, so a reloaded demo finds its saved canvas. */
export function seqId(prefix: string, n: number): string {
  let body = "";
  let v = n;
  for (let i = 0; i < 26; i++) {
    body = CROCKFORD[v % 32] + body;
    v = Math.floor(v / 32);
  }
  return `${prefix}_01J${body.slice(3)}`;
}

export const DEMO_DOCUMENT_ID = seqId("doc", 1);
export const DEMO_USER: Actor = { type: "user", userId: seqId("usr", 1) };
const AGENT: Actor = { type: "agent", keyId: seqId("key", 1), label: "Claude Code" };
const T = "2026-11-14T20:15:00.000Z";

const slides = seqId("fil", 1);
const cite = (page: number, quote: string, label: string) => ({
  fileId: slides,
  pageId: seqId("pag", page),
  quote,
  label,
});

const RAW: Array<[ref: string, block: BlockInputRaw]> = [
  ["title", { type: "heading", content: { level: 1, text: "Beta blockers" } }],
  [
    "intro",
    {
      type: "paragraph",
      content: {
        text: "Beta blockers (the “-olols”) compete with adrenaline and noradrenaline at β-adrenergic receptors. They treat hypertension, angina, heart failure and arrhythmias.",
      },
      citations: [cite(3, "Beta blockers compete with catecholamines at β receptors", "Slide 3")],
    },
  ],
  ["h-mech", { type: "heading", content: { level: 2, text: "Mechanism" } }],
  [
    "mech",
    {
      type: "paragraph",
      content: {
        text: "Blocking β1 receptors in the heart lowers heart rate and contractility, so the heart needs less oxygen. Blocking β1 in the kidney lowers renin release.",
      },
      citations: [cite(5, "β1 blockade: ↓ HR, ↓ contractility, ↓ renin", "Slide 5")],
    },
  ],
  [
    "receptors",
    {
      type: "callout",
      content: {
        kind: "definition",
        title: "β1 vs β2",
        text: "β1: heart and kidney (you have 1 heart). β2: lungs and vessels (you have 2 lungs).",
      },
      generalKnowledge: true,
    },
  ],
  [
    "effects",
    {
      type: "bulleted_list",
      content: {
        items: [
          "↓ Heart rate",
          "↓ Contractility",
          "↓ Renin → ↓ blood pressure",
          "↓ Myocardial oxygen demand",
        ],
      },
      citations: [cite(5, "↓ HR, ↓ contractility, ↓ renin", "Slide 5")],
    },
  ],
  ["h-sel", { type: "heading", content: { level: 2, text: "Selective vs non-selective" } }],
  [
    "compare",
    {
      type: "comparison_table",
      content: {
        title: "Which receptors?",
        attributes: ["Selectivity", "Lipid soluble", "Worth knowing"],
        rows: [
          { subject: "Atenolol", cells: ["β1", "No", "Renally cleared"] },
          { subject: "Metoprolol", cells: ["β1", "Yes", "Take with food"] },
          { subject: "Propranolol", cells: ["β1 + β2", "Yes", "Migraine, tremor"] },
          { subject: "Carvedilol", cells: ["β1 + β2 + α1", "Yes", "Heart failure"] },
        ],
      },
      citations: [cite(9, "Cardioselective (β1): atenolol, metoprolol, bisoprolol", "Slide 9")],
    },
  ],
  [
    "metoprolol",
    {
      type: "drug_card",
      content: {
        name: "metoprolol",
        brandNames: ["Lopressor", "Toprol-XL"],
        drugClass: "Cardioselective (β1) beta blocker",
        mechanism: "Blocks β1 receptors in the heart.",
        indications: ["Hypertension", "Angina", "Heart failure (succinate)"],
        adverseEffects: ["Bradycardia", "Fatigue", "Dizziness"],
        counselling: ["Take with or right after food", "Do not stop suddenly"],
      },
      citations: [cite(11, "Metoprolol: β1-selective; take with food", "Slide 11")],
    },
  ],
  [
    "propranolol",
    {
      type: "drug_card",
      content: {
        name: "propranolol",
        brandNames: ["Inderal"],
        drugClass: "Non-selective beta blocker",
        mechanism: "Blocks β1 and β2 receptors.",
        indications: ["Hypertension", "Migraine prevention", "Essential tremor"],
        adverseEffects: ["Bronchospasm", "Cold hands", "Vivid dreams"],
        counselling: ["Avoid if you have asthma"],
      },
      citations: [cite(12, "Propranolol: non-selective; avoid in asthma", "Slide 12")],
    },
  ],
  [
    "selective-tip",
    {
      type: "callout",
      content: {
        kind: "exam_tip",
        text: "A to M are cardioselective: atenolol, betaxolol, bisoprolol, esmolol, metoprolol.",
      },
      generalKnowledge: true,
    },
  ],
  ["h-adverse", { type: "heading", content: { level: 2, text: "Adverse effects" } }],
  [
    "adverse",
    {
      type: "bulleted_list",
      content: {
        items: [
          "Bradycardia and heart block",
          "Fatigue, cold extremities",
          "Bronchospasm (β2)",
          "Masked hypoglycaemia",
        ],
      },
      citations: [cite(14, "Adverse effects: bradycardia, fatigue, bronchospasm", "Slide 14")],
    },
  ],
  [
    "asthma",
    {
      type: "callout",
      content: {
        kind: "warning",
        title: "Asthma",
        text: "Non-selective agents can trigger bronchospasm. Avoid them in asthma; use cardioselective agents with care.",
      },
      citations: [cite(14, "avoid non-selective agents in asthma", "Slide 14")],
    },
  ],
  [
    "hypo",
    {
      type: "paragraph",
      content: {
        text: "Beta blockers hide the tremor and racing heart of hypoglycaemia. Sweating still happens, so teach patients with diabetes to watch for it.",
      },
      citations: [cite(15, "masks tachycardia of hypoglycaemia; sweating preserved", "Slide 15")],
    },
  ],
  ["h-counsel", { type: "heading", content: { level: 2, text: "Counseling" } }],
  [
    "counsel",
    {
      type: "numbered_list",
      content: {
        items: [
          "Take at the same time each day",
          "Do not stop suddenly; the dose is tapered",
          "Stand up slowly if dizzy",
          "Check your pulse if told to",
        ],
      },
      citations: [cite(17, "Counsel: do not stop abruptly; taper", "Slide 17")],
    },
  ],
  [
    "withdrawal",
    {
      type: "callout",
      content: {
        kind: "important",
        title: "Never stop abruptly",
        text: "Receptors up-regulate during treatment. Sudden withdrawal can cause rebound tachycardia, angina or infarction.",
      },
      citations: [cite(17, "abrupt withdrawal → rebound tachycardia, angina", "Slide 17")],
    },
  ],
  [
    "questions",
    {
      type: "table",
      content: {
        rows: [
          ["She asks", "You say"],
          [
            "Can I skip a dose if I feel fine?",
            "No: take it daily, it works when you feel well too.",
          ],
          ["Why are my hands cold?", "A common, harmless effect; keep them warm."],
        ],
      },
      citations: [cite(18, "Common patient questions", "Slide 18")],
    },
  ],
];

function buildBlocks(): { blocks: Block[]; ref: Record<string, string> } {
  const ref: Record<string, string> = {};
  const blocks = RAW.map(([name, raw], i) => {
    const valid = validateBlockInput(raw, { writer: "agent" });
    if (!valid.ok) throw new Error(`Seed block ${name}: ${JSON.stringify(valid.problems)}`);
    const block = stampNewBlock(valid.block, { actor: AGENT, now: T, id: seqId("blk", 100 + i) });
    ref[name] = block.id;
    return block;
  });
  return { blocks, ref };
}

let counter = 500;
const nextId = (kind: "card" | "edge" | "frame") =>
  seqId(kind === "card" ? "crd" : kind === "edge" ? "edg" : "frm", ++counter);

export function buildSeed(): { document: MemoryDocument; ref: Record<string, string> } {
  counter = 500;
  const { blocks, ref } = buildBlocks();
  const derived = deriveCanvas(DEMO_DOCUMENT_ID, blocks, { now: T, newId: nextId });
  const card = (name: string) => ({ ref: name, content: { kind: "block", blockIds: [ref[name]] } });
  const structured = applySetStructure(
    derived,
    {
      documentId: DEMO_DOCUMENT_ID,
      cards: [
        card("intro"),
        card("mech"),
        card("receptors"),
        card("effects"),
        { ...card("compare"), size: "wide" },
        card("metoprolol"),
        card("propranolol"),
        { ...card("selective-tip"), color: "yellow" },
        card("adverse"),
        { ...card("asthma"), size: "medium" },
        card("hypo"),
        card("counsel"),
        card("withdrawal"),
        card("questions"),
        {
          ref: "beta1",
          content: { kind: "concept", conceptId: seqId("con", 1), label: "β1 receptor" },
          color: "blue",
        },
        {
          ref: "olol",
          content: {
            kind: "note",
            text: "Spot them: generic names end in -olol (carvedilol, labetalol: -alol).",
          },
          color: "green",
        },
      ],
      connectors: [
        { from: "beta1", to: "mech", kind: "part_of", label: "target" },
        { from: "mech", to: "effects", kind: "leads_to", label: "so" },
        { from: "effects", to: "adverse", kind: "causes", label: "too much of it" },
        { from: "receptors", to: "asthma", kind: "causes", label: "β2 blockade" },
        { from: "compare", to: "metoprolol", kind: "part_of", label: "β1 only" },
        { from: "compare", to: "propranolol", kind: "part_of", label: "β1 + β2" },
        { from: "propranolol", to: "asthma", kind: "contrasts", label: "avoid in asthma" },
        { from: "metoprolol", to: "counsel", kind: "related", label: "counsel" },
        { from: "mech", to: "withdrawal", kind: "leads_to", label: "receptors up-regulate" },
        { from: "propranolol", to: "hypo", kind: "causes", label: "masks symptoms" },
      ],
      frames: [
        {
          ref: "f-mech",
          title: "Mechanism",
          members: ["beta1", "mech", "receptors", "effects"],
          color: "blue",
        },
        {
          ref: "f-sel",
          title: "Selective vs non-selective",
          members: ["compare", "metoprolol", "propranolol", "selective-tip", "olol"],
          color: "purple",
        },
        {
          ref: "f-adverse",
          title: "Adverse effects",
          members: ["adverse", "asthma", "hypo"],
          color: "red",
        },
        {
          ref: "f-counsel",
          title: "Counseling",
          members: ["counsel", "withdrawal", "questions"],
          color: "green",
        },
      ],
    },
    { actor: AGENT, now: T, newId: nextId },
  );
  if (!structured.ok) throw new Error(`Seed structure: ${JSON.stringify(structured.problems)}`);
  const refs = structured.report.refs;

  // What she did by hand: her own note, a few stickers, one card dragged.
  const hers = applyCanvasChange(
    structured.canvas,
    {
      documentId: DEMO_DOCUMENT_ID,
      ops: [
        {
          op: "add_card",
          card: {
            ref: "mine",
            content: { kind: "note", text: "Ask Dr Patel: is labetalol on the exam?" },
            color: "pink",
          },
        },
        { op: "add_card", card: { ref: "star", content: { kind: "sticker", sticker: "star" } } },
        { op: "add_card", card: { ref: "warn", content: { kind: "sticker", sticker: "warning" } } },
        {
          op: "add_card",
          card: { ref: "bulb", content: { kind: "sticker", sticker: "lightbulb" } },
        },
        { op: "add_to_frame", frame: refs["f-sel"], cards: ["star"] },
        { op: "add_to_frame", frame: refs["f-adverse"], cards: ["warn"] },
        { op: "add_to_frame", frame: refs["f-mech"], cards: ["bulb"] },
      ],
    },
    { actor: DEMO_USER, now: T, newId: nextId },
  );
  if (!hers.ok) throw new Error(`Seed edits: ${JSON.stringify(hers.problems)}`);
  const own = hers.report.refs;
  const pinned = applyCanvasChange(
    hers.canvas,
    {
      documentId: DEMO_DOCUMENT_ID,
      ops: [
        {
          op: "place_cards",
          placements: [{ id: own.mine as string, x: -340, y: 40 }],
        },
      ],
    },
    { actor: DEMO_USER, now: T },
  );
  if (!pinned.ok) throw new Error(`Seed pins: ${JSON.stringify(pinned.problems)}`);
  return {
    document: {
      id: DEMO_DOCUMENT_ID,
      title: "Beta blockers · study guide",
      blocks,
      canvas: pinned.canvas,
    },
    ref: { ...ref, ...refs, ...own },
  };
}

export type SeedCanvas = Canvas;
