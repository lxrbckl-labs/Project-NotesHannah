export interface Warning {
  code: string;
  message: string;
  /** 1-based page the warning is about, when it is about one page. */
  page?: number;
}

/** What the pipeline knows about one converted page (the worker adds nothing to it). */
export interface PageResult {
  index: number;
  width: number;
  height: number;
  /** Size of the full-size page image in bytes. */
  bytes: number;
  hasTextLayer: boolean;
  nativeText: string | null;
  speakerNotes: string | null;
}

export type DetectedType = "pptx" | "pdf" | "jpeg" | "png" | "heic";

export interface PipelineResult {
  type: DetectedType;
  pages: PageResult[];
  warnings: Warning[];
  /** Milliseconds per stage, plus `total`. */
  timings: Record<string, number>;
}

export interface ImageRef {
  /** Path relative to the output directory. */
  file: string;
  width: number;
  height: number;
  bytes: number;
}
