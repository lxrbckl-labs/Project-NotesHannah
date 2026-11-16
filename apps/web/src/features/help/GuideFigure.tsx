import { Maximize2, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { IconButton } from "../../components/ui/button";
import { overlayClass } from "../../components/ui/dialog";
import { cn } from "../../lib/cn";
import { ZoomableImage } from "../documents/ui/ZoomableImage";
import { FIGURES, type FigureId } from "./content";
import { figureNumber } from "./outline";

/** The figure's label and caption, shared by the page and the booklet. */
export function FigureCaption({ id }: { id: FigureId }) {
  return (
    <figcaption className="gb-figcaption mt-2.5 text-label text-text-muted">
      <span className="gb-figlabel mr-1.5 font-semibold text-accent">
        Figure {figureNumber(id)}
      </span>
      {FIGURES[id].caption}
    </figcaption>
  );
}

/**
 * A screenshot of the app in a quiet frame, with its numbered caption. Tapping it opens it larger,
 * where it can be zoomed and panned (the document viewer's ZoomableImage).
 */
export function GuideFigure({ id }: { id: FigureId }) {
  const figure = FIGURES[id];
  const [open, setOpen] = useState(false);
  const label = `Figure ${figureNumber(id)}`;
  return (
    <figure
      className={cn(
        "gb-figure my-2",
        figure.shape === "phone" && "max-w-[15rem]",
        figure.shape === "square" && "max-w-md",
        (figure.shape === "short" || figure.shape === "compact") && "max-w-xl",
      )}
      data-figure={id}
      data-shape={figure.shape ?? "wide"}
    >
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            aria-label={`Enlarge ${label}`}
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-card border border-border bg-surface shadow-card transition-shadow duration-(--duration-fast) hover:shadow-raised"
          >
            <img
              src={figure.src}
              width={figure.width}
              height={figure.height}
              alt={figure.alt}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
            <span
              aria-hidden
              className="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-control border border-border bg-(--color-chrome) text-text-muted opacity-90 shadow-card backdrop-blur group-hover:text-text"
            >
              <Maximize2 size={15} />
            </span>
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={overlayClass} />
          <Dialog.Content
            aria-describedby={undefined}
            className="pb-safe fixed inset-2 z-(--z-modal) flex flex-col rounded-panel border border-border bg-surface text-text shadow-pop outline-none anim-pop md:inset-6 xl:inset-10"
          >
            <div className="flex items-start gap-3 px-4 pt-3 pb-2 md:px-5">
              <Dialog.Title className="min-w-0 flex-1 text-ui">
                <span className="font-semibold text-accent">{label}</span>{" "}
                <span className="text-text-muted">{figure.caption}</span>
              </Dialog.Title>
              <Dialog.Close asChild>
                <IconButton aria-label="Close">
                  <X size={18} />
                </IconButton>
              </Dialog.Close>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-3 pb-3 md:px-5 md:pb-5">
              <div
                className="w-full"
                style={{
                  maxWidth: `min(100%, calc((100dvh - 9rem) * ${figure.width / figure.height}))`,
                }}
              >
                <ZoomableImage
                  src={figure.src}
                  width={figure.width}
                  height={figure.height}
                  alt={figure.alt}
                  testId="guide-figure-zoom"
                />
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <FigureCaption id={id} />
    </figure>
  );
}

/** The same figure for print: no button, no viewer. */
export function PrintFigure({ id }: { id: FigureId }) {
  const figure = FIGURES[id];
  return (
    <figure className="gb-figure" data-figure={id} data-shape={figure.shape ?? "wide"}>
      <FigureCaption id={id} />
      <div className="gb-frame">
        <img src={figure.src} width={figure.width} height={figure.height} alt={figure.alt} />
      </div>
    </figure>
  );
}
