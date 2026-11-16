import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

/** Write JSON to a temp name in the same directory, flush it, then rename it into place. */
export async function writeJsonAtomic(dir: string, name: string, value: unknown): Promise<void> {
  const tmp = path.join(dir, `.tmp-${process.pid}-${randomBytes(4).toString("hex")}-${name}`);
  const fh = await open(tmp, "w", 0o664);
  try {
    await fh.writeFile(JSON.stringify(value));
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, path.join(dir, name));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function mkdirp(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o775 });
}

export async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export function isEnoent(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as NodeJS.ErrnoException).code === "ENOENT";
}
