import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { backgroundUrl, useBackground, useSaveBackground } from "../preferences/useBackground";

/**
 * Her own picture behind the pages, in place of the dotted grid. Any picture of any size: the app
 * shrinks it before saving. It follows her account to every device.
 */
export function BackgroundCard() {
  const background = useBackground();
  const save = useSaveBackground();
  const input = useRef<HTMLInputElement>(null);
  const updatedAt = background.data?.updatedAt ?? null;
  return (
    <Card as="section" aria-labelledby="card-background" padding="lg" data-testid="background-card">
      <CardTitle
        id="card-background"
        title="Background"
        description="Put your own picture behind the pages instead of the dots. Any picture, any size."
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div
          aria-hidden
          data-testid="background-preview"
          className={
            updatedAt === null
              ? "dot-grid h-20 w-32 shrink-0 rounded-control border border-border-strong bg-bg"
              : "h-20 w-32 shrink-0 rounded-control border border-border-strong bg-cover bg-center"
          }
          style={
            updatedAt === null
              ? undefined
              : { backgroundImage: `url("${backgroundUrl(updatedAt)}")` }
          }
        />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Choose a background picture"
            data-testid="background-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clear the field, so picking the same file again still counts as a change.
              event.target.value = "";
              if (file) save.mutate(file);
            }}
          />
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={16} aria-hidden />
            {save.isPending ? "Saving" : updatedAt === null ? "Choose a picture" : "Change picture"}
          </Button>
          {updatedAt !== null ? (
            <Button disabled={save.isPending} onClick={() => save.mutate(null)}>
              <Trash2 size={16} aria-hidden />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-caption text-text-muted">
        {updatedAt === null
          ? "Using the dotted background."
          : "A soft veil in the page color sits over the picture, so titles stay readable."}
      </p>
    </Card>
  );
}
