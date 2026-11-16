import { blockPlainText, findQuote, type MentionedIn, type QuestionLink } from "@notes/schema";
import type { Db } from "../../db/client.js";

/** A citation as the source lookup sees it. */
export interface ConceptSourceRef {
  fileId: string;
  pageId: string;
  quote: string;
}

/** What the files domain knows about one cited page. */
export interface ConceptSourceInfo {
  /** False when the lookup cannot say: the citation is then accepted and shown as available. */
  known: boolean;
  /** The page exists (trashed ones still do). False once permanently deleted. */
  exists: boolean;
  trashed: boolean;
  fileName: string | null;
  /** 1-based page number in the file. */
  pageIndex: number | null;
  /** Whether the quote occurs, character for character, in the current transcript. Null when unknown. */
  quoteFound: boolean | null;
}

/**
 * The narrow view of the files domain that concepts need. Structurally the
 * same as the documents domain's `SourceLookup`, so the integrator can pass
 * one adapter to both. `resolve` answers one entry per ref, in order, and
 * only for sources owned by `userId`.
 */
export interface ConceptSources {
  resolve(userId: string, refs: readonly ConceptSourceRef[]): ConceptSourceInfo[];
}

const UNKNOWN: ConceptSourceInfo = {
  known: false,
  exists: true,
  trashed: false,
  fileName: null,
  pageIndex: null,
  quoteFound: null,
};

/** Default until the files domain is plugged in: every source is unknown but allowed. */
export const unknownConceptSources: ConceptSources = {
  resolve: (_userId, refs) => refs.map(() => ({ ...UNKNOWN })),
};

export interface FakeConceptPage {
  userId: string;
  fileId: string;
  pageId: string;
  fileName: string;
  pageIndex: number;
  transcript: string | null;
  trashed?: boolean;
}

export interface FakeConceptSources extends ConceptSources {
  addPage(page: FakeConceptPage): void;
  trash(fileId: string): void;
  purge(fileId: string): void;
}

/** An in-memory source lookup for tests. Pages never added are unknown, and so allowed. */
export function createFakeConceptSources(): FakeConceptSources {
  const pages = new Map<string, FakeConceptPage>();
  const purged = new Set<string>();
  return {
    addPage(page) {
      pages.set(page.pageId, { ...page });
    },
    trash(fileId) {
      for (const page of pages.values()) if (page.fileId === fileId) page.trashed = true;
    },
    purge(fileId) {
      purged.add(fileId);
      for (const [id, page] of pages) if (page.fileId === fileId) pages.delete(id);
    },
    resolve(userId, refs) {
      return refs.map((ref): ConceptSourceInfo => {
        const page = pages.get(ref.pageId);
        if (page && page.userId === userId && page.fileId === ref.fileId) {
          return {
            known: true,
            exists: true,
            trashed: page.trashed === true,
            fileName: page.fileName,
            pageIndex: page.pageIndex,
            quoteFound:
              page.transcript === null ? null : findQuote(page.transcript, ref.quote) >= 0,
          };
        }
        if (purged.has(ref.fileId)) return { ...UNKNOWN, known: true, exists: false };
        return { ...UNKNOWN };
      });
    },
  };
}

// ---- mentions in documents ---------------------------------------------------------------

/**
 * Where concepts are mentioned in rich text (`{ "concept": "con_…" }`), for
 * the concept page's backlinks. `conceptIds` is the concept and every ID that
 * was merged into it.
 */
export interface ConceptMentions {
  mentions(userId: string, conceptIds: readonly string[]): MentionedIn[];
}

export interface FakeConceptMentions extends ConceptMentions {
  add(
    userId: string,
    conceptId: string,
    mention: Partial<MentionedIn> & { documentId: string },
  ): void;
}

export function createFakeConceptMentions(): FakeConceptMentions {
  const rows: Array<{ userId: string; conceptId: string; mention: MentionedIn }> = [];
  return {
    add(userId, conceptId, mention) {
      rows.push({
        userId,
        conceptId,
        mention: {
          blockId: null,
          nodeId: null,
          title: "Untitled",
          preview: "",
          trashed: false,
          ...mention,
        },
      });
    },
    mentions(userId, conceptIds) {
      return rows
        .filter((row) => row.userId === userId && conceptIds.includes(row.conceptId))
        .map((row) => row.mention);
    },
  };
}

/**
 * Finds mentions by reading the documents lane's `blocks` table. Block data is
 * stored as compact JSON, so a mention is the text `"concept":"con_…"`.
 * Personal-scale: one LIKE per concept ID, no extra index to keep in step.
 */
export function createDbConceptMentions(db: Db): ConceptMentions {
  const find = db.prepare(
    `SELECT b.id AS block_id, b.document_id, b.data, d.title, d.node_id, d.trashed_at
     FROM blocks b JOIN documents d ON d.id = b.document_id
     WHERE b.user_id = ? AND b.data LIKE ? ESCAPE '\\' ORDER BY d.title, b.position LIMIT 200`,
  );
  return {
    mentions(userId, conceptIds) {
      const out: MentionedIn[] = [];
      const seen = new Set<string>();
      for (const id of conceptIds) {
        const rows = find.all(userId, `%"concept":"${id}"%`) as Array<{
          block_id: string;
          document_id: string;
          data: string;
          title: string;
          node_id: string;
          trashed_at: string | null;
        }>;
        for (const row of rows) {
          if (seen.has(row.block_id)) continue;
          seen.add(row.block_id);
          let preview = "";
          try {
            preview = blockPlainText(JSON.parse(row.data))
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 140);
          } catch {
            // an unreadable block still counts as a mention
          }
          out.push({
            documentId: row.document_id,
            blockId: row.block_id,
            nodeId: row.node_id,
            title: row.title,
            preview,
            trashed: row.trashed_at !== null,
          });
        }
      }
      return out;
    },
  };
}

// ---- practice questions linked to concepts ------------------------------------------------------

/** Questions that carry `conceptIds` (G-section). The practice lane plugs in a real one. */
export interface ConceptQuestions {
  questions(userId: string, conceptIds: readonly string[]): QuestionLink[];
}

export const noConceptQuestions: ConceptQuestions = { questions: () => [] };

export interface FakeConceptQuestions extends ConceptQuestions {
  add(
    userId: string,
    conceptId: string,
    question: Partial<QuestionLink> & { questionId: string },
  ): void;
}

export function createFakeConceptQuestions(): FakeConceptQuestions {
  const rows: Array<{ userId: string; conceptId: string; question: QuestionLink }> = [];
  return {
    add(userId, conceptId, question) {
      rows.push({ userId, conceptId, question: { stem: "A question", nodeId: null, ...question } });
    },
    questions(userId, conceptIds) {
      return rows
        .filter((row) => row.userId === userId && conceptIds.includes(row.conceptId))
        .map((row) => row.question);
    },
  };
}
