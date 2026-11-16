import { readdir, readFile } from "node:fs/promises";

export interface ProcInfo {
  pid: number;
  ppid: number;
  rssBytes: number;
}

/** Snapshot of every process from /proc (Linux). Returns null where /proc is unavailable (macOS development). */
export async function snapshotProcs(procRoot = "/proc"): Promise<ProcInfo[] | null> {
  let names: string[];
  try {
    names = await readdir(procRoot);
  } catch {
    return null;
  }
  const out: ProcInfo[] = [];
  await Promise.all(
    names
      .filter((n) => /^\d+$/.test(n))
      .map(async (n) => {
        try {
          const status = await readFile(`${procRoot}/${n}/status`, "utf8");
          const ppid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
          const rssKb = Number(/^VmRSS:\s+(\d+)\s+kB/m.exec(status)?.[1] ?? 0);
          if (Number.isFinite(ppid)) out.push({ pid: Number(n), ppid, rssBytes: rssKb * 1024 });
        } catch {
          /* exited while reading */
        }
      }),
  );
  return out;
}

/** The root and every process below it. */
export function treeOf(procs: ProcInfo[], root: number): ProcInfo[] {
  const byParent = new Map<number, ProcInfo[]>();
  for (const p of procs) {
    const list = byParent.get(p.ppid);
    if (list) list.push(p);
    else byParent.set(p.ppid, [p]);
  }
  const result: ProcInfo[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    const self = procs.find((p) => p.pid === pid);
    if (self) result.push(self);
    for (const c of byParent.get(pid) ?? []) stack.push(c.pid);
  }
  return result;
}
