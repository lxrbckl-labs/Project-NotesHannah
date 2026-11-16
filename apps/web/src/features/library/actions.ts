import type { CreateNodeInput, MoveNodeInput, NodeWithLinks, UpdateNodeInput } from "@notes/schema";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { nodeKeys } from "./queries";

type Cached = NodeWithLinks | NodeWithLinks[] | undefined;
type Patch = (key: readonly unknown[], data: Cached) => Cached;

const asList = (data: Cached) => (Array.isArray(data) ? data : undefined);

function mapNode(data: Cached, id: string, fn: (n: NodeWithLinks) => NodeWithLinks): Cached {
  if (!data) return data;
  if (Array.isArray(data)) return data.map((n) => (n.id === id ? fn(n) : n));
  return data.id === id ? fn(data) : data;
}

function bumpChildCount(data: Cached, id: string | null, by: number): Cached {
  if (!id) return data;
  return mapNode(data, id, (n) => ({ ...n, childCount: Math.max(0, n.childCount + by) }));
}

/** Apply `patch` to every cached library query; return a function that puts it all back. */
function applyOptimistic(client: QueryClient, patch: Patch) {
  const snapshot = client.getQueriesData<Cached>({ queryKey: nodeKeys.all });
  for (const [key, data] of snapshot) {
    const next = patch(key, data);
    if (next !== data) client.setQueryData(key, next);
  }
  return () => {
    for (const [key, data] of snapshot) client.setQueryData(key, data);
  };
}

function countMove(data: Cached, from: string | null, to: string | null): Cached {
  return bumpChildCount(bumpChildCount(data, from, -1), to, 1);
}

const parentKey = (key: readonly unknown[]) => (key[1] === "children" ? (key[2] as string) : null);
const ROOT = "root";
const isChildrenOf = (key: readonly unknown[], parentId: string | null) =>
  key[1] === "children" && key[2] === (parentId ?? ROOT);

let pendingCounter = 0;

interface Spec<V, R> {
  mutationFn: (vars: V) => Promise<R>;
  optimistic: (vars: V) => Patch;
  onSuccess?: (result: R, vars: V) => void;
}

function make<V, R = unknown>(
  mutationFn: (vars: V) => Promise<R>,
  optimistic: (vars: V) => Patch,
  onSuccess?: (result: R, vars: V) => void,
): Spec<V, R> {
  return { mutationFn, optimistic, onSuccess };
}

