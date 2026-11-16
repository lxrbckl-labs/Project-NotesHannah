// `pnpm smoke <base-url>`: the check to run after every redeploy. Read-only and signed out: plain GET
// requests (and one unauthenticated POST that must be refused), no browser, no writes.
// Exits 0 when everything holds, 1 with the list of what failed.
const [, , argument] = process.argv;
const base = (argument ?? process.env.SMOKE_URL ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: pnpm smoke <base-url>   (for example https://notes.example.app)");
  process.exit(2);
}

const results = [];
const check = async (name, run) => {
  try {
    const problem = await run();
    results.push({ name, problem: problem || null });
  } catch (error) {
    results.push({ name, problem: `${error.name}: ${error.message}` });
  }
};
const get = (path, init = {}) =>
  fetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
const type = (response) => response.headers.get("content-type") ?? "";

const shell = await get("/").catch((error) => error);
let html = "";
await check("the shell answers 200 as HTML", async () => {
  if (shell instanceof Error) return `could not connect: ${shell.message}`;
  html = await shell.text();
  if (shell.status !== 200) return `status ${shell.status}`;
  if (!type(shell).includes("text/html")) return `content-type ${type(shell)}`;
});
await check("the shell is never cached (Cache-Control: no-cache)", () => {
  if (shell instanceof Error) return "no response";
  const value = shell.headers.get("cache-control") ?? "";
  if (!value.includes("no-cache")) return `Cache-Control is "${value}"`;
});
await check("the shell carries the noindex header", () => {
  if (shell instanceof Error) return "no response";
  const value = shell.headers.get("x-robots-tag") ?? "";
  if (!value.includes("noindex")) return `X-Robots-Tag is "${value}"`;
});

// The build's files, as the shell names them (the entry script, its styles and preloads).
const named = [
  ...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])),
];
await check("the shell names the build's files", () => {
  if (!named.some((path) => path.endsWith(".js"))) return "no /assets/*.js in the shell's HTML";
});
await check(
  `all ${named.length} files the shell names are served with the right type`,
  async () => {
    const wrong = [];
    for (const path of named) {
      const response = await get(path);
      const wanted = path.endsWith(".css") ? "text/css" : "javascript";
      if (response.status !== 200) wrong.push(`${path}: status ${response.status}`);
      else if (!type(response).includes(wanted))
        wrong.push(`${path}: content-type ${type(response)}`);
    }
    if (wrong.length) return wrong.join("; ");
  },
);

await check("a made-up /assets file is a 404, not the page shell", async () => {
  const response = await get(`/assets/smoke-${Date.now()}.js`);
  if (response.status !== 404) return `status ${response.status}`;
  if (type(response).includes("text/html")) return "answered 404 but with HTML";
});
await check("/guide/notes-guide.pdf is a PDF", async () => {
  const response = await get("/guide/notes-guide.pdf");
  if (response.status !== 200) return `status ${response.status}`;
  if (!type(response).includes("application/pdf")) return `content-type ${type(response)}`;
  const start = Buffer.from(await response.arrayBuffer())
    .subarray(0, 5)
    .toString("latin1");
  if (start !== "%PDF-") return `the body starts with "${start}", not %PDF-`;
});
await check("/healthz is healthy", async () => {
  const response = await get("/healthz");
  if (response.status !== 200) return `status ${response.status}`;
  const body = await response.json().catch(() => null);
  if (body?.ok !== true) return `body is ${JSON.stringify(body)}`;
});
await check("/api/me is 401 when signed out", async () => {
  const response = await get("/api/me");
  if (response.status !== 401) return `status ${response.status}`;
});
await check("/mcp refuses a request without a key", async () => {
  const response = await get("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (![401, 403].includes(response.status)) return `status ${response.status}`;
});

const failed = results.filter((r) => r.problem);
for (const r of results)
  console.log(`${r.problem ? "FAIL" : "ok  "}  ${r.name}${r.problem ? `: ${r.problem}` : ""}`);
console.log(
  `\n${results.length - failed.length} of ${results.length} checks passed against ${base}`,
);
if (failed.length) {
  console.error(
    `\n${failed.length} failed:\n${failed.map((r) => `  - ${r.name}: ${r.problem}`).join("\n")}`,
  );
  process.exit(1);
}
