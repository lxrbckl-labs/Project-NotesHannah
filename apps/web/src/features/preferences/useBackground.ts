import { BACKGROUND_MAX_EDGE, BackgroundMeta } from "@notes/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../components/ui/toast";
import { appHttp } from "../../lib/api";

export const backgroundKey = ["background"] as const;

/** Where the saved picture is served from. The time it was saved keeps an old copy out of the way. */
export const backgroundUrl = (updatedAt: number) => `/api/me/background?v=${updatedAt}`;

/** Whether she has a background picture, and when it was saved. */
export function useBackground() {
  return useQuery({
    queryKey: backgroundKey,
    queryFn: async () => BackgroundMeta.parse(await appHttp.get("/me/background/meta")),
    staleTime: 5 * 60_000,
  });
}

/**
 * Any picture, any size: it is drawn at most BACKGROUND_MAX_EDGE pixels on its longer side and saved
 * as a JPEG here in the browser, so what travels is small however large the original was.
 */
export async function shrinkPicture(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file could not be read as a picture. Try a JPEG or PNG.");
  try {
    const scale = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not prepare the picture.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.86));
    if (!blob) throw new Error("This browser could not prepare the picture.");
    return blob;
  } finally {
    bitmap.close();
  }
}

async function send(method: "PUT" | "DELETE", body?: Blob): Promise<BackgroundMeta> {
  const res = await fetch("/api/me/background", {
    method,
    credentials: "same-origin",
    ...(body ? { body, headers: { "Content-Type": "application/octet-stream" } } : {}),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? "The background could not be saved. Try again.");
  }
  return BackgroundMeta.parse(json);
}

/** Save a picture as the background (shrunk first), or remove it with `null`. */
export function useSaveBackground() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (file: Blob | null) =>
      file ? send("PUT", await shrinkPicture(file)) : send("DELETE"),
    onSuccess: (meta, file) => {
      client.setQueryData(backgroundKey, meta);
      toast.success(file ? "Background set." : "Background removed.");
    },
    onError: (error) => toast.error(error),
  });
}
