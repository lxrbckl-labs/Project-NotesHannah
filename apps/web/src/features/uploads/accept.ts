/**
 * What the file picker offers. The server decides by content (magic bytes), so this only guides the
 * picker: PDF, PPTX, JPEG, PNG and HEIC, by extension and by MIME type. Listing the image types
 * (and HEIC/HEIF explicitly) makes phones offer the camera and the photo library, and keeps iOS
 * from silently converting HEIC photos to JPEG.
 */
export const ACCEPT_EXTENSIONS = [".pdf", ".pptx", ".jpg", ".jpeg", ".png", ".heic", ".heif"];
export const ACCEPT_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];
export const ACCEPT = [...ACCEPT_EXTENSIONS, ...ACCEPT_MIME].join(",");
