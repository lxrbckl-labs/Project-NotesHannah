import { createFileSourceLookup } from "./adapters/file-sources.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import {
  type ActivityLog,
  type ChangeFeed,
  createActivityLog,
  createChangeFeed,
} from "./domains/activity/index.js";
import {
  createDocumentsService,
  type DocumentsService,
  type SourceLookup,
} from "./domains/documents/index.js";
import {
  createFilesService,
  type FilesService,
  type FilesServiceOptions,
} from "./domains/files/index.js";
import {
  createLibraryService,
  type LibraryListener,
  type LibraryService,
} from "./domains/library/index.js";
import { createSearchService, type SearchService } from "./domains/search/index.js";

/** What the services need from the running server. */
export interface ServicesDeps {
  config: Pick<Config, "DATA_DIR" | "APP_ORIGIN">;
  db: Db;
  /** Milliseconds since the epoch. */
  now: () => number;
}

export interface ServicesOptions {
  /** Passed to the files service (a ready storage, the log, queue timings, ...). */
  files?: FilesServiceOptions;
  /** Newest revisions kept per document. */
  revisionCap?: number;
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
  /** "What changed since" (H9). Library, file, transcript and document changes all land here. */
  changes: ChangeFeed;
  /** What agents did, in plain words (H10). */
  activity: ActivityLog;
  /** Names, transcript pages and document blocks in one list. */
  search: SearchService;
  /** Answers citations from the files tables. */
  sources: SourceLookup;
}

/**
 * Build the services and connect them:
 *
 * - the library tells the documents and files domains when a subtree is trashed,
 *   restored, deleted for good or duplicated (documents follow the node; source
 *   files under it return to the inbox), inside the library's own transaction;
 * - every domain appends to the same change feed and activity log;
 * - the documents domain checks citations against the files tables.
 */
export function createServices(deps: ServicesDeps, options: ServicesOptions = {}): Services {
  const { db, now } = deps;
  const changes = createChangeFeed(db, now);
  const activity = createActivityLog(db, now);

  // The library has to be told about documents and files, which are built on top of it.
  // The listener only runs when a request arrives, long after these are assigned.
  const later: { documents?: DocumentsService; files?: FilesService } = {};
  const documentsOf = (): DocumentsService => later.documents as DocumentsService;
  const filesOf = (): FilesService => later.files as FilesService;
  const listener: LibraryListener = {
    trashed: ({ userId, nodeIds, actor }) => {
      documentsOf().onNodeTrashed(userId, nodeIds, actor);
      filesOf().onNodesTrashed(userId, nodeIds, actor);
    },
    restored: ({ userId, nodeIds, actor }) => {
      documentsOf().onNodeRestored(userId, nodeIds, actor);
      filesOf().onNodesRestored(userId, nodeIds, actor);
    },
    deleted: ({ userId, nodeIds, actor }) => {
      documentsOf().onNodeDeleted(userId, nodeIds, actor);
      filesOf().onNodesDeleted(userId, nodeIds, actor);
    },
    duplicated: ({ userId, pairs, actor }) => {
      for (const { fromId, toId } of pairs) {
        documentsOf().onNodeDuplicated(userId, fromId, toId, actor);
      }
    },
  };

  const library = createLibraryService(db, {
    now: () => new Date(now()),
    listener,
    changes,
    activity: activity.port,
  });
  const files = createFilesService(deps, {
    ...options.files,
    library,
    changes,
    activity: activity.port,
  });
  const sources = createFileSourceLookup(db);
  const documents = createDocumentsService(
    { db, now },
    {
      sources,
      library,
      changes,
      activity: activity.port,
      ...(options.revisionCap === undefined ? {} : { revisionCap: options.revisionCap }),
    },
  );
  later.files = files;
  later.documents = documents;
  const search = createSearchService({ library, files, documents });

  return { library, files, documents, changes, activity, search, sources };
}
