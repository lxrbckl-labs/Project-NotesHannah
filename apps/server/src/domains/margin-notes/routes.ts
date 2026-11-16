import { DocumentId, MarginNoteId } from "@notes/schema";
import { Hono, type MiddlewareHandler } from "hono";
import {
  type AppEnv,
  getAuth,
  requireAuth,
  requireSession,
  requireWrite,
} from "../../http/auth-context.js";
import { AppError } from "../../http/errors.js";
import type { MarginNotesService } from "./service.js";

async function readBody(c: { req: { json(): Promise<unknown> } }) {
  try {
    return await c.req.json();
  } catch {
    throw new AppError("invalid_input", "The request body must be JSON.", {
      hint: "Send a JSON object with the header Content-Type: application/json.",
      example: { blockId: "blk_...", text: "Ask in office hours" },
    });
  }
}

/**
 * Before the generic session check, so an agent with a write key learns why in plain words:
 * side notes are hers, and agents only read them.
 */
const onlyHer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = getAuth(c);
  if (auth.via !== "session" || auth.actor.type !== "user") {
    throw new AppError(
      "forbidden",
      "Side notes are hers: an agent can read them, not write them.",
      {
        hint: "Read them with GET /api/documents/:id/margin-notes or the side_notes tool, then address them in your edits or in a request reply.",
      },
    );
  }
  await next();
};

/** Her session, never a key: a write scope first (so read-only keys get their usual answer). */
const hers = [requireWrite, onlyHer, requireSession] as const;

/**
 * Side note routes. Mount at "/api". Reading needs any sign-in (her session or any API key);
 * adding, changing, moving and deleting need her browser session.
 */
export function marginNotesRoutes(service: MarginNotesService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  // A malformed id is a missing one, like another person's.
  const did = (v: string | undefined) => {
    const r = DocumentId.safeParse(v);
    if (!r.success) {
      throw new AppError("not_found", "No such document.", {
        hint: "Document IDs look like doc_...; find one through its library node: GET /api/nodes/:nodeId/document.",
      });
    }
    return r.data;
  };
  const nid = (documentId: string, v: string | undefined) => {
    const r = MarginNoteId.safeParse(v);
    if (!r.success) {
      throw new AppError("not_found", "No such side note on this document.", {
        hint: `Side note IDs look like mgn_...; list them with GET /api/documents/${documentId}/margin-notes.`,
      });
    }
    return r.data;
  };

  app.get("/documents/:id/margin-notes", requireAuth, (c) => {
    return c.json({ items: service.list(getAuth(c), did(c.req.param("id"))) });
  });

  app.post("/documents/:id/margin-notes", ...hers, async (c) => {
    const id = did(c.req.param("id"));
    return c.json({ note: service.create(getAuth(c), id, await readBody(c)) }, 201);
  });

  app.patch("/documents/:id/margin-notes/:noteId", ...hers, async (c) => {
    const id = did(c.req.param("id"));
    const noteId = nid(id, c.req.param("noteId"));
    return c.json({ note: service.update(getAuth(c), id, noteId, await readBody(c)) });
  });

  app.delete("/documents/:id/margin-notes/:noteId", ...hers, (c) => {
    const id = did(c.req.param("id"));
    service.delete(getAuth(c), id, nid(id, c.req.param("noteId")));
    return c.body(null, 204);
  });

  app.post("/documents/:id/margin-notes/:noteId/reattach", ...hers, async (c) => {
    const id = did(c.req.param("id"));
    const noteId = nid(id, c.req.param("noteId"));
    return c.json({ note: service.reattach(getAuth(c), id, noteId, await readBody(c)) });
  });

  return app;
}
