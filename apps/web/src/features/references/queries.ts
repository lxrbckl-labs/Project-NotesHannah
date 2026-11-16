import {
  type CreateReferenceInput,
  pageOf,
  SavedReference,
  type UpdateReferenceInput,
} from "@notes/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { appHttp } from "../../lib/api";

const ListBody = pageOf(SavedReference);
const OneBody = z.object({ reference: SavedReference });
const UsedBody = z.object({
  items: z.array(
    z.object({
      documentId: z.string(),
      documentTitle: z.string(),
      nodeId: z.string(),
      blockId: z.string(),
    }),
  ),
});

/** Every reference query key starts with "references", so one invalidation refreshes them all. */
export const referenceKeys = {
  all: ["references"] as const,
  list: ["references", "all"] as const,
  at: (nodeId: string) => ["references", "at", nodeId] as const,
};

/** A person keeps at most 500, so the page loads them all at once and filters in place. */
export const referencesApi = {
  all: async () =>
    ListBody.parse(await appHttp.get("/references", { limit: 500 })).items as SavedReference[],
  /** Those tied to a place or to anything inside it. */
  at: async (nodeId: string) =>
    ListBody.parse(await appHttp.get("/references", { nodeId, limit: 100 }))
      .items as SavedReference[],
  create: async (input: CreateReferenceInput) =>
    OneBody.parse(await appHttp.post("/references", input)).reference as SavedReference,
  update: async (id: string, input: UpdateReferenceInput) =>
    OneBody.parse(await appHttp.patch(`/references/${id}`, input)).reference as SavedReference,
  remove: (id: string) => appHttp.del(`/references/${id}`),
  usedIn: async (id: string) =>
    UsedBody.parse(await appHttp.get(`/references/${id}/used-in`)).items,
};

export const useReferences = () =>
  useQuery({ queryKey: referenceKeys.list, queryFn: referencesApi.all });

/** The blocks of her notes that draw on a reference; asked for only when she opens the list. */
export const useReferenceUse = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["references", "used", id],
    queryFn: () => referencesApi.usedIn(id),
    enabled,
  });

export const useReferencesAt = (nodeId: string) =>
  useQuery({ queryKey: referenceKeys.at(nodeId), queryFn: () => referencesApi.at(nodeId) });

export function useReferenceMutations() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: referenceKeys.all });
    // Saved references are searchable, so a cached search may now be stale.
    void client.invalidateQueries({ queryKey: ["search"] });
  };
  return {
    create: useMutation({ mutationFn: referencesApi.create, onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: UpdateReferenceInput }) =>
        referencesApi.update(id, input),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: referencesApi.remove, onSuccess: refresh }),
  };
}
