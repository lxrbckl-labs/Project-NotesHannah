/**
 * Practice: question types, grading, sessions, the missed-questions notebook,
 * spaced repetition and weak areas. Everything here is pure (no I/O, no clock,
 * no randomness except from explicit seeds).
 */
export * from "./answers.js";
export * from "./calculation.js";
export { citationIssues, coreIssues, LIGHT_MARKDOWN_RULE, markdownProblem } from "./checks.js";
export * from "./content.js";
export * from "./expression.js";
export * from "./grade-result.js";
export * from "./grading.js";
export * from "./notebook.js";
export * from "./numbers.js";
export * from "./registry.js";
export * from "./rng.js";
export * from "./scheduler.js";
export * from "./session.js";
export * from "./source-ref.js";
export { matchBlank, normaliseLoose, normaliseStrict } from "./text-match.js";
export * from "./units.js";
export * from "./validate.js";
export * from "./variants.js";
export * from "./weak-areas.js";
