import {
  COURSE_SECTIONS,
  type FileStatus,
  type FileType,
  type LibraryNode,
  type NodeKind,
  newId,
  type SectionKind,
  type SourceFile,
} from "@notes/schema";

export const MOCK_USERNAME = "hannah";
export const MOCK_PASSWORD = "study-notes-2026";

const SEEDED_AT = "2026-08-20T14:00:00.000Z";

export interface SeedResult {
  userId: string;
  nodes: LibraryNode[];
  files: SourceFile[];
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
      bytes: pageCount * 180_000,
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
    file(l.id, `Lecture ${n} slides.pptx`, "pptx", 28 + i, "transcribed");
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
  file(t1.id, "Lecture 01 slides.pptx", "pptx", 34, "transcribed");
  file(t1.id, "Lecture 01 handwritten notes.pdf", "pdf", 5, "converted");
  lecture(therapy.sections.lectures.id, 2, "Heart failure", "2026-09-03");
  lecture(therapy.sections.lectures.id, 3, "Dyslipidemia", "2026-09-10");
  add(therapy.sections.study_guides.id, "document", "Hypertension algorithm");

  course(fall.id, "Medicinal Chemistry", "PHAR 7320");

  const pk = course(spring.id, "Pharmacokinetics", "PHAR 7420");
  lecture(pk.sections.lectures.id, 1, "Absorption and bioavailability", "2027-01-12");

  for (const favourite of [pharm2.course, betaBlockers]) favourite.favourite = true;

  const recents = [betaBlockers.id, t1.id, cardio.id, pharm2.course.id];
  file(null, "Whiteboard photo.jpeg", "jpeg", 1, "uploaded");
  file(null, "Lecture 10 slides.pptx", "pptx", 31, "converting");

  return { userId, nodes, files, recents };
}
