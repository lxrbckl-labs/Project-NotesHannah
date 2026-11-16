import {
  type CreateNodeInput,
  canContain,
  MAX_FOLDER_DEPTH,
  type MoveNodeInput,
  NodeKind,
} from "@notes/schema";
import { AppError } from "../../http/errors.js";

/** A well-formed placeholder ID used inside examples. */
export const EXAMPLE_ID = "nod_01HZX3K9Q2V7M4N8P6R5T0W1YB";

const KINDS = NodeKind.options;

export function childKinds(parent: NodeKind | null): NodeKind[] {
  return KINDS.filter((kind) => canContain(parent, kind));
}

export function parentKinds(child: NodeKind): Array<NodeKind | null> {
  return [null, ...KINDS].filter((parent) => canContain(parent, child));
}

function describeParent(kind: NodeKind | null): string {
  return kind === null ? "the top level of the library" : `a ${kind}`;
}

function describeParents(child: NodeKind): string {
  const names = parentKinds(child).map((p) => (p === null ? "the top level (parentId null)" : p));
  return names.join(" or ");
}

/** An example for state conflicts: the request that fixes them. */
export function call(method: string, path: string): { method: string; path: string } {
  return { method, path };
}

export function notFound(): AppError {
  return new AppError("not_found", "No such item in your library.", {
    hint: "Check the id. List the top level with GET /api/nodes, or a folder with GET /api/nodes?parentId=<id>.",
  });
}

export function misplaced(
  op: "create" | "move",
  kind: NodeKind,
  parentKind: NodeKind | null,
): AppError {
  const parents = parentKinds(kind);
  const parentId = parents[0] === null ? null : EXAMPLE_ID;
  const example =
    op === "create" ? { parentId, kind, name: "Example" } : ({ parentId } satisfies MoveNodeInput);
  return new AppError(
    "invalid_input",
    `A ${kind} cannot ${op === "create" ? "be created" : "be moved"} in ${describeParent(parentKind)}.`,
    {
      hint: `A ${kind} goes inside ${describeParents(kind)}. ${
        parentKind === null
          ? "Pick a parent of the right kind."
          : `A ${parentKind} can hold: ${childKinds(parentKind).join(", ") || "nothing"}.`
      }`,
      example,
    },
  );
}

export function tooDeep(op: "create" | "move", kind: NodeKind, sectionId: string | null): AppError {
  const parentId = sectionId ?? EXAMPLE_ID;
  const example =
    op === "create" ? { parentId, kind, name: "Example" } : ({ parentId } satisfies MoveNodeInput);
  return new AppError(
    "invalid_input",
    `Folders can nest at most ${MAX_FOLDER_DEPTH} deep below a section.`,
    {
      hint: `Put the ${kind} in the section itself or in a shallower folder.`,
      example,
    },
  );
}

export function sectionRefused(action: string): AppError {
  return new AppError("invalid_input", `A section cannot be ${action}.`, {
    hint: "Every course has the same five fixed sections. Change what is inside a section instead.",
    example: { parentId: EXAMPLE_ID, kind: "folder", name: "Week 1" } satisfies CreateNodeInput,
  });
}

export function inTrash(action: string, id: string): AppError {
  return new AppError("conflict", `This item is in the trash, so it cannot be ${action}.`, {
    hint: `Restore it first with POST /api/nodes/${id}/restore.`,
    example: call("POST", `/api/nodes/${id}/restore`),
  });
}
