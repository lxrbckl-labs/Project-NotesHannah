import { AppError } from "../../http/errors.js";

/**
 * A streaming `multipart/form-data` reader. File bytes go to the handlers as
 * they arrive and are never gathered in memory; only the small part headers
 * and short text fields are held.
 */
export interface MultipartHandlers {
  field(name: string, value: string): void;
  fileStart(info: { name: string; filename: string; contentType: string }): void | Promise<void>;
  fileData(chunk: Buffer): Promise<void>;
  fileEnd(): void | Promise<void>;
}

const MAX_HEADER_BYTES = 8 * 1024;
const MAX_FIELD_BYTES = 4 * 1024;
const MAX_PARTS = 20;

const EXAMPLE = {
  hint: 'Send multipart/form-data with the file in a field named "file", e.g. curl -F file=@notes.pdf -F nodeId=nod_… .',
};

function bad(message: string): AppError {
  return new AppError("invalid_input", message, EXAMPLE);
}

/** The boundary from a `Content-Type: multipart/form-data; boundary=…` header. */
export function boundaryOf(contentType: string | undefined): string {
  const match =
    contentType &&
    /^multipart\/form-data\s*;(?:.*;)?\s*boundary=("[^"]{1,70}"|[^\s;]{1,70})/i.exec(contentType);
  if (!match?.[1]) throw bad("The request must be multipart/form-data with a boundary.");
  return match[1].replace(/^"|"$/g, "");
}

function parseDisposition(value: string): { name: string; filename: string | null } | null {
  if (!/^form-data\b/i.test(value.trim())) return null;
  const param = (key: string): string | null => {
    const m = new RegExp(`;\\s*${key}=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\\s]*))`, "i").exec(value);
    if (!m) return null;
    return (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1");
  };
  const name = param("name");
  return name === null ? null : { name, filename: param("filename") };
}

type State = "preamble" | "afterDelimiter" | "headers" | "body" | "done";

export async function parseMultipart(
  body: AsyncIterable<Uint8Array>,
  boundary: string,
  handlers: MultipartHandlers,
): Promise<void> {
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  // The first boundary has no CRLF before it; pretend it does.
  let buf: Buffer = Buffer.from("\r\n");
  let state = "preamble" as State;
  const finished = (): boolean => state === "done";
  let parts = 0;
  let files = 0;
  let current:
    | { kind: "file" }
    | { kind: "field"; name: string; chunks: Buffer[]; size: number }
    | null = null;

  async function advance(): Promise<boolean> {
    switch (state) {
      case "preamble": {
        const at = buf.indexOf(delimiter);
        if (at < 0) {
          buf = buf.subarray(Math.max(0, buf.length - (delimiter.length - 1)));
          return false;
        }
        buf = buf.subarray(at + delimiter.length);
        state = "afterDelimiter";
        return true;
      }
      case "afterDelimiter": {
        if (buf.length < 2) return false;
        if (buf[0] === 0x2d && buf[1] === 0x2d) {
          state = "done";
          return false;
        }
        if (buf[0] === 0x0d && buf[1] === 0x0a) {
          buf = buf.subarray(2);
          state = "headers";
          return true;
        }
        throw bad("The multipart body is malformed.");
      }
      case "headers": {
        const at = buf.indexOf("\r\n\r\n");
        if (at < 0) {
          if (buf.length > MAX_HEADER_BYTES) throw bad("A multipart part header is too long.");
          return false;
        }
        if (at > MAX_HEADER_BYTES) throw bad("A multipart part header is too long.");
        const headers = buf.subarray(0, at).toString("utf8");
        buf = buf.subarray(at + 4);
        let disposition: ReturnType<typeof parseDisposition> = null;
        let contentType = "application/octet-stream";
        for (const line of headers.split("\r\n")) {
          const colon = line.indexOf(":");
          if (colon < 0) continue;
          const key = line.slice(0, colon).trim().toLowerCase();
          const value = line.slice(colon + 1).trim();
          if (key === "content-disposition") disposition = parseDisposition(value);
          if (key === "content-type") contentType = value;
        }
        if (!disposition) throw bad("A multipart part has no Content-Disposition name.");
        if (++parts > MAX_PARTS) throw bad("Too many multipart parts.");
        if (disposition.filename !== null) {
          if (disposition.name !== "file") {
            throw bad(
              `Unexpected file field "${disposition.name}". The file goes in the field "file".`,
            );
          }
          if (++files > 1) throw bad("Send one file per request.");
          await handlers.fileStart({
            name: disposition.name,
            filename: disposition.filename,
            contentType,
          });
          current = { kind: "file" };
        } else {
          current = { kind: "field", name: disposition.name, chunks: [], size: 0 };
        }
        state = "body";
        return true;
      }
      case "body": {
        const at = buf.indexOf(delimiter);
        const upTo = at >= 0 ? at : buf.length - (delimiter.length - 1);
        if (upTo > 0 && current) {
          const data = buf.subarray(0, upTo);
          if (current.kind === "file") await handlers.fileData(Buffer.from(data));
          else {
            current.size += data.length;
            if (current.size > MAX_FIELD_BYTES)
              throw bad(`The field "${current.name}" is too long.`);
            current.chunks.push(Buffer.from(data));
          }
          buf = buf.subarray(upTo);
        }
        if (at < 0) return false;
        buf = buf.subarray(delimiter.length);
        if (current?.kind === "file") await handlers.fileEnd();
        else if (current)
          handlers.field(current.name, Buffer.concat(current.chunks).toString("utf8"));
        current = null;
        state = "afterDelimiter";
        return true;
      }
      case "done":
        return false;
    }
  }

  for await (const chunk of body) {
    buf = buf.length === 0 ? Buffer.from(chunk) : Buffer.concat([buf, chunk]);
    while (await advance()) {
      // keep going while the buffer holds a complete step
    }
    if (finished()) return;
  }
  if (!finished()) throw bad("The multipart body ended early.");
}
