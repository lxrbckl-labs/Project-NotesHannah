import {
  COURSE_SECTIONS,
  type FileStatus,
  type FileType,
  type LibraryNode,
  type NodeKind,
  newId,
  type Page,
  type SectionKind,
  type SourceFile,
  type Transcript,
} from "@notes/schema";

export const MOCK_USERNAME = "hannah";
export const MOCK_PASSWORD = "study-notes-2026";

const SEEDED_AT = "2026-08-20T14:00:00.000Z";

export interface SeedBlock {
  documentId: string;
  nodeId: string;
  documentTitle: string;
  blockId: string;
  text: string;
}

export interface SeedActivity {
  id: number;
  at: string;
  keyId: string;
  keyLabel: string | null;
  action: string;
  summary: string;
  links: Array<{ type: string; id: string; nodeId?: string; documentId?: string; label?: string }>;
}

/** Pages for a converted file: slides and PDF pages carry native text, photos do not. */
export function makePages(file: SourceFile): Page[] {
  const count = file.pageCount ?? 0;
  return Array.from({ length: count }, (_, i) => ({
    id: newId("page"),
    fileId: file.id,
    index: i + 1,
    width: 1280,
    height: file.type === "pptx" ? 720 : 1650,
    hasTextLayer:
      file.type === "pptx" || (file.type === "pdf" && !file.originalName.includes("handwritten")),
    nativeText:
      file.type === "pptx" || file.type === "pdf"
        ? file.originalName.includes("handwritten")
          ? null
          : `Slide ${i + 1}. Beta blockers reduce heart rate. Metoprolol 50 mg PO BID.`
        : null,
    speakerNotes: file.type === "pptx" && i === 0 ? "Remind them: start low and go slow." : null,
    transcriptId: null,
  }));
}

export interface SeedResult {
  userId: string;
  nodes: LibraryNode[];
  files: SourceFile[];
  pages: Page[];
  transcripts: Transcript[];
  blocks: SeedBlock[];
  activity: SeedActivity[];
  /** Most recently opened first. */
  recents: string[];
}

