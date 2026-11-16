import type { RequestLink, RequestTarget } from "@notes/schema";
import type { Db } from "../../db/client.js";

/**
 * The text a reply may rely on: what the request is about plus what the agent cited. Used to check
 * the figures (numbers with units) a reply states. Reads the library, documents, files, questions
 * and concepts tables directly and read-only, like the target lookup next to it, and only ever for
 * this user's own rows.
 */
export type SourceTexts = (
  userId: string,
  target: RequestTarget,
  links: readonly RequestLink[],
) => string[];

/** Most text collected for one reply: a huge lecture must not make completing slow. */
const MAX_CHARS = 2_000_000;

export function createDbSourceTexts(db: Db): SourceTexts {
  const block = db.prepare(
    "SELECT plain_text FROM blocks WHERE id = ? AND document_id = ? AND user_id = ?",
  );
  const docBlocks = db.prepare(
    "SELECT plain_text FROM blocks WHERE document_id = ? AND user_id = ? ORDER BY position",
  );
  const filePages = db.prepare(
    `SELECT p.native_text, p.speaker_notes, t.text AS transcript
     FROM pages p LEFT JOIN transcripts t ON t.id = p.transcript_id
     WHERE p.file_id = ? AND p.user_id = ?`,
  );
  const onePage = db.prepare(
    `SELECT p.native_text, p.speaker_notes, t.text AS transcript
     FROM pages p LEFT JOIN transcripts t ON t.id = p.transcript_id
     WHERE p.id = ? AND p.file_id = ? AND p.user_id = ?`,
  );
  const subtree = `WITH RECURSIVE down(id) AS (
       SELECT id FROM nodes WHERE id = ? AND user_id = ?
       UNION ALL SELECT n.id FROM nodes n JOIN down ON n.parent_id = down.id)`;
  const nodeDocs = db.prepare(
    `${subtree} SELECT b.plain_text FROM blocks b JOIN documents d ON d.id = b.document_id
     WHERE d.node_id IN (SELECT id FROM down) AND d.user_id = ?`,
  );
  const nodeFiles = db.prepare(
    `${subtree} SELECT p.native_text, p.speaker_notes, t.text AS transcript
     FROM pages p JOIN source_files f ON f.id = p.file_id
     LEFT JOIN transcripts t ON t.id = p.transcript_id
     WHERE f.node_id IN (SELECT id FROM down) AND f.user_id = ?`,
  );
  const question = db.prepare("SELECT text, data FROM questions WHERE id = ? AND user_id = ?");
  const concept = db.prepare(
    "SELECT name, aliases, drug, summary FROM concepts WHERE id = ? AND user_id = ?",
  );

  type PageText = {
    native_text: string | null;
    speaker_notes: string | null;
    transcript: string | null;
  };
  const pageTexts = (rows: PageText[]): string[] =>
    rows.flatMap((r) => [r.transcript, r.native_text, r.speaker_notes]).filter(isText);

  return (userId, target, links) => {
    const out: string[] = [];
    const add = (...texts: Array<string | null | undefined>) => {
      for (const t of texts) if (isText(t)) out.push(t);
    };
    const documentText = (documentId: string) =>
      add(
        ...(docBlocks.all(documentId, userId) as Array<{ plain_text: string }>).map(
          (r) => r.plain_text,
        ),
      );
    const nodeText = (nodeId: string) => {
      add(
        ...(nodeDocs.all(nodeId, userId, userId) as Array<{ plain_text: string }>).map(
          (r) => r.plain_text,
        ),
      );
      add(...pageTexts(nodeFiles.all(nodeId, userId, userId) as PageText[]));
    };
    const fileText = (fileId: string, pageId?: string) =>
      add(
        ...pageTexts(
          (pageId
            ? onePage.all(pageId, fileId, userId)
            : filePages.all(fileId, userId)) as PageText[],
        ),
      );
    const questionText = (id: string) => {
      const q = question.get(id, userId) as { text: string; data: string } | undefined;
      if (q) add(q.text, q.data);
    };

    switch (target.type) {
      case "node":
        nodeText(target.nodeId);
        break;
      case "document":
        documentText(target.documentId);
        break;
      case "block":
        add(
          (
            block.get(target.blockId, target.documentId, userId) as
              | { plain_text: string }
              | undefined
          )?.plain_text,
        );
        break;
      case "source":
        fileText(target.fileId, target.pageId);
        break;
      case "question":
        questionText(target.questionId);
        break;
      case "library":
        break;
    }
    for (const link of links) {
      switch (link.type) {
        case "node":
          nodeText(link.nodeId);
          break;
        case "document":
          documentText(link.documentId);
          break;
        case "block":
          add(
            (block.get(link.blockId, link.documentId, userId) as { plain_text: string } | undefined)
              ?.plain_text,
          );
          break;
        case "source":
          fileText(link.fileId, link.pageId);
          break;
        case "question":
          questionText(link.questionId);
          break;
        case "concept": {
          const c = concept.get(link.conceptId, userId) as
            | { name: string; aliases: string; drug: string | null; summary: string }
            | undefined;
          if (c) add(c.name, c.aliases, c.drug, c.summary);
          break;
        }
      }
    }
    // Bound the work, not the meaning: later texts are dropped once the budget is spent.
    let total = 0;
    return out.filter((t) => {
      total += t.length;
      return total <= MAX_CHARS;
    });
  };
}

const isText = (t: string | null | undefined): t is string => typeof t === "string" && t !== "";
