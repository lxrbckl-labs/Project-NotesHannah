/**
 * Practice: quizzes, flashcards, results, the missed-questions notebook, weak areas and (with
 * features/exams) the exam planner. Self-contained: the shell mounts `PracticeApp` and injects a store.
 */
export { UpcomingExamsCard } from "../exams";
export { PracticeApp, type PracticeAppProps, type PracticeView } from "./PracticeApp";
export { createHttpStore, type HttpStoreOptions } from "./store/http";
export { createMockStore, type MockOptions, type MockPracticeStore } from "./store/mock";
export * from "./types";
