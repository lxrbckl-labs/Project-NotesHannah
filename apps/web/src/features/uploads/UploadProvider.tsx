import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ACCEPT } from "./accept";
import { UploadManager } from "./manager";

export interface UploadTarget {
  nodeId: string | null;
  label: string;
}

const Context = createContext<{
  manager: UploadManager;
  pick: (target: UploadTarget) => void;
} | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [manager] = useState(() => new UploadManager(client));
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<UploadTarget>({ nodeId: null, label: "the inbox" });
  const pick = useCallback((next: UploadTarget) => {
    target.current = next;
    input.current?.click();
  }, []);

  // Leaving the page would cut an upload in half: ask first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (manager.active) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [manager]);

  return (
    <Context value={{ manager, pick }}>
      {children}
      {/* One picker for the whole app: every "Upload" button sets the target, then opens it. */}
      <input
        ref={input}
        data-testid="upload-input"
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) manager.enqueue(files, target.current);
        }}
      />
    </Context>
  );
}

export function useUploads() {
  const value = use(Context);
  if (!value) throw new Error("useUploads needs UploadProvider");
  const items = useSyncExternalStore(value.manager.subscribe, value.manager.getSnapshot);
  return { manager: value.manager, items };
}

export function useUploadManager(): UploadManager {
  const value = use(Context);
  if (!value) throw new Error("useUploadManager needs UploadProvider");
  return value.manager;
}

/** Open the file picker for a target (a lecture, a folder, a Sources section, or the inbox). */
export function useUploadPicker() {
  const value = use(Context);
  if (!value) throw new Error("useUploadPicker needs UploadProvider");
  return value.pick;
}
