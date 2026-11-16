import type { FileType } from "@notes/schema";

/** What each stored file type is called in the app, for the viewer's file details and any list. */
export const FILE_TYPE_LABELS: Record<FileType, string> = {
  pdf: "PDF",
  pptx: "PowerPoint presentation",
  ppt: "PowerPoint presentation (old format)",
  docx: "Word document",
  doc: "Word document (old format)",
  odp: "OpenDocument presentation",
  odt: "OpenDocument text document",
  jpeg: "JPEG photo",
  png: "PNG image",
  heic: "HEIC photo",
  webp: "WebP image",
  gif: "GIF image",
  tiff: "TIFF image",
  avif: "AVIF image",
  bmp: "BMP image",
};

/** Short names for lists, where the full label would crowd the row. */
export const FILE_TYPE_SHORT: Record<FileType, string> = {
  pdf: "PDF",
  pptx: "PowerPoint",
  ppt: "PowerPoint",
  docx: "Word",
  doc: "Word",
  odp: "Slides (ODP)",
  odt: "Text (ODT)",
  jpeg: "JPEG",
  png: "PNG",
  heic: "HEIC",
  webp: "WebP",
  gif: "GIF",
  tiff: "TIFF",
  avif: "AVIF",
  bmp: "BMP",
};

/** The one sentence about what can be uploaded; every message that lists the types builds on it. */
export const UPLOAD_TYPES_WORDS =
  "PDF, PowerPoint (.pptx, .ppt), Word (.docx, .doc), OpenDocument (.odp, .odt), or a photo or image (JPEG, PNG, HEIC, WebP, GIF, TIFF, AVIF, BMP)";

/** Types shown with a slides icon, a document icon, and (everything else) an image icon. */
export const SLIDE_TYPES: ReadonlySet<FileType> = new Set(["pptx", "ppt", "odp"]);
export const TEXT_TYPES: ReadonlySet<FileType> = new Set(["pdf", "docx", "doc", "odt"]);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
