import yauzl from "yauzl";
import type { Limits } from "../config.js";
import { ConvertError } from "../errors.js";

export interface ZipScan {
  entries: string[];
  declaredBytes: number;
  actualBytes: number;
  contentTypesXml: string;
}

/**
 * Open the archive and inflate EVERY entry into a counter (not to disk) so the real decompressed size is known
 * before LibreOffice sees the file. Declared sizes in headers are not trusted: yauzl errors when an entry
 * inflates past its declared size, and we abort once the running total passes the cap.
 */
export function scanZip(path: string, limits: Limits): Promise<ZipScan> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => {
        if (err || !zip) {
          reject(
            new ConvertError(
              "corrupt_file",
              `not a readable zip archive: ${err?.message ?? "unknown"}`,
            ),
          );
          return;
        }
        const entries: string[] = [];
        let declared = 0;
        let actual = 0;
        let contentTypesXml = "";
        const fail = (e: ConvertError) => {
          zip.close();
          reject(e);
        };
        if (zip.entryCount > limits.maxZipEntries) {
          fail(
            new ConvertError(
              "too_large",
              `zip has ${zip.entryCount} entries (limit ${limits.maxZipEntries})`,
              "decompression_bomb",
            ),
          );
          return;
        }
        zip.on("error", (e) =>
          fail(new ConvertError("corrupt_file", `zip read error: ${e.message}`)),
        );
        zip.on("end", () =>
          resolve({ entries, declaredBytes: declared, actualBytes: actual, contentTypesXml }),
        );
        zip.on("entry", (entry: yauzl.Entry) => {
          entries.push(entry.fileName);
          declared += entry.uncompressedSize;
          if (declared > limits.maxZipUncompressedBytes) {
            fail(
              new ConvertError(
                "too_large",
                `zip declares ${declared} bytes uncompressed (limit ${limits.maxZipUncompressedBytes})`,
                "decompression_bomb",
              ),
            );
            return;
          }
          if (/\/$/.test(entry.fileName)) {
            zip.readEntry();
            return;
          }
          if (entry.isEncrypted()) {
            fail(
              new ConvertError(
                "encrypted_file",
                "a part of the file is encrypted",
                "zip_entry_encrypted",
              ),
            );
            return;
          }
          zip.openReadStream(entry, (e2, stream) => {
            if (e2 || !stream) {
              fail(
                new ConvertError(
                  "corrupt_file",
                  `cannot read zip entry ${entry.fileName}: ${e2?.message ?? "unknown"}`,
                ),
              );
              return;
            }
            const keep = entry.fileName === "[Content_Types].xml";
            const chunks: Buffer[] = [];
            stream.on("data", (d: Buffer) => {
              actual += d.length;
              if (actual > limits.maxZipUncompressedBytes) {
                stream.destroy();
                fail(
                  new ConvertError(
                    "too_large",
                    `zip inflates past ${limits.maxZipUncompressedBytes} bytes`,
                    "decompression_bomb",
                  ),
                );
                return;
              }
              if (keep && chunks.length < 64) chunks.push(d);
            });
            stream.on("error", (e3) =>
              fail(new ConvertError("corrupt_file", `zip entry ${entry.fileName}: ${e3.message}`)),
            );
            stream.on("end", () => {
              if (keep) contentTypesXml = Buffer.concat(chunks).toString("utf8");
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}

/** Read a few named entries (capped) after the scan has proven the archive is sane. */
export function readEntries(
  path: string,
  wanted: (name: string) => boolean,
  maxBytes: number,
): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) {
        reject(new ConvertError("corrupt_file", `cannot reopen zip: ${err?.message}`));
        return;
      }
      const out = new Map<string, string>();
      zip.on("error", (e) => reject(new ConvertError("corrupt_file", e.message)));
      zip.on("end", () => resolve(out));
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!wanted(entry.fileName) || entry.uncompressedSize > maxBytes) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) {
            reject(new ConvertError("corrupt_file", e2?.message ?? "read failed"));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (d: Buffer) => chunks.push(d));
          stream.on("error", (e3) => reject(new ConvertError("corrupt_file", e3.message)));
          stream.on("end", () => {
            out.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
