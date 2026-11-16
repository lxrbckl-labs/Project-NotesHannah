import { type DragEvent, useState } from "react";
import { useUploadManager } from "./UploadProvider";

export function isFileDrag(event: DragEvent | globalThis.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Drop files anywhere on an area to upload them there (computer layout). */
export function useFileDrop(target: { nodeId: string | null; label: string }, enabled = true) {
  const manager = useUploadManager();
  const [over, setOver] = useState(false);
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setOver(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) manager.enqueue(files, target);
      },
    },
  };
}
