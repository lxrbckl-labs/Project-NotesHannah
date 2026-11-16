import { BLOCK_LIMITS, type BlockOf, type ImageSource } from "@notes/schema";
import { ImageOff, MousePointerClick } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useActions } from "../context";
import { RichField } from "../editor/RichField";
import type { PageImage } from "../store/types";
import { cx, Popover, Sheet } from "../ui/primitives";
import { ZoomableImage } from "../ui/ZoomableImage";
import { PlainInput, RemoveButton, useBlockEdit } from "./common";
import { RichTextView } from "./RichText";

const cache = new Map<string, Promise<PageImage>>();

/** The image of a page, resolved through the store (cached per page). */
export function usePageImage(source: ImageSource) {
  const actions = useActions();
  const key = `${source.fileId}|${source.pageId ?? ""}`;
  const [state, setState] = useState<{ key: string; image: PageImage | null; failed: boolean }>({
    key: "",
    image: null,
    failed: false,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the page, not the source object
  useEffect(() => {
    let alive = true;
    let promise = cache.get(key);
    if (!promise) {
      promise = actions.store.resolveImage(source);
      cache.set(key, promise);
      promise.catch(() => cache.delete(key));
    }
    promise.then(
      (image) => alive && setState({ key, image, failed: false }),
      () => alive && setState({ key, image: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [key]);
  return state.key === key ? state : { key, image: null, failed: false };
}

/** A page image cropped to a region: the image is scaled so the region fills the frame. */
export function CroppedImage({
  image,
  region,
  alt,
  className,
  children,
  onClick,
}: {
  image: PageImage;
  region?: ImageSource["region"];
  alt: string;
  className?: string;
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const r = region ?? { x: 0, y: 0, width: 1, height: 1 };
  const ratio = (r.width * image.width) / (r.height * image.height);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: placing a hotspot by tapping; the list below offers the same by keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className={cx(
        "relative w-full overflow-hidden rounded-2xl border border-border bg-[var(--doc-gray-bg)]",
        className,
      )}
      style={{ aspectRatio: String(ratio) }}
      onClick={onClick}
    >
      <img
        src={image.url}
        alt={alt}
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / r.width}%`,
          left: `${(-r.x / r.width) * 100}%`,
          top: `${(-r.y / r.height) * 100}%`,
        }}
      />
      {children}
    </div>
  );
}

function ImagePlaceholder({ failed, alt }: { failed: boolean; alt: string }) {
  return (
    <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface-muted text-[13.5px] text-text-muted">
      {failed ? (
        <>
          <ImageOff aria-hidden className="size-5" />
          <span>This page is unavailable</span>
          <span className="sr-only">{alt}</span>
        </>
      ) : (
        <span className="animate-pulse">Loading page…</span>
      )}
    </div>
  );
}

export function ImageBlock({ block }: { block: BlockOf<"image"> }) {
  const { editing, active, patch, layout } = useBlockEdit(block);
  const { image, failed } = usePageImage(block.content.source);
  const [zoom, setZoom] = useState(false);
  return (
    <figure className="m-0">
      {image ? (
        <button
          type="button"
          className="block w-full cursor-zoom-in rounded-2xl"
          aria-label={`Open image: ${block.content.alt}`}
          onClick={() => setZoom(true)}
        >
          <CroppedImage
            image={image}
            region={block.content.source.region}
            alt={block.content.alt}
          />
        </button>
      ) : (
        <ImagePlaceholder failed={failed} alt={block.content.alt} />
      )}
      {editing && active && (
        <div className="mt-2 text-[13.5px]">
          <PlainInput
            value={block.content.alt}
            required
            label="Alt text"
            placeholder="Describe the image"
            onCommit={(alt) => patch({ alt }, "Edit alt text")}
          />
        </div>
      )}
      {(block.content.caption?.length || (editing && active)) && (
        <figcaption className="mt-2 text-center text-[13.5px] text-text-muted">
          <RichField
            blockId={block.id}
            field="caption"
            value={block.content.caption ?? []}
            onCommit={(caption) =>
              patch({ caption: caption.length ? caption : undefined }, "Edit caption")
            }
            block={block}
            label="Caption"
            placeholder="Caption (optional)"
          />
        </figcaption>
      )}
      {image && (
        <Sheet
          open={zoom}
          onOpenChange={setZoom}
          title={block.content.alt}
          side={layout === "phone" ? "bottom" : "center"}
          wide
        >
          <div className="p-4 pt-1">
            <ZoomableImage
              src={image.url}
              width={image.width}
              height={image.height}
              alt={block.content.alt}
              region={block.content.source.region}
            />
          </div>
        </Sheet>
      )}
    </figure>
  );
}

/** Labelled image (D7): numbered hotspots she can tap, with a legend underneath. */
export function LabelledImageBlock({ block }: { block: BlockOf<"labelled_image"> }) {
  const { editing, active, patch, actions } = useBlockEdit(block);
  const { image, failed } = usePageImage(block.content.image);
  const [placing, setPlacing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const hotspots = block.content.hotspots;
  const tools = editing && active;
  useEffect(() => {
    if (!tools) setPlacing(false);
  }, [tools]);

  const setSpot = (i: number, value: Partial<(typeof hotspots)[number]>) =>
    patch({ hotspots: hotspots.map((h, j) => (j === i ? { ...h, ...value } : h)) }, "Edit label");

  const place = (event: MouseEvent<HTMLDivElement>) => {
    if (!placing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    const x = round((event.clientX - rect.left) / rect.width);
    const y = round((event.clientY - rect.top) / rect.height);
    // Convert from the cropped frame to page fractions.
    const r = block.content.image.region ?? { x: 0, y: 0, width: 1, height: 1 };
    patch(
      {
        hotspots: [
          ...hotspots,
          {
            x: round(r.x + x * r.width),
            y: round(r.y + y * r.height),
            label: `Label ${hotspots.length + 1}`,
          },
        ],
      },
      "Add label",
    );
    setPlacing(false);
  };

  const region = block.content.image.region ?? { x: 0, y: 0, width: 1, height: 1 };
  return (
    <figure className="m-0" ref={frame}>
      {image ? (
        <CroppedImage
          image={image}
          region={block.content.image.region}
          alt={block.content.alt}
          className={cx(placing && "cursor-crosshair ring-2 ring-[var(--doc-focus)]")}
          onClick={place}
        >
          {hotspots.map((spot, i) => {
            const left = ((spot.x - region.x) / region.width) * 100;
            const top = ((spot.y - region.y) / region.height) * 100;
            return (
              <Popover
                // biome-ignore lint/suspicious/noArrayIndexKey: hotspots are positional
                key={i}
                open={open === i}
                onOpenChange={(o) => setOpen(o ? i : null)}
                label={spot.label}
                trigger={
                  <button
                    type="button"
                    data-testid="hotspot"
                    aria-label={`${i + 1}: ${spot.label}`}
                    className="absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--doc-blue-solid)] text-[13px] font-bold text-white shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-transform hover:scale-110 after:absolute after:-inset-1.5 after:content-[''] aria-expanded:bg-[var(--doc-orange-solid)]"
                    style={{ left: `${left}%`, top: `${top}%` }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {i + 1}
                  </button>
                }
              >
                <p className="font-semibold">{spot.label}</p>
                {spot.detail && (
                  <RichTextView
                    value={spot.detail}
                    block={block}
                    as="p"
                    className="mt-1 text-text-muted"
                  />
                )}
                {spot.concept && (
                  <button
                    type="button"
                    className="doc-concept mt-2 text-[13px]"
                    onClick={() => actions.openConcept(spot.concept as string)}
                  >
                    Open concept
                  </button>
                )}
              </Popover>
            );
          })}
        </CroppedImage>
      ) : (
        <ImagePlaceholder failed={failed} alt={block.content.alt} />
      )}
      {tools && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {hotspots.length < BLOCK_LIMITS.hotspots && (
            <button
              type="button"
              aria-pressed={placing}
              onClick={() => setPlacing((p) => !p)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[13px] font-medium aria-pressed:border-[var(--doc-focus)] aria-pressed:bg-[var(--doc-blue-bg)] aria-pressed:text-[var(--doc-blue-fg)] pointer-coarse:min-h-11"
            >
              <MousePointerClick aria-hidden className="size-3.5" />
              {placing ? "Tap the image to place it" : "Add a label"}
            </button>
          )}
        </div>
      )}
      <figcaption className="mt-3">
        <ol className="m-0 grid list-none gap-1.5 p-0 text-[14.5px] sm:grid-cols-2">
          {hotspots.map((spot, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: hotspots are positional
            <li key={i} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--doc-blue-bg)] text-[12px] font-bold text-[var(--doc-blue-fg)]"
              >
                {i + 1}
              </span>
              {tools ? (
                <div className="flex min-w-0 flex-1 items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <PlainInput
                      value={spot.label}
                      required
                      label={`Label ${i + 1}`}
                      onCommit={(label) => setSpot(i, { label })}
                      className="font-medium"
                    />
                    <PlainInput
                      value={(spot.detail ?? []).map((d) => ("text" in d ? d.text : "")).join("")}
                      label={`Detail ${i + 1}`}
                      placeholder="Detail (optional)"
                      className="text-[13px] text-text-muted"
                      onCommit={(detail) =>
                        setSpot(i, { detail: detail ? [{ text: detail }] : undefined })
                      }
                    />
                  </div>
                  {hotspots.length > 1 && (
                    <RemoveButton
                      label={`Remove ${spot.label}`}
                      onClick={() =>
                        patch({ hotspots: hotspots.filter((_, j) => j !== i) }, "Remove label")
                      }
                    />
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="min-h-6 text-left hover:underline"
                  onClick={() => setOpen(i)}
                >
                  {spot.label}
                </button>
              )}
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