/** A small, believable library: two terms, a few courses, numbered and dated lectures. */
export function seedLibrary(userId: string): SeedResult {
  const nodes: LibraryNode[] = [];
  const files: SourceFile[] = [];

  function file(
    nodeId: string | null,
    originalName: string,
    type: FileType,
    pageCount: number,
    status: FileStatus,
  ): SourceFile {
    const f: SourceFile = {
      id: newId("file"),
      userId,
      nodeId,
      originalName,
      sha256: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
      bytes: Math.max(1, pageCount) * 180_000,
      type,
      status,
      errorCode: null,
      errorMessage: null,
      pageCount,
      uploadedBy: { type: "user", userId },
      claimedBy: null,
      claimedAt: null,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
      trashedAt: null,
    };
    files.push(f);
    return f;
  }
  const orderByParent = new Map<string | null, number>();

  function add(
    parentId: string | null,
    kind: NodeKind,
    name: string,
    extra: Partial<LibraryNode> = {},
  ): LibraryNode {
    const order = (orderByParent.get(parentId) ?? 0) + 1;
    orderByParent.set(parentId, order);
    const node: LibraryNode = {
      id: newId("node"),
      userId,
      parentId,
      kind,
      name,
      section: null,
      course: kind === "course" ? { code: null } : null,
      lecture: kind === "lecture" ? { number: null, date: null } : null,
      sortKey: String(order).padStart(12, "0"),
      favourite: false,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
      trashedAt: null,
      ...extra,
    };
    nodes.push(node);
    return node;
  }

  function course(termId: string, name: string, code: string) {
    const c = add(termId, "course", name, { course: { code } });
    const sections = {} as Record<SectionKind, LibraryNode>;
    for (const { section, name: sectionName } of COURSE_SECTIONS) {
      sections[section] = add(c.id, "section", sectionName, { section });
    }
    return { course: c, sections };
  }

  function lecture(parentId: string, number: number, name: string, date: string) {
    return add(parentId, "lecture", name, { lecture: { number, date } });
  }

  const fall = add(null, "term", "Fall 2026");
  const spring = add(null, "term", "Spring 2027");

  const pharm2 = course(fall.id, "Pharmacology II", "PHAR 7340");
  const lectures: Array<[string, string]> = [
    ["Autonomic overview", "2026-08-26"],
    ["Cholinergic agents", "2026-09-02"],
    ["Adrenergic agonists", "2026-09-09"],
    ["Adrenergic antagonists", "2026-09-16"],
    ["Calcium channel blockers", "2026-09-30"],
    ["Antiarrhythmics", "2026-10-07"],
    ["Beta blockers", "2026-10-14"],
    ["ACE inhibitors and ARBs", "2026-10-21"],
    ["Diuretics", "2026-10-28"],
  ];
  const created = lectures.map(([name, date], i) =>
    lecture(pharm2.sections.lectures.id, i + 1, name, date),
  );
  const betaBlockers = created[6] as LibraryNode;
  created.forEach((l, i) => {
    const n = String(i + 1).padStart(2, "0");
    file(l.id, `Lecture ${n} slides.pptx`, "pptx", 28 + i, "filed");
    file(
      l.id,
      `Lecture ${n} handwritten notes.pdf`,
      "pdf",
      4 + (i % 4),
      i < 6 ? "filed" : "converted",
    );
  });
  add(betaBlockers.id, "document", "Slide transcript");
  const week1 = add(pharm2.sections.sources.id, "folder", "Week 1 slides");
  add(week1.id, "document", "Autonomic nervous system.pptx");
  add(pharm2.sections.sources.id, "document", "Syllabus.pdf");
  const cardio = add(pharm2.sections.study_guides.id, "folder", "Cardiovascular");
  add(cardio.id, "document", "Beta blocker cheat sheet");
  add(pharm2.sections.study_guides.id, "document", "Autonomic drugs at a glance");
  add(pharm2.sections.practice.id, "document", "Cardio quiz");
  add(pharm2.sections.exams.id, "document", "Exam 2 (lectures 5 to 9)");

  const therapy = course(fall.id, "Pharmacotherapy I", "PHAR 7310");
  const t1 = lecture(therapy.sections.lectures.id, 1, "Hypertension guidelines", "2026-08-27");
  file(t1.id, "Lecture 01 slides.pptx", "pptx", 34, "filed");
  file(t1.id, "Lecture 01 handwritten notes.pdf", "pdf", 5, "converted");
  lecture(therapy.sections.lectures.id, 2, "Heart failure", "2026-09-03");
  lecture(therapy.sections.lectures.id, 3, "Dyslipidemia", "2026-09-10");
  add(therapy.sections.study_guides.id, "document", "Hypertension algorithm");

  course(fall.id, "Medicinal Chemistry", "PHAR 7320");

  const pk = course(spring.id, "Pharmacokinetics", "PHAR 7420");
  lecture(pk.sections.lectures.id, 1, "Absorption and bioavailability", "2027-01-12");

  for (const favourite of [pharm2.course, betaBlockers]) favourite.favourite = true;

  const recents = [betaBlockers.id, t1.id, cardio.id, pharm2.course.id];
  file(null, "Whiteboard photo.jpeg", "jpeg", 1, "converted");
  file(null, "Lecture 10 slides.pptx", "pptx", 31, "converting");
  const locked = file(null, "Locked notes.pdf", "pdf", 0, "failed");
  locked.pageCount = null;
  locked.errorCode = "encrypted_file";
  locked.errorMessage = "This PDF is password protected.";

  // Pages for every file that has been converted; transcripts for the finished ones.
  const pages: Page[] = [];
  const transcripts: Transcript[] = [];
  const author = { type: "agent" as const, keyId: newId("apiKey"), label: "Claude Code" };
  for (const f of files) {
    if (f.status === "uploaded" || f.status === "converting" || f.status === "failed") continue;
    const made = makePages(f);
    pages.push(...made);
    if (f.status !== "transcribed" && f.status !== "filed") continue;
    for (const p of made) {
      const base = `Slide ${p.index}\nBeta blockers reduce heart rate and blood pressure.\nMetoprolol 50 mg PO BID, titrate to effect.`;
      const flagged = [
        { kind: "dose" as const, quote: "50 mg", note: "Check the dose against the slide." },
        { kind: "drug_name" as const, quote: "Metoprolol" },
      ];
      if (p.index === 1) {
        const first: Transcript = {
          id: newId("transcript"),
          pageId: p.id,
          text: base.replace("50 mg", "5O mg"),
          flags: [{ kind: "uncertain" as const, quote: "5O mg" }],
          author,
          reviewStatus: "unverified",
          reviewedAt: null,
          revision: 1,
          createdAt: "2026-11-10T10:00:00.000Z",
        };
        transcripts.push(first);
      }
      const current: Transcript = {
        id: newId("transcript"),
        pageId: p.id,
        text: base,
        flags: flagged,
        author,
        reviewStatus: p.index === 2 ? "reviewed" : "unverified",
        reviewedAt: p.index === 2 ? "2026-11-12T09:00:00.000Z" : null,
        revision: p.index === 1 ? 2 : 1,
        createdAt: "2026-11-11T10:00:00.000Z",
      };
      transcripts.push(current);
      p.transcriptId = current.id;
    }
  }

  const slides7 = files.find((f) => f.originalName === "Lecture 07 slides.pptx");
  const doc = nodes.find((n) => n.name === "Beta blocker cheat sheet");
  const blocks: SeedBlock[] = doc
    ? [
        {
          documentId: newId("document"),
          nodeId: doc.id,
          documentTitle: doc.name,
          blockId: newId("block"),
          text: "Beta blockers end in -olol. Metoprolol is beta-1 selective.",
        },
      ]
    : [];
  const activity: SeedActivity[] = [
    {
      id: 3,
      at: "2026-11-14T21:05:00.000Z",
      keyId: "key_seed",
      keyLabel: "Claude Code",
      action: "file.filed",
      summary: `Filed Lecture 07 slides.pptx under lecture 07 · Beta blockers`,
      links: [
        { type: "node", id: betaBlockers.id, nodeId: betaBlockers.id, label: "Beta blockers" },
      ],
    },
    {
      id: 2,
      at: "2026-11-14T20:40:00.000Z",
      keyId: "key_seed",
      keyLabel: "Claude Code",
      action: "transcript.saved",
      summary: "Transcribed page 2 of Lecture 07 slides.pptx",
      links: slides7 ? [{ type: "file", id: slides7.id, label: slides7.originalName }] : [],
    },
    {
      id: 1,
      at: "2026-11-13T18:00:00.000Z",
      keyId: "key_seed",
      keyLabel: "Claude Code",
      action: "library.created",
      summary: "Created lecture 08 · ACE inhibitors and ARBs",
      links: [{ type: "node", id: created[7]?.id ?? betaBlockers.id, nodeId: created[7]?.id }],
    },
  ];

  return { userId, nodes, files, pages, transcripts, blocks, activity, recents };
}
