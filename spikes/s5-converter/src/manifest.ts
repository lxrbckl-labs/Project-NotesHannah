import type { Block } from "./pptx.js";

export interface Warning {
  code: string;
  message: string;
  page?: number;
}

export interface ImageRef {
  file: string; // relative to the output dir
  width: number;
  height: number;
  bytes: number;
}

export type NativeText =
  | {
      kind: "slide";
      title: string | null;
      text: string;
      notes: string | null;
      hidden: boolean;
      hasUnextractedObjects: boolean;
      blocks: Block[];
    }
  | { kind: "pdf"; text: string; hasTextLayer: boolean };

export interface PageRecord {
  page: number;
  image: ImageRef;
  thumb: ImageRef;
  native: NativeText | null; // null for photos/images: no native text exists
}

export interface Manifest {
  schemaVersion: 1;
  source: { sha256: string; bytes: number; detectedType: string; mime: string };
  pageCount: number;
  pages: PageRecord[];
  tools: Record<string, string>;
  limits: Record<string, number>;
  timingsMs: Record<string, number>;
  peakMemoryBytes: number | null;
  warnings: Warning[];
}
