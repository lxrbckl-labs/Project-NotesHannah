import { createFileSourceLookup } from "./adapters/file-sources.js";
import { createConceptQuestions, createQuestionTargets } from "./adapters/practice-links.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import {
  type ActivityLog,
  type ChangeFeed,
  createActivityLog,
  createChangeFeed,
} from "./domains/activity/index.js";
import {
  type ConceptsPort,
  type ConceptsService,
  createConceptsService,
  type DrugNameChecker,
  nameCheckerFromConfig,
} from "./domains/concepts/index.js";
import {
  createDocumentsService,
  type DocumentsService,
  type SourceLookup,
} from "./domains/documents/index.js";
import { createExamsService, type ExamsService } from "./domains/exams/index.js";
import {
  createFilesService,
  type FilesListener,
  type FilesService,
  type FilesServiceOptions,
} from "./domains/files/index.js";
import {
  createLibraryService,
  type LibraryListener,
  type LibraryService,
} from "./domains/library/index.js";
import {
  createPracticePort,
  createPracticeService,
  type PracticePort,
  type PracticeService,
} from "./domains/practice/index.js";
import {
  createDbTargetLookup,
  createRequestsService,
  type RequestsPort,
  type RequestsService,
} from "./domains/requests/index.js";
import { createSearchService, type SearchService } from "./domains/search/index.js";

/** What the services need from the running server. */
export interface ServicesDeps {
  config: Pick<Config, "DATA_DIR" | "APP_ORIGIN"> & Partial<Pick<Config, "RXNORM_CHECK">>;
  db: Db;
  /** Milliseconds since the epoch. */
  now: () => number;
}

export interface ServicesOptions {
  /** Passed to the files service (a ready storage, the log, queue timings, ...). */
  files?: FilesServiceOptions;
  /** Newest revisions kept per document. */
  revisionCap?: number;
  /** The drug-name check. Default: RxNav when `config.RXNORM_CHECK`, otherwise none. */
  nameChecker?: DrugNameChecker | undefined;
}

/**
 * The one instance of each domain service, wired together. The web routes, the
 * queue watcher and the MCP layer all take this object, so a change made through
 * any of them goes through the same code and leaves the same traces.
 */
export interface Services {
  library: LibraryService;
  files: FilesService;
  documents: DocumentsService;
  practice: PracticeService;
  exams: ExamsService;
  requests: RequestsService;
  concepts: ConceptsService;
  /** "What changed since" (H9). Every domain's changes land here. */
  changes: ChangeFeed;
  /** What agents did, in plain words (H10). */
  activity: ActivityLog;
  /** Names, transcript pages, document blocks, practice questions and concepts in one list. */
  search: SearchService;
  /** Answers citations from the files tables. */
  sources: SourceLookup;
  /** The narrow views the MCP layer calls. */
  practicePort: PracticePort;
  conceptsPort: ConceptsPort;
  requestsPort: RequestsPort;
}

const CONCEPTS_PORT_KEYS = [
  "bulkUpsert",
  "getConcept",
  "page",
  "search",
  "list",
  "neighbourhood",
  "path",
  "filter",
  "compare",
  "brandGenericPairs",
  "merge",
  "onSourceDeleted",
  "citingPage",
] as const satisfies ReadonlyArray<keyof ConceptsPort>;

/** Only the methods of the port, so a caller holding it cannot reach the rest of the service. */
function conceptsPortOf(concepts: ConceptsService): ConceptsPort {
  const port: Partial<Record<(typeof CONCEPTS_PORT_KEYS)[number], unknown>> = {};
  for (const key of CONCEPTS_PORT_KEYS) port[key] = concepts[key];
  return port as ConceptsPort;
}

/**
 * Build the services and connect them:
 *
 * - the library tells documents, files, practice, exams and requests when a subtree is trashed,
 *   restored, deleted for good or duplicated, inside the library's own transaction (documents
 *   and questions follow the node; source files under it return to the inbox; exams of a
 *   trashed course are hidden; requests on it are hidden);
 * - files going to the trash, coming back or being deleted drive the requests and concepts hooks;
 *   questions and documents deleted for good drive the requests hooks;
 * - every domain appends to the same change feed and activity log;
 * - documents, practice and concepts check citations against the files tables, and a `requestId`
 *   only lifts the protection of her blocks when the requests domain says it covers them;
 * - concept pages find their mentions (documents) and questions (practice) in the real tables.
 */
