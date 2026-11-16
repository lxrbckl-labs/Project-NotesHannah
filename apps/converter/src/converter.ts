import type { ConvertedType, DonePage } from "./protocol.js";

export interface ConvertRequest {
  jobId: string;
  /** Absolute path of the original (read only). */
  inputPath: string;
  /** Absolute path of an empty directory to write 0001.webp and thumbs/0001.webp into. */
  outDir: string;
}

export interface ConvertSuccess {
  type: ConvertedType;
  pages: DonePage[];
  warnings: { code: string; message: string; page?: number }[];
  /** Pipeline stage timings in milliseconds. */
  timings: Record<string, number>;
  toolVersions: Record<string, string>;
  peakRssBytes: number | null;
}

/**
 * Turns one original into page images. Throws ConvertError for expected failures; rejects once the signal
 * aborts (the worker is shutting down). The queue logic only knows this interface, so tests use a fake.
 */
export interface Converter {
  convert(req: ConvertRequest, signal: AbortSignal): Promise<ConvertSuccess>;
}
