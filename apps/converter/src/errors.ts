/** The subset of the schema's ErrorCode values a conversion can end with. */
export const CONVERT_ERROR_CODES = [
  "unsupported_type",
  "encrypted_file",
  "corrupt_file",
  "too_many_pages",
  "too_large",
  "conversion_failed",
] as const;
export type ConvertErrorCode = (typeof CONVERT_ERROR_CODES)[number];

/**
 * A conversion failed for a reason the person can act on or at least be told about.
 * `code` is the schema ErrorCode; `reason` is a finer machine-readable tag (not part of the schema).
 */
export class ConvertError extends Error {
  constructor(
    public readonly code: ConvertErrorCode,
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "ConvertError";
  }
}

/** Strip control characters and cap the length so a tool's stderr cannot bloat or confuse a result file. */
export function cleanMessage(text: string, max = 300): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
