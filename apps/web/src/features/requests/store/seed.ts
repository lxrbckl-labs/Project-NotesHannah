import type { RequestLink, RequestStatus, StudyRequestWithContext } from "@notes/schema";

/**
 * An invented set of requests for the demo, tests and screenshots: a dozen in every state, with
 * agent replies and links. Times are relative to `now` so the demo always reads as "recent".
 */

const pad = (n: number) => `${"0".repeat(22)}${String(n).padStart(4, "0")}`;
export const rid = (n: number) => `req_${pad(n)}`;
export const nid = (n: number) => `nod_${pad(n)}`;
export const did = (n: number) => `doc_${pad(n)}`;
export const bid = (n: number) => `blk_${pad(n)}`;
export const fid = (n: number) => `fil_${pad(n)}`;
export const pgid = (n: number) => `pag_${pad(n)}`;
export const qid = (n: number) => `qst_${pad(n)}`;
export const cid = (n: number) => `con_${pad(n)}`;
const USER = `usr_${pad(1)}`;

/** Names the mock knows for targets, so a request made in the demo also gets a name and a path. */
export const KNOWN: Record<string, { name: string; path: string; preview?: string }> = {
  [nid(1)]: { name: "Beta blockers", path: "Spring 2027 / Cardiovascular Pharmacology / Lectures" },
  [nid(2)]: {
    name: "ACE inhibitors and ARBs",
    path: "Spring 2027 / Cardiovascular Pharmacology / Lectures",
  },
  [nid(3)]: { name: "Anticoagulants", path: "Spring 2027 / Pharmacotherapy II / Lectures" },
  [did(1)]: {
    name: "Beta blockers: study guide",
    path: "Spring 2027 / Cardiovascular Pharmacology / Lectures",
  },
  [did(2)]: { name: "Heart failure drugs", path: "Spring 2027 / Pharmacotherapy II / Lectures" },
  [fid(1)]: {
    name: "Beta blockers slides.pdf",
    path: "Spring 2027 / Cardiovascular Pharmacology / Lectures",
  },
  [qid(1)]: {
    name: "Question 14",
    path: "Practice / Cardiovascular Pharmacology",
    preview: "Which beta blocker is least likely to cross the blood-brain barrier?",
  },
};

export function describeTarget(
  target: StudyRequestWithContext["target"],
): StudyRequestWithContext["context"] {
  const key =
    target.type === "node"
      ? target.nodeId
      : target.type === "document" || target.type === "block"
        ? target.documentId
        : target.type === "source"
          ? target.fileId
          : target.type === "question"
            ? target.questionId
            : "";
  const known = KNOWN[key];
  const nodeId =
    target.type === "node"
      ? target.nodeId
      : target.type === "document" || target.type === "block"
        ? nid(1)
        : null;
  return {
    name: target.type === "library" ? "Library" : (known?.name ?? null),
    path: known?.path ?? null,
    preview:
      target.type === "block"
        ? "Atenolol is highly lipid soluble and crosses the blood-brain barrier."
        : (known?.preview ?? null),
    nodeId,
    note: null,
  };
}

interface Seed {
  n: number;
  target: StudyRequestWithContext["target"];
  kind: StudyRequestWithContext["kind"];
  message: string;
  status: RequestStatus;
  /** Minutes before now the request was left. */
  ago: number;
  reply?: { text: string; links?: RequestLink[]; minutesAfter: number; unsourced?: string[] };
  reopens?: Array<{
    note: string;
    ago: number;
    previousReply: string;
    previousStatus: "done" | "declined";
  }>;
  note?: string;
}

