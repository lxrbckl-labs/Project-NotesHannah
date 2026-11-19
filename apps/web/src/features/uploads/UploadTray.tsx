import { CheckCircle2, ChevronDown, ChevronUp, CircleAlert, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { IconButton } from "../../components/ui/button";
import { ProgressBar } from "../../components/ui/progress";
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
        "fixed z-(--z-float) rounded-card border border-border bg-surface shadow-pop",
        layout === "phone"
          ? "inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))]"
          : "bottom-4 right-4 w-[22rem]",
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <h2 className="flex-1 font-sans text-ui font-semibold">{title}</h2>
        <IconButton
          size="sm"
          aria-label={open ? "Hide upload list" : "Show upload list"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </IconButton>
        {!working.length ? (
          <IconButton
            size="sm"
            aria-label="Clear the upload list"
            onClick={() => manager.clearFinished()}
          >
            <X size={18} />
          </IconButton>
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
                    <CheckCircle2 size={18} className="text-hue-green-text" aria-hidden />
                  ) : item.status === "error" ? (
                    <CircleAlert size={18} className="text-hue-red-text" aria-hidden />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-ui font-medium [overflow-wrap:anywhere]">
                    {item.name}
                  </p>
                  <p className="text-caption text-text-muted">
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
                    {item.status === "cancelled" ? " · canceled" : null}
                    {item.status === "queued" ? " · waiting" : null}
                  </p>
                  {item.status === "uploading" ? (
                    <ProgressBar
                      className="mt-1.5"
                      size="sm"
                      label={`Uploading ${item.name}`}
                      value={Math.round(item.progress * 100)}
                    />
                  ) : null}
                  {item.status === "error" && item.error ? (
                    <p role="alert" className="mt-1 text-caption text-danger">
                      {item.error.message} {item.error.hint}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center">
                  {item.status === "uploading" || item.status === "queued" ? (
                    <IconButton
                      size="sm"
                      aria-label={`Cancel ${item.name}`}
                      onClick={() => manager.cancel(item.id)}
                    >
                      <X size={16} />
                    </IconButton>
                  ) : null}
                  {item.status === "error" || item.status === "cancelled" ? (
                    <>
                      {item.error?.message.startsWith("Too large") ||
                      item.error?.message.startsWith("That is not") ? null : (
                        <IconButton
                          size="sm"
                          aria-label={`Retry ${item.name}`}
                          onClick={() => manager.retry(item.id)}
                        >
                          <RotateCw size={16} />
                        </IconButton>
                      )}
                      <IconButton
                        size="sm"
                        aria-label={`Remove ${item.name} from the list`}
                        onClick={() => manager.dismiss(item.id)}
                      >
                        <X size={16} />
                      </IconButton>
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