/** All library mutations. Each updates the cache at once, rolls back on error, then refetches. */
export function useNodeActions() {
  const client = useQueryClient();
  const toast = useToast();

  const run = useCallback(
    async <V, R>(spec: Spec<V, R>, vars: V): Promise<R | undefined> => {
      await client.cancelQueries({ queryKey: nodeKeys.all });
      const rollback = applyOptimistic(client, spec.optimistic(vars));
      try {
        const result = await spec.mutationFn(vars);
        spec.onSuccess?.(result, vars);
        return result;
      } catch (error) {
        rollback();
        toast.error(error);
        return undefined;
      } finally {
        await client.invalidateQueries({ queryKey: nodeKeys.all });
      }
    },
    [client, toast],
  );

  const create = useCallback(
    (input: CreateNodeInput) =>
      run(
        make(
          (v: CreateNodeInput) => api.createNode(v),
          (v) => (key, data) => {
            if (!isChildrenOf(key, v.parentId)) return bumpChildCount(data, v.parentId, 1);
            const now = new Date().toISOString();
            const placeholder: NodeWithLinks = {
              id: `pending_${++pendingCounter}`,
              userId: "",
              parentId: v.parentId,
              kind: v.kind,
              name: v.name,
              section: null,
              course: v.kind === "course" ? (v.course ?? { code: null }) : null,
              lecture: v.kind === "lecture" ? (v.lecture ?? { number: null, date: null }) : null,
              sortKey: "~",
              favourite: false,
              createdAt: now,
              updatedAt: now,
              trashedAt: null,
              path: v.name,
              childCount: 0,
              ancestors: [],
            };
            return [...(asList(data) ?? []), placeholder];
          },
        ),
        input,
      ),
    [run],
  );

  const rename = useCallback(
    (node: NodeWithLinks, name: string) =>
      run(
        make(
          (v: { id: string; input: UpdateNodeInput }) => api.updateNode(v.id, v.input),
          () => (_key, data) => mapNode(data, node.id, (n) => ({ ...n, name })),
        ),
        { id: node.id, input: { name } },
      ),
    [run],
  );

  /** Change name, course code or lecture number and date in one go. */
  const update = useCallback(
    (node: NodeWithLinks, input: UpdateNodeInput) =>
      run(
        make(
          (v: { id: string; input: UpdateNodeInput }) => api.updateNode(v.id, v.input),
          () => (_key, data) =>
            mapNode(data, node.id, (n) => ({
              ...n,
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.course !== undefined ? { course: input.course } : {}),
              ...(input.lecture !== undefined ? { lecture: input.lecture } : {}),
            })),
        ),
        { id: node.id, input },
      ),
    [run],
  );

  const setFavourite = useCallback(
    (node: NodeWithLinks, favourite: boolean) =>
      run(
        make(
          (v: { id: string; input: UpdateNodeInput }) => api.updateNode(v.id, v.input),
          () => (key, data) => {
            const updated = mapNode(data, node.id, (n) => ({ ...n, favourite }));
            if (key[1] !== "favourites") return updated;
            const list = asList(updated) ?? [];
            if (!favourite) return list.filter((n) => n.id !== node.id);
            return list.some((n) => n.id === node.id) ? list : [...list, { ...node, favourite }];
          },
        ),
        { id: node.id, input: { favourite } },
      ),
    [run],
  );

  const duplicate = useCallback(
    (node: NodeWithLinks) =>
      run(
        make(
          (id: string) => api.duplicateNode(id),
          () => (key, data) => {
            if (!isChildrenOf(key, node.parentId)) {
              return bumpChildCount(data, node.parentId, 1);
            }
            const list = asList(data) ?? [];
            const at = list.findIndex((n) => n.id === node.id);
            const copy = {
              ...node,
              id: `pending_${++pendingCounter}`,
              name: `${node.name} copy`,
              favourite: false,
            };
            return [...list.slice(0, at + 1), copy, ...list.slice(at + 1)];
          },
        ),
        node.id,
      ),
    [run],
  );

  const move = useCallback(
    (node: NodeWithLinks, input: MoveNodeInput) =>
      run(
        make(
          (v: { id: string; input: MoveNodeInput }) => api.moveNode(v.id, v.input),
          () => (key, data) => {
            const list = asList(data);
            const sameParent = node.parentId === input.parentId;
            if (key[1] === "children") {
              const parent = parentKey(key);
              const here = parent === (input.parentId ?? ROOT);
              const from = parent === (node.parentId ?? ROOT);
              if (!list) return data;
              let next: NodeWithLinks[] = list;
              if (from) next = next.filter((n) => n.id !== node.id);
              if (here) {
                let index = next.length;
                if (input.afterId === null) index = 0;
                else if (input.afterId) index = next.findIndex((n) => n.id === input.afterId) + 1;
                next = [
                  ...next.slice(0, index),
                  { ...node, parentId: input.parentId },
                  ...next.slice(index),
                ];
              }
              return sameParent ? next : countMove(next, node.parentId, input.parentId);
            }
            return sameParent ? data : countMove(data, node.parentId, input.parentId);
          },
        ),
        { id: node.id, input },
      ),
    [run],
  );

  const trash = useCallback(
    (node: NodeWithLinks, afterTrash?: () => void) =>
      run(
        make(
          (id: string) => api.trashNode(id),
          () => (key, data) => {
            if (key[1] === "children" || key[1] === "favourites" || key[1] === "recents") {
              const list = asList(data);
              return list
                ? bumpChildCount(
                    list.filter((n) => n.id !== node.id),
                    node.parentId,
                    -1,
                  )
                : data;
            }
            if (key[1] === "trash") {
              const list = asList(data) ?? [];
              return [{ ...node, trashedAt: new Date().toISOString() }, ...list];
            }
            return bumpChildCount(data, node.parentId, -1);
          },
          () => afterTrash?.(),
        ),
        node.id,
      ),
    [run],
  );

  const restore = useCallback(
    (node: NodeWithLinks) =>
      run(
        make(
          (id: string) => api.restoreNode(id),
          () => (key, data) => {
            const list = asList(data);
            return key[1] === "trash" && list ? list.filter((n) => n.id !== node.id) : data;
          },
        ),
        node.id,
      ),
    [run],
  );

  const deleteForever = useCallback(
    (node: NodeWithLinks) =>
      run(
        make(
          (id: string) => api.deleteForever(id),
          () => (key, data) => {
            const list = asList(data);
            return key[1] === "trash" && list ? list.filter((n) => n.id !== node.id) : data;
          },
        ),
        node.id,
      ),
    [run],
  );

  return { create, update, rename, setFavourite, duplicate, move, trash, restore, deleteForever };
}

export type NodeActions = ReturnType<typeof useNodeActions>;
