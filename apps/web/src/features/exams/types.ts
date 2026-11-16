/** Exam planner shapes (M1 to M4). The server holds exams; the app shows them. */

export interface ExamInput {
  /** The course the exam belongs to, e.g. "Cardiovascular Pharmacology". Exams are grouped by it. */
  course: string;
  title: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** The lectures and folders the exam covers. A folder covers everything inside it. */
  nodeIds: string[];
}

export interface Exam extends ExamInput {
  id: string;
  createdAt: string;
}

/** One covered lecture or folder, resolved for display. */
export interface CoverageNode {
  id: string;
  title: string;
  /** "Cardiovascular Pharmacology / Lecture 7", for the picker and tooltips. */
  path: string;
  /** Questions available under it. */
  questionCount: number;
}

/** How much of an exam's material she has reviewed. Never a grade: a plain account of what is done. */
export interface ExamProgress {
  questionCount: number;
  /** Different questions she has attempted at least once. */
  attempted: number;
  /** Share of attempts answered correctly, null until she has attempted something. */
  accuracy: number | null;
  /** Missed questions of this exam still in the notebook. */
  inNotebook: number;
  /** Flashcards of this exam due today. */
  dueCards: number;
}

export interface ExamSummary extends Exam {
  /** Whole days from today to the exam (0 = today, negative = it has passed). */
  daysRemaining: number;
  coverage: CoverageNode[];
  progress: ExamProgress;
}

/** What the shell's node picker returns. */
export interface PickedNode {
  id: string;
  title: string;
  path: string;
}

/**
 * Provided by the shell: opens its lecture/folder picker (preselecting `selected`) and
 * resolves with the chosen nodes, or null when she cancels.
 */
export type PickNodes = (options: {
  selected: readonly string[];
  title?: string;
  /** "coverage" (default): lectures and folders. "places": courses, folders, lectures, documents. */
  pick?: "coverage" | "places";
  /** Let her confirm with nothing chosen (to clear a choice). */
  allowNone?: boolean;
}) => Promise<PickedNode[] | null>;

export interface ExamsApi {
  listExams(): Promise<ExamSummary[]>;
  createExam(input: ExamInput): Promise<ExamSummary>;
  updateExam(id: string, patch: Partial<ExamInput>): Promise<ExamSummary>;
  deleteExam(id: string): Promise<void>;
  examProgress(id: string): Promise<ExamProgress>;
}
