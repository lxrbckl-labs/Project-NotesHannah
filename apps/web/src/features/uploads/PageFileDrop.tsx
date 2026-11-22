import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUploadManager } from "./UploadProvider";
import { isFileDrag } from "./useFileDrop";

/**
 * A page that takes files: drag files from the desktop (or the Files app on an iPad) anywhere over
 * the window and drop them, and they upload to `target`. While files are held over the window the
 * whole page shows where they will go. Put one on each page that has an Upload button, with the same
 * target as that button.
 *
 * A smaller drop area on the same page (useFileDrop) still works: if it took the drop, this one
 * leaves it alone, so nothing uploads twice.
 */
export function PageFileDrop({ target }: { target: { nodeId: string | null; label: string } }) {
  const manager = useUploadManager();
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every element crossed; the count says when the window is left.
  const depth = useRef(0);
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const hold = (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      // Without this the browser opens the file instead of handing it to the page.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      depth.current = 0;
      setOver(false);
      if (!isFileDrag(event)) return;
      // A drop area inside the page already took these files.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) manager.enqueue(files, latest.current);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", hold);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", hold);
      window.removeEventListener("drop", drop);
    };
  }, [manager]);

  if (!over) return null;
  return createPortal(
    <div
      aria-hidden
      data-testid="page-file-drop"
      className="anim-fade pointer-events-none fixed inset-0 z-(--z-float) grid place-items-center bg-(--color-overlay) p-6 backdrop-blur-sm"
    >
      <div className="flex max-w-md flex-col items-center gap-3 rounded-panel border-2 border-dashed border-accent bg-surface px-8 py-10 text-center shadow-pop">
        <span className="flex size-14 items-center justify-center rounded-card bg-accent-soft text-accent">
          <Upload size={28} />
        </span>
        <p className="font-display text-title font-semibold">Drop to upload</p>
        <p className="text-ui text-text-muted">
          The files go to <strong className="font-semibold text-text">{target.label}</strong>.
        </p>
      </div>
    </div>,
    document.body,
  );
}
