import type { NodeWithLinks } from "@notes/schema";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

/** Every library query key starts with "nodes", so one invalidation refreshes them all. */
export const nodeKeys = {
  all: ["nodes"] as const,
  children: (parentId: string | null) => ["nodes", "children", parentId ?? "root"] as const,
  node: (id: string) => ["nodes", "node", id] as const,
  trash: ["nodes", "trash"] as const,
  recents: ["nodes", "recents"] as const,
  favourites: ["nodes", "favourites"] as const,
};

export const childrenQuery = (parentId: string | null) =>
  queryOptions({ queryKey: nodeKeys.children(parentId), queryFn: () => api.children(parentId) });
export const nodeQuery = (id: string) =>
  queryOptions({ queryKey: nodeKeys.node(id), queryFn: () => api.node(id) });

export const useChildren = (parentId: string | null, enabled = true) =>
  useQuery({ ...childrenQuery(parentId), enabled });
export const useNode = (id: string | undefined) =>
  useQuery({ ...nodeQuery(id ?? ""), enabled: !!id });
export const useTrash = () => useQuery({ queryKey: nodeKeys.trash, queryFn: api.trash });
export const useRecents = () => useQuery({ queryKey: nodeKeys.recents, queryFn: api.recents });
export const useFavourites = () =>
  useQuery({ queryKey: nodeKeys.favourites, queryFn: api.favourites });
export const useSearch = (q: string) =>
  useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
    staleTime: 10_000,
  });

/**
 * Folder levels at and including `node` (0 for anything that is not a folder), using the
 * kinds of ancestors already loaded into any cached listing.
 */
export function folderDepthOf(client: QueryClient, node: NodeWithLinks): number {
  if (node.kind !== "folder") return 0;
  const known = new Map<string, string>();
  for (const [, data] of client.getQueriesData<NodeWithLinks[]>({
    queryKey: ["nodes", "children"],
  })) {
    for (const n of data ?? []) known.set(n.id, n.kind);
  }
  return 1 + node.ancestors.filter((id) => known.get(id) === "folder").length;
}

/** Source files are not nodes, so they live outside the "nodes" namespace. */
export const fileKeys = {
  of: (nodeId: string) => ["files", "of", nodeId] as const,
  inbox: ["files", "inbox"] as const,
  trashed: ["files", "trashed"] as const,
  one: (id: string) => ["files", "one", id] as const,
};
