import { Heart, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import letter from "../../assets/letter-for-hannah.jpg";
import { Tooltip } from "../../components/ui/tooltip";
import { cn } from "../../lib/cn";
import "./letter.css";

/** Alex's handwritten note to Hannah, word for word, for anyone who cannot see the picture. */
const LETTER_WORDS =
  "A handwritten note: This application was made for my Hannah. I wish nothing but the best for you. You are my world. Love, Alex A.";

/**
 * A small heart. Opening it plays a letter being opened: the envelope
 * arrives, its flap lifts, the note slides out, and then the note itself fills the screen. Alex's
 * dedication to Hannah (2026-11-17). Reduced motion shows the note straight away.
 */
export function LoveLetter({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="A note for Hannah">
        <Dialog.Trigger asChild>
          <button
            type="button"
            aria-label="A note for Hannah"
            data-testid="love-letter"
            className={cn(
              "hit-area relative flex size-9 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors duration-(--duration-instant) hover:bg-surface-muted hover:text-text",
              className,
            )}
          >
            <Heart size={16} aria-hidden className="fill-hue-pink-solid text-hue-pink-solid" />
          </button>
        </Dialog.Trigger>
      </Tooltip>
      <Dialog.Portal>
        <Dialog.Overlay className="ll-overlay fixed inset-0 z-(--z-overlay)" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-(--z-modal) grid place-items-center p-4 outline-none"
          // A tap anywhere outside the note closes it.
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <Dialog.Title className="sr-only">A note for Hannah</Dialog.Title>

          {/* The envelope: it opens, then steps aside for the note. Decoration only. */}
          <div aria-hidden className="ll-scene pointer-events-none absolute">
            <div className="ll-envelope">
              <div className="ll-back" />
              <div className="ll-note">
                <img src={letter} alt="" />
              </div>
              <div className="ll-front" />
              <div className="ll-flap">
                <Heart size={22} className="ll-seal fill-hue-pink-solid text-hue-pink-solid" />
              </div>
            </div>
          </div>

          <figure className="ll-letter relative m-0">
            <img
              src={letter}
              alt={LETTER_WORDS}
              className="block max-h-[82dvh] w-auto max-w-[min(92vw,44rem)] rounded-card shadow-pop"
            />
            <Tooltip content="Close the note">
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close the note"
                  className="absolute -top-3 -right-3 flex size-11 items-center justify-center rounded-pill border border-border-strong bg-surface text-text shadow-raised hover:bg-surface-muted xl:size-9"
                >
                  <X size={18} aria-hidden />
                </button>
              </Dialog.Close>
            </Tooltip>
          </figure>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
