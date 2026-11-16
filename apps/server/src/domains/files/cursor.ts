import { AppError } from "../../http/errors.js";

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string, check: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (check(value)) return value;
  } catch {
    // fall through to the error below
  }
  throw new AppError("invalid_input", "The cursor is not valid.", {
    hint: "Pass the nextCursor value from the previous page unchanged, or omit cursor for the first page.",
    example: { limit: 50 },
  });
}
