import { BACKGROUND_MAX_BYTES, type BackgroundMime } from "@notes/schema";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AppEnv, getAuth, requireSession } from "../../http/auth-context.js";
import type { ServerDeps } from "../../http/deps.js";
import { AppError } from "../../http/errors.js";

/** What the bytes really are, by their first bytes: the Content-Type header is not trusted. */
function sniff(bytes: Uint8Array): BackgroundMime | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  const text = (from: number) =>
    String.fromCharCode(at(from), at(from + 1), at(from + 2), at(from + 3));
  if (text(0) === "RIFF" && text(8) === "WEBP") return "image/webp";
  return null;
}

const limit = bodyLimit({
  maxSize: BACKGROUND_MAX_BYTES,
  onError: () => {
    throw new AppError("too_large", "That picture is too large to keep as a background.", {
      hint: `Send at most ${Math.round(BACKGROUND_MAX_BYTES / 1024 / 1024)} MB. The app shrinks a picture before sending it.`,
    });
  },
});

/**
 * Her background picture. Mount at "/api". A browser session only.
 * - GET /me/background/meta: { updatedAt } with a number when she has one, null when she has not.
 * - GET /me/background: the picture itself, or 404.
 * - PUT /me/background: the body is the picture (JPEG, PNG or WebP).
 * - DELETE /me/background: back to the dotted grid.
 */
export function backgroundRoutes(deps: Pick<ServerDeps, "db" | "now">): Hono<AppEnv> {
  const { db } = deps;
  const app = new Hono<AppEnv>();
  app.use("/me/background", requireSession);
  app.use("/me/background/*", requireSession);

  const meta = (userId: string) => {
    const row = db
      .prepare("SELECT updated_at FROM user_backgrounds WHERE user_id = ?")
      .get(userId) as { updated_at: number } | undefined;
    return { updatedAt: row ? row.updated_at : null };
  };

  app.get("/me/background/meta", (c) => c.json(meta(getAuth(c).userId)));

  app.get("/me/background", (c) => {
    const row = db
      .prepare("SELECT mime, bytes, updated_at FROM user_backgrounds WHERE user_id = ?")
      .get(getAuth(c).userId) as
      | { mime: string; bytes: Uint8Array; updated_at: number }
      | undefined;
    if (!row) {
      throw new AppError("not_found", "No background picture is set.", {
        hint: "Set one in Settings, under Background.",
      });
    }
    // The address carries the time it was saved (?v=...), so a saved picture never changes under it.
    return new Response(new Uint8Array(row.bytes), {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.put("/me/background", limit, async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const mime = sniff(bytes);
    if (!mime) {
      throw new AppError("invalid_input", "The background must be a JPEG, PNG or WebP picture.", {
        hint: "Send the picture's bytes as the request body.",
      });
    }
    db.prepare(
      `INSERT INTO user_backgrounds (user_id, mime, bytes, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes,
         updated_at = excluded.updated_at`,
    ).run(getAuth(c).userId, mime, bytes, deps.now());
    return c.json(meta(getAuth(c).userId));
  });

  app.delete("/me/background", (c) => {
    db.prepare("DELETE FROM user_backgrounds WHERE user_id = ?").run(getAuth(c).userId);
    return c.json(meta(getAuth(c).userId));
  });

  return app;
}