const SEEDS: Seed[] = [
  {
    n: 1,
    target: { type: "block", documentId: did(1), blockId: bid(1) },
    kind: "wrong",
    message: "Atenolol is hydrophilic, not lipid soluble. Check slide 12.",
    status: "waiting",
    ago: 14,
  },
  {
    n: 2,
    target: { type: "node", nodeId: nid(2) },
    kind: "make_questions",
    message: "",
    status: "waiting",
    ago: 95,
  },
  {
    n: 3,
    target: { type: "document", documentId: did(2) },
    kind: "other",
    message:
      "Add a table comparing sacubitril/valsartan, ACE inhibitors and ARBs for HFrEF, with the monitoring for each.",
    status: "in_progress",
    ago: 180,
  },
  {
    n: 4,
    target: { type: "node", nodeId: nid(1) },
    kind: "summarise",
    message: "",
    status: "done",
    ago: 60 * 26,
    reply: {
      minutesAfter: 40,
      text: "I wrote a one-page summary at the top of the lecture: classes (non-selective, beta-1 selective, with intrinsic sympathomimetic activity, with alpha-blocking), the main uses, and the adverse effects that come up most. Every claim cites a slide.",
      links: [{ type: "document", documentId: did(1), label: "Beta blockers: study guide" }],
    },
  },
  {
    n: 5,
    target: { type: "block", documentId: did(1), blockId: bid(2) },
    kind: "unclear",
    message: "I do not get why propranolol is avoided in asthma but metoprolol is sometimes used.",
    status: "done",
    ago: 60 * 30,
    reply: {
      unsourced: ["40 mg daily"],
      minutesAfter: 25,
      text: "Rewrote the card in plainer words: beta-2 receptors keep the airways open, so blocking them can trigger bronchospasm. Metoprolol blocks mostly beta-1, so it is less likely to, though selectivity fades at higher doses. Added a worked comparison and a source.",
      links: [
        { type: "block", documentId: did(1), blockId: bid(2), label: "Selectivity card" },
        { type: "source", fileId: fid(1), pageId: pgid(12), label: "Slide 12" },
      ],
    },
  },
  {
    n: 6,
    target: { type: "question", questionId: qid(1) },
    kind: "wrong",
    message: "I think the answer key is wrong: nadolol is hydrophilic too.",
    status: "done",
    ago: 60 * 52,
    reply: {
      minutesAfter: 90,
      text: "You are right: nadolol and atenolol are both hydrophilic, so the key now accepts either as the least CNS-penetrant. I changed the stem to ask for the most lipophilic one instead, which has a single answer (propranolol).",
      links: [
        { type: "question", questionId: qid(1), label: "Question 14" },
        { type: "concept", conceptId: cid(1), label: "Propranolol" },
      ],
    },
    reopens: [
      {
        note: "The explanation still says atenolol only.",
        ago: 60 * 50,
        previousStatus: "done",
        previousReply: "Fixed the answer key to accept nadolol as well.",
      },
    ],
  },
  {
    n: 7,
    target: { type: "source", fileId: fid(1), pageId: pgid(12) },
    kind: "wrong",
    message: "The transcript reads 25 mg but the slide says 2.5 mg for bisoprolol starting dose.",
    status: "done",
    ago: 60 * 70,
    reply: {
      minutesAfter: 12,
      text: "Corrected the transcript to 2.5 mg and updated the one study guide line that repeated the wrong number.",
      links: [{ type: "source", fileId: fid(1), pageId: pgid(12), label: "Slide 12" }],
    },
  },
  {
    n: 8,
    target: { type: "node", nodeId: nid(3) },
    kind: "quiz_me",
    message: "Focus on warfarin interactions please.",
    status: "declined",
    ago: 60 * 48,
    reply: {
      minutesAfter: 20,
      text: "There are no warfarin interaction slides in this lecture yet, so I would have to guess. Upload the pages that cover them, or point me to a lecture that does, and I will build the quiz from those.",
    },
  },
  {
    n: 9,
    target: { type: "library" },
    kind: "other",
    message: "Make a study plan for the cardiology exam on the 14th, three weeks out.",
    status: "done",
    ago: 60 * 96,
    reply: {
      minutesAfter: 55,
      text: "Added a three-week plan: week one is mechanisms and classes, week two adverse effects and interactions, week three mixed practice. Each day lists the lectures and the number of questions. It sits in the library next to your exam date.",
      links: [{ type: "node", nodeId: nid(1), label: "Cardiology exam plan" }],
    },
  },
  {
    n: 10,
    target: { type: "document", documentId: did(1) },
    kind: "more_like_this",
    message: "Make more cards like the one on cardioselectivity, for the other classes.",
    status: "cancelled",
    ago: 60 * 120,
  },
  {
    n: 11,
    target: { type: "node", nodeId: nid(2) },
    kind: "expand",
    message: "More on why ACE inhibitors cause cough and how it differs from ARBs.",
    status: "waiting",
    ago: 60 * 5,
  },
  {
    n: 12,
    target: { type: "document", documentId: did(2) },
    kind: "unclear",
    message: "",
    status: "done",
    ago: 60 * 8,
    reply: {
      minutesAfter: 18,
      text: "Reworded the section on neprilysin: it breaks down natriuretic peptides, so blocking it keeps their effect longer. Added a diagram of the two pathways.",
      links: [{ type: "document", documentId: did(2), label: "Heart failure drugs" }],
    },
  },
];

const minute = 60_000;

export function seedRequests(now: number): StudyRequestWithContext[] {
  return SEEDS.map((s) => {
    const createdAt = new Date(now - s.ago * minute).toISOString();
    const answeredAt = s.reply
      ? new Date(now - s.ago * minute + s.reply.minutesAfter * minute).toISOString()
      : null;
    const closed = s.status === "done" || s.status === "declined" || s.status === "cancelled";
    return {
      id: rid(s.n),
      userId: USER,
      target: s.target,
      kind: s.kind,
      message: s.message,
      status: s.status,
      createdBy: { type: "user", userId: USER },
      claimedBy:
        s.status === "in_progress"
          ? { type: "agent", keyId: `key_${pad(7)}`, label: "Study agent" }
          : null,
      claimedAt: s.status === "in_progress" ? new Date(now - 4 * minute).toISOString() : null,
      claimExpiresAt: s.status === "in_progress" ? new Date(now + 26 * minute).toISOString() : null,
      reply:
        s.reply && answeredAt
          ? {
              text: s.reply.text,
              links: s.reply.links ?? [],
              ...(s.reply.unsourced
                ? { unsourcedFigures: true, unsourcedFigureList: s.reply.unsourced }
                : {}),
              by: { type: "agent", keyId: `key_${pad(7)}`, label: "Study agent" },
              at: answeredAt,
            }
          : null,
      reopens: (s.reopens ?? []).map((r) => ({
        at: new Date(now - r.ago * minute).toISOString(),
        note: r.note,
        previousStatus: r.previousStatus,
        previousReply: {
          text: r.previousReply,
          links: [],
          by: { type: "agent", keyId: `key_${pad(7)}`, label: "Study agent" },
          at: new Date(now - (r.ago + 20) * minute).toISOString(),
        },
      })),
      createdAt,
      updatedAt: answeredAt ?? createdAt,
      closedAt: closed ? (answeredAt ?? createdAt) : null,
      context: describeTarget(s.target),
    } satisfies StudyRequestWithContext;
  });
}
