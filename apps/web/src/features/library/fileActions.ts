import type { SourceFile } from "@notes/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useToast } from "../../components/ui/toast";
import { api } from "../../lib/api";
import { nodeKeys } from "./queries";

/** Everything a person can do to a source file. Each refreshes the file lists (and the library). */
export function useFileActions() {
  const client = useQueryClient();
  const toast = useToast();

  const run = useCallback(
    async <T>(work: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await work();
        if (success) toast.show(success);
        return result;
      } catch (error) {
        toast.error(error);
        return undefined;
      } finally {
        void client.invalidateQueries({ queryKey: ["files"] });
        void client.invalidateQueries({ queryKey: nodeKeys.all });
      }
    },
    [client, toast],
  );

  return useMemo(
    () => ({
      moveTo: (file: SourceFile, nodeId: string | null, placeName?: string) =>
        run(
          () => api.fileTo(file.id, nodeId),
          nodeId === null
            ? `Moved "${file.originalName}" back to the inbox`
            : `Filed "${file.originalName}"${placeName ? ` under ${placeName}` : ""}`,
        ),
      rename: (file: SourceFile, name: string) => run(() => api.renameFile(file.id, name)),
      retry: (file: SourceFile) =>
        run(() => api.retryFile(file.id), `Trying "${file.originalName}" again`),
      trash: async (file: SourceFile) => {
        const done = await run(() => api.trashFile(file.id));
        if (done) {
          toast.show(`Moved "${file.originalName}" to the trash`, {
            label: "Undo",
            run: () => void run(() => api.restoreFile(file.id)),
          });
        }
        return done;
      },
      restore: (file: SourceFile) =>
        run(() => api.restoreFile(file.id), `Restored "${file.originalName}"`),
      deleteForever: (file: SourceFile) => run(() => api.deleteFileForever(file.id)),
    }),
    [run, toast],
  );
}
