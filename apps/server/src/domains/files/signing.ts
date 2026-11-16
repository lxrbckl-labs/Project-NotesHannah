import { createHmac, timingSafeEqual } from "node:crypto";

export type ImageSize = "page" | "thumb";

/** How long a signed page-image link works. */
export const SIGNED_URL_TTL_SECONDS = 300;

function mac(secret: Buffer | string, pageId: string, size: ImageSize, expires: number): Buffer {
  return createHmac("sha256", secret).update(`page-image\n${pageId}\n${size}\n${expires}`).digest();
}

export function signPageImage(
  secret: Buffer | string,
  pageId: string,
  size: ImageSize,
  expires: number,
): string {
  return mac(secret, pageId, size, expires).toString("base64url");
}

/** True only for an unexpired link whose signature matches exactly. */
export function verifyPageImage(
  secret: Buffer | string,
  pageId: string,
  size: ImageSize,
  expires: number,
  signature: string,
  nowSeconds: number,
): boolean {
  if (!Number.isInteger(expires) || expires < nowSeconds) return false;
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  const want = mac(secret, pageId, size, expires);
  return given.length === want.length && timingSafeEqual(given, want);
}
