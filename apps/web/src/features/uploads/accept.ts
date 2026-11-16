/**
 * What the file picker offers. The server decides by content (magic bytes), so this only guides the
 * picker: by extension and by MIME type. Image types are listed one by one (never `image/*`, which would
 * also offer SVG, a format that can carry scripts and is refused), and HEIC/HEIF explicitly: that makes
 * phones offer the camera and the photo library and keeps iOS from silently converting HEIC to JPEG.
 */
export const ACCEPT_EXTENSIONS = [
  ".pdf",
  ".pptx",
  ".pptm",
  ".ppsx",
  ".ppt",
  ".pps",
  ".odp",
  ".docx",
  ".docm",
  ".doc",
  ".odt",
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".avif",
  ".bmp",
];
export const ACCEPT_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.oasis.opendocument.text",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/avif",
  "image/bmp",
];
export const ACCEPT = [...ACCEPT_EXTENSIONS, ...ACCEPT_MIME].join(",");
