import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConvertError, cleanMessage } from "../errors.js";
import { type Deadline, run } from "./exec.js";

/**
 * A fresh profile per run: nothing persists between files, so one document cannot influence the next.
 * Macros are blocked at the highest security level and macro execution is disabled outright.
 */
const REGISTRY = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="CrashReport" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
`;

export async function pptxToPdf(
  inputPptx: string,
  scratch: string,
  deadline: Deadline,
): Promise<string> {
  const profile = path.join(scratch, "lo-profile");
  const outDir = path.join(scratch, "lo-out");
  await mkdir(path.join(profile, "user"), { recursive: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(profile, "user", "registrymodifications.xcu"), REGISTRY);
  const filter =
    'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"},"ExportNotesPages":{"type":"boolean","value":"false"}}';
  const res = await run(
    deadline,
    "soffice",
    [
      `-env:UserInstallation=file://${profile}`,
      "--headless",
      "--invisible",
      "--norestore",
      "--nolockcheck",
      "--nodefault",
      "--nologo",
      "--nofirststartwizard",
      "--convert-to",
      filter,
      "--outdir",
      outDir,
      inputPptx,
    ],
    { env: { PATH: process.env.PATH ?? "", HOME: scratch, LANG: "C.UTF-8", TMPDIR: scratch } },
  );
  const produced = (await readdir(outDir)).filter((f) => f.endsWith(".pdf"));
  if (produced.length !== 1) {
    throw new ConvertError(
      "corrupt_file",
      `LibreOffice could not convert the presentation (exit ${res.code}): ${cleanMessage(res.stderr)}`,
    );
  }
  const [only] = produced;
  if (only === undefined) throw new ConvertError("corrupt_file", "LibreOffice produced no PDF");
  return path.join(outDir, only);
}
