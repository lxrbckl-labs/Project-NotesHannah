/**
 * Entry point of the conversion child process: node child.js <input> <outDir> <scratch>
 * It runs the pipeline and writes its outcome to <scratch>/result.json (never to stdout), so tool noise
 * cannot corrupt the result. Exit code 0 means "an outcome was written" (success or an expected failure);
 * anything else means the child crashed.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLimits } from "../config.js";
import { ConvertError, cleanMessage } from "../errors.js";
import { runPipeline } from "./pipeline.js";

export type ChildOutcome =
  | { ok: true; result: Awaited<ReturnType<typeof runPipeline>> }
  | { ok: false; code: ConvertError["code"]; message: string; reason?: string };

async function main(): Promise<void> {
  const [input, outDir, scratch] = process.argv.slice(2);
  if (!input || !outDir || !scratch || process.argv.length !== 5) {
    process.stderr.write("usage: child <input> <outDir> <scratch>\n");
    process.exit(64);
  }
  let outcome: ChildOutcome;
  try {
    outcome = {
      ok: true,
      result: await runPipeline({ input, outDir, scratch, limits: loadLimits() }),
    };
  } catch (e) {
    if (e instanceof ConvertError) {
      outcome = {
        ok: false,
        code: e.code,
        message: e.message,
        ...(e.reason ? { reason: e.reason } : {}),
      };
    } else {
      outcome = {
        ok: false,
        code: "conversion_failed",
        message: cleanMessage(e instanceof Error ? e.message : String(e)),
        reason: "internal",
      };
    }
  }
  await writeFile(path.join(scratch, "result.json"), JSON.stringify(outcome));
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
