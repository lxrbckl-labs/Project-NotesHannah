import type { ExamsService } from "../exams/service.js";
import type { PracticeService } from "./service.js";

/**
 * The narrow view of practice the MCP layer calls: author and read questions,
 * read results, weak areas and the notebook, read exams. Every method takes the
 * caller's AuthContext first; nothing here lets an agent take a session.
 */
export type PracticePort = Pick<
  PracticeService,
  | "createQuestions"
  | "validateQuestions"
  | "getQuestion"
  | "listQuestions"
  | "listSessions"
  | "getSession"
  | "results"
  | "weakAreas"
  | "notebook"
  | "dueList"
> &
  Pick<ExamsService, "listExams" | "getExam" | "upcoming">;

export function createPracticePort(practice: PracticeService, exams: ExamsService): PracticePort {
  return {
    createQuestions: practice.createQuestions,
    validateQuestions: practice.validateQuestions,
    getQuestion: practice.getQuestion,
    listQuestions: practice.listQuestions,
    listSessions: practice.listSessions,
    getSession: practice.getSession,
    results: practice.results,
    weakAreas: practice.weakAreas,
    notebook: practice.notebook,
    dueList: practice.dueList,
    listExams: exams.listExams,
    getExam: exams.getExam,
    upcoming: exams.upcoming,
  };
}
