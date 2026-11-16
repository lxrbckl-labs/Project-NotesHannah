/** Shared definitions used by the web app, the API and the MCP layer. */
export const SCHEMA_VERSION = 1;

export * from "./accounts.js";
export * from "./blocks/index.js";
export * from "./canvas.js";
export * from "./citations.js";
export * from "./common.js";
export * from "./documents.js";
export * from "./ids.js";
export * from "./library.js";
/** Practice questions, grading, sessions and scheduling. Namespaced: its names are generic. */
export * as practice from "./practice/index.js";
export * from "./search.js";
export * from "./sources.js";