export function createServices(deps: ServicesDeps, options: ServicesOptions = {}): Services {
  const { db, now } = deps;
  const changes = createChangeFeed(db, now);
  const activity = createActivityLog(db, now);
  const trace = { changes, activity: activity.port };

  // Library and files are told about everything built on top of them; their listeners
  // only run when a request arrives, long after these are all assigned.
  const later: {
    documents?: DocumentsService;
    files?: FilesService;
    practice?: PracticeService;
    exams?: ExamsService;
    requests?: RequestsService;
    concepts?: ConceptsService;
  } = {};
  const need = <K extends keyof typeof later>(key: K): NonNullable<(typeof later)[K]> =>
    later[key] as NonNullable<(typeof later)[K]>;

  const listener: LibraryListener = {
    trashed: ({ userId, nodeIds, actor }) => {
      need("documents").onNodeTrashed(userId, nodeIds, actor);
      need("files").onNodesTrashed(userId, nodeIds, actor);
      need("practice").onNodeTrashed(userId, nodeIds);
      need("exams").onNodeTrashed(userId, nodeIds);
      need("requests").onNodeTrashed(userId, nodeIds);
    },
    restored: ({ userId, nodeIds, actor }) => {
      need("documents").onNodeRestored(userId, nodeIds, actor);
      need("files").onNodesRestored(userId, nodeIds, actor);
      need("practice").onNodeRestored(userId, nodeIds);
      need("exams").onNodeRestored(userId, nodeIds);
      need("requests").onNodeRestored(userId, nodeIds);
    },
    deleted: ({ userId, nodeIds, actor }) => {
      need("documents").onNodeDeleted(userId, nodeIds, actor);
      need("files").onNodesDeleted(userId, nodeIds, actor);
      need("practice").onNodeDeleted(userId, nodeIds);
      need("exams").onNodeDeleted(userId, nodeIds);
      need("requests").onNodeDeleted(userId, nodeIds);
    },
    duplicated: ({ userId, pairs, actor }) => {
      const nodeMap = Object.fromEntries(pairs.map((p) => [p.fromId, p.toId]));
      for (const { fromId, toId } of pairs) {
        need("documents").onNodeDuplicated(userId, fromId, toId, actor);
        need("exams").onNodeDuplicated(userId, fromId, toId, nodeMap);
      }
      need("practice").onNodesDuplicated(
        userId,
        pairs.map((p) => [p.fromId, p.toId] as const),
      );
    },
  };

  const filesListener: FilesListener = {
    trashed: ({ userId, fileIds }) => need("requests").onFilesTrashed(userId, fileIds),
    restored: ({ userId, fileIds }) => need("requests").onFilesRestored(userId, fileIds),
    deleted: ({ userId, actor, fileIds }) => {
      need("requests").onFilesDeleted(userId, fileIds);
      // Citations are never rewritten; the quote is what remains. Say which concepts it touches.
      const hit = need("concepts").onSourceDeleted(userId, fileIds);
      const touched = [...hit.concepts, ...hit.relations];
      if (touched.length > 0) {
        changes.record(userId, {
          action: "concept.source_deleted",
          objectType: "concept",
          objectIds: touched,
          actor,
          summary: `A source file was deleted for good; ${hit.concepts.length} concepts and ${hit.relations.length} relations cited it and keep only the quoted passage`,
        });
      }
    },
  };

  const library = createLibraryService(db, {
    now: () => new Date(now()),
    listener,
    ...trace,
  });
  const files = createFilesService(deps, {
    ...options.files,
    listener: filesListener,
    library,
    ...trace,
  });
  const sources = createFileSourceLookup(db);

  const requests = createRequestsService(
    { db, now },
    {
      lookup: createDbTargetLookup(db, { question: createQuestionTargets(db) }),
      activity: activity.port,
      changes,
    },
  );
  const documents = createDocumentsService(
    { db, now },
    {
      sources,
      library,
      changes,
      activity: activity.port,
      requests: requests.port,
      onDocumentsDeleted: (userId, ids) => requests.onDocumentsDeleted(userId, ids),
      ...(options.revisionCap === undefined ? {} : { revisionCap: options.revisionCap }),
    },
  );
  const practice = createPracticeService(
    { db, now },
    {
      sources,
      ...trace,
      onQuestionsDeleted: (userId, ids) => requests.onQuestionsDeleted(userId, ids),
    },
  );
  const exams = createExamsService({ db, now }, { practice, ...trace });
  const nameChecker =
    "nameChecker" in options ? options.nameChecker : nameCheckerFromConfig(db, deps.config, now);
  const concepts = createConceptsService(
    { db, now },
    {
      sources,
      questions: createConceptQuestions(db),
      ...(nameChecker ? { nameChecker } : {}),
      ...trace,
    },
  );

  later.files = files;
  later.documents = documents;
  later.practice = practice;
  later.exams = exams;
  later.requests = requests;
  later.concepts = concepts;

  const search = createSearchService({ library, files, documents, practice, concepts });

  return {
    library,
    files,
    documents,
    practice,
    exams,
    requests,
    concepts,
    changes,
    activity,
    search,
    sources,
    practicePort: createPracticePort(practice, exams),
    conceptsPort: conceptsPortOf(concepts),
    requestsPort: requests.port,
  };
}
