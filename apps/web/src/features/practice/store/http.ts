/**
 * PracticeStore over HTTP. The routes below are assumptions the integrator aligns with the server.
 *
 *   GET    /api/practice/overview?currentNodeId=            -> PracticeOverview
 *   POST   /api/practice/sessions                           body StartRequest -> SessionState
 *   GET    /api/practice/sessions/unfinished                -> UnfinishedSession | null
 *   GET    /api/practice/sessions/:id                       -> SessionState
 *   POST   /api/practice/sessions/:id/answers               body { index, answer, timeTakenMs } -> QuestionOutcome
 *   POST   /api/practice/sessions/:id/reveal                body { index, partIndex? } -> Reveal
 *   POST   /api/practice/sessions/:id/skip                  body { index } -> SessionState
 *   POST   /api/practice/sessions/:id/finish                -> SessionResults
 *   POST   /api/practice/sessions/:id/abandon               -> 204
 *   GET    /api/practice/sessions/:id/results               -> SessionResults
 *   GET    /api/practice/notebook                           -> NotebookItem[]
 *   GET    /api/practice/weak-areas                         -> WeakAreasView
 *   GET    /api/practice/cards/due?days=14                  -> DueByDay
 *   GET    /api/exams                                       -> ExamSummary[]
 *   POST   /api/exams                                       body ExamInput -> ExamSummary
 *   PATCH  /api/exams/:id                                   body Partial<ExamInput> -> ExamSummary
 *   DELETE /api/exams/:id                                   -> 204
 *   GET    /api/exams/:id/progress                          -> ExamProgress
 *
 * Errors: a non-2xx response with `{ error: { message } }` (or plain text) becomes a PracticeApiError.
 */
import type { ExamInput, ExamProgress, ExamSummary } from "../../exams/types";
import {
  type Answer,
  type DueByDay,
  type NotebookItem,
  PracticeApiError,
  type PracticeOverview,
  type PracticeStore,
  type QuestionOutcome,
  type Reveal,
  type SessionResults,
  type SessionState,
  type StartRequest,
  type UnfinishedSession,
  type WeakAreasView,
} from "../types";

export interface HttpStoreOptions {
  /** Prefix for every route, default "" (same origin). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra headers, e.g. a CSRF token. Cookies are sent (`credentials: "include"`). */
  headers?: () => Record<string, string>;
}

export function createHttpStore(options: HttpStoreOptions = {}): PracticeStore {
  const base = options.baseUrl ?? "";
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.headers?.() ?? {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      let message = `${method} ${path} failed (${res.status})`;
      try {
        const text = await res.text();
        try {
          const json = JSON.parse(text) as {
            error?: { message?: string } | string;
            message?: string;
          };
          const inner = typeof json.error === "string" ? json.error : json.error?.message;
          message = inner ?? json.message ?? message;
        } catch {
          if (text) message = text.slice(0, 300);
        }
      } catch {
        // keep the generic message
      }
      throw new PracticeApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  const enc = encodeURIComponent;
  const s = (id: string) => `/api/practice/sessions/${enc(id)}`;

  return {
    getOverview: (opts) =>
      call<PracticeOverview>(
        "GET",
        `/api/practice/overview${opts?.currentNodeId ? `?currentNodeId=${enc(opts.currentNodeId)}` : ""}`,
      ),
    startSession: (req: StartRequest) => call<SessionState>("POST", "/api/practice/sessions", req),
    getUnfinishedSession: () =>
      call<UnfinishedSession | null>("GET", "/api/practice/sessions/unfinished"),
    getSession: (id) => call<SessionState>("GET", s(id)),
    submitAnswer: (id, index, answer: Answer, timeTakenMs) =>
      call<QuestionOutcome>("POST", `${s(id)}/answers`, { index, answer, timeTakenMs }),
    reveal: (id, index, partIndex) =>
      call<Reveal>("POST", `${s(id)}/reveal`, {
        index,
        ...(partIndex !== undefined ? { partIndex } : {}),
      }),
    skip: (id, index) => call<SessionState>("POST", `${s(id)}/skip`, { index }),
    finishSession: (id) => call<SessionResults>("POST", `${s(id)}/finish`),
    abandonSession: (id) => call<void>("POST", `${s(id)}/abandon`),
    getResults: (id) => call<SessionResults>("GET", `${s(id)}/results`),
    listNotebook: () => call<NotebookItem[]>("GET", "/api/practice/notebook"),
    getWeakAreas: () => call<WeakAreasView>("GET", "/api/practice/weak-areas"),
    getDueByDay: (days = 14) => call<DueByDay>("GET", `/api/practice/cards/due?days=${days}`),
    listExams: () => call<ExamSummary[]>("GET", "/api/exams"),
    createExam: (input: ExamInput) => call<ExamSummary>("POST", "/api/exams", input),
    updateExam: (id, patch) => call<ExamSummary>("PATCH", `/api/exams/${enc(id)}`, patch),
    deleteExam: (id) => call<void>("DELETE", `/api/exams/${enc(id)}`),
    examProgress: (id) => call<ExamProgress>("GET", `/api/exams/${enc(id)}/progress`),
  };
}
