import { z } from "zod";

/**
 * Every object has a permanent, prefixed ID: `<prefix>_<26-char ULID>`.
 * IDs never change when an object is renamed or moved, so citations and
 * links stay valid. The prefix makes an ID self-describing for agents.
 */
export const ID_PREFIX = {
  user: "usr",
  session: "ses",
  apiKey: "key",
  node: "nod",
  file: "fil",
  page: "pag",
  transcript: "trn",
  job: "job",
  upload: "upl",
  document: "doc",
  block: "blk",
  revision: "rev",
  question: "qst",
  practiceSession: "prs",
  attempt: "att",
  concept: "con",
  relation: "rel",
  request: "req",
  exam: "exm",
  card: "crd",
  edge: "edg",
  frame: "frm",
  reference: "ref",
} as const;

export type IdKind = keyof typeof ID_PREFIX;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Web Crypto, present in browsers and in Node; typed here so the package needs no DOM or Node typings. */
const webCrypto = (
  globalThis as unknown as { crypto: { getRandomValues(array: Uint8Array): Uint8Array } }
).crypto;

function encodeTime(ms: number): string {
  let out = "";
  let t = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += CROCKFORD[(bytes[i] as number) % 32];
  }
  return out;
}

/** Create a new ID of the given kind. Sortable by creation time. */
export function newId<K extends IdKind>(kind: K, now: number = Date.now()): string {
  return `${ID_PREFIX[kind]}_${encodeTime(now)}${encodeRandom()}`;
}

/** Which kind an ID is, or null if it is not a well-formed ID. */
export function idKind(id: string): IdKind | null {
  const sep = id.indexOf("_");
  if (sep < 0) return null;
  const prefix = id.slice(0, sep);
  const body = id.slice(sep + 1);
  if (!ULID_BODY.test(body)) return null;
  for (const kind of Object.keys(ID_PREFIX) as IdKind[]) {
    if (ID_PREFIX[kind] === prefix) return kind;
  }
  return null;
}

/** Zod schema for an ID of one kind. */
export function idSchema<K extends IdKind>(kind: K) {
  const prefix = ID_PREFIX[kind];
  return z.string().refine((value) => idKind(value) === kind, {
    message: `Expected a ${kind} ID like "${prefix}_01HZX3K9Q2V7M4N8P6R5T0W1YB"`,
  });
}

export const UserId = idSchema("user");
export const SessionId = idSchema("session");
export const ApiKeyId = idSchema("apiKey");
export const NodeId = idSchema("node");
export const FileId = idSchema("file");
export const PageId = idSchema("page");
export const TranscriptId = idSchema("transcript");
export const JobId = idSchema("job");
export const UploadId = idSchema("upload");
export const DocumentId = idSchema("document");
export const BlockId = idSchema("block");
export const RevisionId = idSchema("revision");
export const QuestionId = idSchema("question");
export const PracticeSessionId = idSchema("practiceSession");
export const AttemptId = idSchema("attempt");
export const ConceptId = idSchema("concept");
export const RelationId = idSchema("relation");
export const RequestId = idSchema("request");
export const ExamId = idSchema("exam");
export const CardId = idSchema("card");
export const EdgeId = idSchema("edge");
export const FrameId = idSchema("frame");
export const ReferenceId = idSchema("reference");
