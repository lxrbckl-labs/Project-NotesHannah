import { OPERATION_EXAMPLES, type Problem, type WriterOperation } from "@notes/schema";
import { AppError } from "../../http/errors.js";

/**
 * Turn validation problems into one `invalid_input` error that carries the
 * first problem's path, message and example, and lists the rest in the hint.
 */
export function problemsToError(problems: readonly Problem[], prefix = ""): AppError {
  const shown = problems.map((p) => ({
    ...p,
    path: prefix ? `${prefix}${p.path.slice(1)}` : p.path,
  }));
  const [first] = shown;
  if (!first) return new AppError("invalid_input", "The request is not valid.");
  const message =
    shown.length === 1
      ? `${first.path}: ${first.message}`
      : `${shown.length} problems. First, at ${first.path}: ${first.message}`;
  const hint = shown.map((p) => `${p.path}: ${p.message}`).join("\n");
  return new AppError("invalid_input", message, {
    hint: shown.length === 1 ? "Fix the value at that path and send again." : hint,
    example: first.example,
  });
}

export const EXAMPLE_REQUEST_ID = "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8";

export function notFoundDocument(): AppError {
  return new AppError("not_found", "No such document.", {
    hint: "Check the document ID. Find a document through its library node: GET /api/nodes/:nodeId/document.",
  });
}

export function notFoundBlock(documentId: string, ids: readonly string[]): AppError {
  return new AppError(
    "not_found",
    `${ids.length === 1 ? "Block" : "Blocks"} ${ids.join(", ")} ${ids.length === 1 ? "is" : "are"} not in this document.`,
    {
      hint: `Read the document to see its blocks: GET /api/documents/${documentId}.`,
    },
  );
}

export function conflictRevision(documentId: string, expected: number, actual: number): AppError {
  return new AppError(
    "conflict",
    `The document is at revision ${actual}, but this change was based on revision ${expected}.`,
    {
      hint: `Someone changed it in between. Read it again (GET /api/documents/${documentId}), check that your change still makes sense, and resend with expectedRevision ${actual}.`,
      example: { expectedRevision: actual },
    },
  );
}

export function forbiddenWrite(operation: WriterOperation | "review", message: string): AppError {
  const example =
    operation === "review"
      ? undefined
      : {
          ...(OPERATION_EXAMPLES[operation] as object),
          requestId: "req_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
        };
  return new AppError("forbidden", message, {
    hint: "If she asked for this change in a request, pass that request's ID as requestId. Otherwise leave her block alone and add your version next to it.",
    ...(example ? { example } : {}),
  });
}
