import type {
  CreateRequestInput,
  EditRequestInput,
  RequestCounts,
  RequestLink,
  RequestStatus,
  RequestTarget,
  StudyRequest,
  StudyRequestWithContext,
} from "@notes/schema";
import type { MountContext } from "../mounts/modules";

export type {
  CreateRequestInput,
  EditRequestInput,
  RequestCounts,
  RequestLink,
  RequestStatus,
  RequestTarget,
  StudyRequest,
  StudyRequestWithContext,
};

export interface RequestListQuery {
  /** One or more statuses; left out: every status but cancelled (the server's default). */
  status?: RequestStatus[];
  targetType?: RequestTarget["type"];
  order?: "newest" | "oldest";
  cursor?: string;
  limit?: number;
}

export interface RequestPage {
  items: StudyRequestWithContext[];
  nextCursor: string | null;
}

/** What the screens need from the server. A plain object, so tests can fake it. */
export interface RequestsStore {
  list(query?: RequestListQuery): Promise<RequestPage>;
  counts(): Promise<RequestCounts>;
  get(id: string): Promise<StudyRequestWithContext>;
  create(input: CreateRequestInput): Promise<StudyRequest>;
  /** While the request is waiting: a new quick action and/or message. */
  update(id: string, input: EditRequestInput): Promise<StudyRequest>;
  cancel(id: string): Promise<StudyRequest>;
  /** Put a done or declined request back, optionally with a follow-up note. */
  reopen(id: string, note?: string): Promise<StudyRequest>;
}

/** The pieces of the mount context the requests screen uses. */
export type RequestsMountContext = Pick<MountContext, "openSource" | "openNode"> &
  Partial<Pick<MountContext, "params" | "search" | "SourceViewer">>;

/** Where the module sends her when a link has no mount-context function. Each falls back to a URL push. */
export interface RequestsNavigation {
  onOpenDocument?: (target: {
    documentId: string;
    nodeId: string | null;
    blockId?: string;
  }) => void;
  onOpenQuestion?: (target: { questionId: string; nodeId: string | null }) => void;
  onOpenConcept?: (conceptId: string) => void;
}

export type RequestsViewProps = { store: RequestsStore } & RequestsMountContext &
  RequestsNavigation;

/** What the composer needs to leave a request: the store's `create`, or any function with its shape. */
export type SubmitRequest = (input: CreateRequestInput) => Promise<StudyRequest>;
