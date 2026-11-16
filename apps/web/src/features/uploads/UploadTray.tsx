import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { formatBytes } from "../../lib/messages";
import { useLayout } from "../../lib/useMedia";
import { useUploads } from "./UploadProvider";

/** Progress for every upload, wherever she is in the app. Above the tab bar on a phone, bottom-right elsewhere. */
export function UploadTray() {
  const { manager, items } = useUploads();
  const layout = useLayout();
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  const working = items.filter((i) => i.status === "uploading" || i.status === "queued");
  const failed = items.filter((i) => i.status === "error").length;
  const title = working.length
    ? `Uploading ${working.length} ${working.length === 1 ? "file" : "files"}`
    : failed
      ? `${failed} ${failed === 1 ? "upload" : "uploads"} need attention`
      : "Uploads finished";

  return (
    <section
      aria-label="Uploads"
      data-testid="upload-tray"
      className={cn(
        "fixed z-[55] rounded-2xl border border-border bg-surface shadow-pop",
        layout === "phone"
          ? "inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))]"
          : "bottom-4 right-4 w-[22rem]",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <h2 className="flex-1 font-sans text-sm font-semibold">{title}</h2>
        <button
          type="button"
          aria-label={open ? "Hide upload list" : "Show upload list"}
          onClick={() => setOpen((v) => !v)}
          className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
        >
          {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
        {!working.length ? (
          <button
            type="button"
            aria-label="Clear the upload list"
            onClick={() => manager.clearFinished()}
            className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="max-h-[40dvh] overflow-y-auto border-t border-border">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="upload-item"
              data-status={item.status}
              className="border-b border-border px-4 py-2.5 last:border-0"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {item.status === "done" ? (
                    <CheckCircle2 size={18} className="text-accent" aria-hidden />
                  ) : item.status === "error" ? (
                    <CircleAlert size={18} className="text-danger" aria-hidden />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                    {item.name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(item.size)} · to {item.target}
                    {item.status === "done" ? (
                      <>
                        {" · "}
                        <Link
                          className="text-accent underline-offset-2 hover:underline"
                          to={item.result ? `/files/${item.result.id}` : "/inbox"}
                        >
                          Open
                        </Link>
                      </>
                    ) : null}
                    {item.status === "cancelled" ? " · cancelled" : null}
                    {item.status === "queued" ? " · waiting" : null}
                  </p>
                  {item.status === "uploading" ? (
                    <div
                      role="progressbar"
                      aria-label={`Uploading ${item.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(item.progress * 100)}
                      className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"
                    >
                      <div
                        className="h-full rounded-full bg-accent transition-[width]"
                        style={{ width: `${Math.round(item.progress * 100)}%` }}
                      />
                    </div>
                  ) : null}
                  {item.status === "error" && item.error ? (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {item.error.message} {item.error.hint}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center">
                  {item.status === "uploading" || item.status === "queued" ? (
                    <button
                      type="button"
                      aria-label={`Cancel ${item.name}`}
                      onClick={() => manager.cancel(item.id)}
                      className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
                    >
                      <X size={16} />
                    </button>
                  ) : null}
                  {item.status === "error" || item.status === "cancelled" ? (
                    <>
                      {item.error?.message.startsWith("Too large") ||
                      item.error?.message.startsWith("That is not") ? null : (
                        <button
                          type="button"
                          aria-label={`Retry ${item.name}`}
                          onClick={() => manager.retry(item.id)}
                          className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
                        >
                          <RotateCw size={16} />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${item.name} from the list`}
                        onClick={() => manager.dismiss(item.id)}
                        className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted"
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
