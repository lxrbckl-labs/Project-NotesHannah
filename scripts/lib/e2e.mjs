// HTTP driver for scripts/stack-test.sh and scripts/restore-test.sh. Plain Node (fetch), no dependencies.
//
//   node e2e.mjs <command> --base http://127.0.0.1:PORT --user NAME --pass PASSWORD [options]
//
//   seed      --out state.json   sign in, create library content, upload fixtures through upload tickets with a
//                                write API key, wait for the real converter, sign a transcript, then capture
//   capture   --out state.json   read everything back through the API and write it (hashes of every byte served)
//   verify    --expect state.json  capture again and compare with an earlier capture; exit 1 on any difference
//   upload    --file PATH [--name N]  upload one file through a ticket; prints the file id
//   wait      --id fil_...       wait until that file is converted or failed; prints its status
//   describe  --id fil_...       status, page count and per-page hashes of one file, as one JSON line
//   add-note  --title T          create one more lecture note (used to prove a newer database snapshot restores)
//   login     [--expect-fail]    sign in (or prove that the password is refused)
//   throttle-ip                  send one failed sign-in with a spoofed X-Forwarded-For (proxy trust check)
//
// The Origin header sent is --origin (default: --base), which must equal the server's APP_ORIGIN.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const argv = process.argv.slice(2);
const command = argv[0];
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const base = (opt("base") ?? "").replace(/\/$/, "");
const origin = opt("origin", base);
const user = opt("user");
const pass = opt("pass");
const fixtures = resolve(
  opt("fixtures", new URL("../../fixtures/generated/", import.meta.url).pathname),
);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (message) => {
  console.error(`e2e: ${message}`);
  process.exit(1);
};

let cookie = "";
let apiKey = "";

async function call(method, path, { body, key, raw, headers = {}, expect } = {}) {
  const h = { Origin: origin, ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  else if (cookie) h.Cookie = cookie;
  let payload;
  if (body instanceof Uint8Array) payload = body;
  else if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(path.startsWith("http") ? path : `${base}${path}`, {
    method,
    headers: h,
    body: payload,
  });
  if (raw) return res;
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const wanted = expect ?? [200, 201, 204];
  if (!wanted.includes(res.status)) die(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}

async function login(expectFail = false) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (expectFail) return res.status;
  if (res.status !== 200) die(`sign-in failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) die("sign-in returned no cookie");
}

async function createKey() {
  const created = await call("POST", "/api/keys", {
    body: { name: "e2e write key", scope: "write" },
  });
  apiKey = created.secret;
  if (!/^nh_write_/.test(apiKey)) die("did not get a write key");
}

async function listAll(path) {
  const items = [];
  let cursor = null;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const page = await call(
      "GET",
      `${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return items;
}

async function uploadOne(path, nodeId) {
  const bytes = readFileSync(path);
  const name = opt("name", basename(path));
  const tickets = await call("POST", "/api/uploads/tickets", {
    key: apiKey,
    body: { files: [{ name, bytes: bytes.length }], ...(nodeId ? { nodeId } : {}) },
  });
  const ticket = tickets.items[0];
  // The ticket URL is built from APP_ORIGIN; the test reaches the server on --base.
  const url = ticket.url.replace(origin, base);
  const res = await fetch(url, { method: "PUT", body: bytes });
  const text = await res.text();
  if (res.status !== 201) die(`PUT ${basename(path)} -> ${res.status} ${text.slice(0, 300)}`);
  const file = JSON.parse(text).file;
  if (file.sha256 !== sha256(bytes))
    die(`${name}: server hash ${file.sha256} differs from the file's ${sha256(bytes)}`);
  return file;
}

async function waitFile(id, timeoutMs = 600000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const { file } = await call("GET", `/api/files/${id}`);
    if (["converted", "transcribed", "filed", "failed"].includes(file.status)) return file;
    if (Date.now() > end) die(`timed out waiting for ${id} (status ${file.status})`);
    await sleep(1000);
  }
}

// ---- capture: everything a user can see, reduced to stable values ------------------------------------------------
async function walk(parentId, out) {
  const items = await listAll(`/api/nodes${parentId ? `?parentId=${parentId}` : ""}`);
  for (const n of items) {
    out.push({
      id: n.id,
      kind: n.kind,
      name: n.name,
      parentId: n.parentId,
      path: n.path,
      section: n.section,
      lecture: n.lecture,
      course: n.course,
    });
    if (n.childCount > 0) await walk(n.id, out);
  }
}

async function capture() {
  const state = { nodes: [], files: [], documents: [] };
  const me = await call("GET", "/api/me");
  state.user = { id: me.user.id, username: me.user.username };
  await walk(null, state.nodes);
  state.nodes.sort((a, b) => a.id.localeCompare(b.id));
  const files = (await listAll("/api/files")).sort((a, b) => a.id.localeCompare(b.id));
  for (const f of files) {
    const original = await call("GET", `/api/files/${f.id}/original`, { raw: true });
    const originalBytes = new Uint8Array(await original.arrayBuffer());
    const entry = {
      id: f.id,
      originalName: f.originalName,
      sha256: f.sha256,
      bytes: f.bytes,
      type: f.type,
      status: f.status,
      pageCount: f.pageCount,
      nodeId: f.nodeId,
      originalStatus: original.status,
      originalSha256: sha256(originalBytes),
      pages: [],
    };
    const { items: pages } = await call("GET", `/api/files/${f.id}/pages`);
    for (const p of pages) {
      const image = {};
      for (const size of ["page", "thumb"]) {
        const res = await call("GET", `/api/pages/${p.id}/image?size=${size}`, { raw: true });
        const buf = new Uint8Array(await res.arrayBuffer());
        image[size] = {
          status: res.status,
          type: res.headers.get("content-type"),
          bytes: buf.length,
          sha256: sha256(buf),
        };
      }
      const { transcript } = await call("GET", `/api/pages/${p.id}/transcript`);
      entry.pages.push({
        id: p.id,
        index: p.index,
        width: p.width,
        height: p.height,
        hasTextLayer: p.hasTextLayer,
        nativeText: p.nativeText,
        speakerNotes: p.speakerNotes,
        image,
        transcript: transcript ? { text: transcript.text, revision: transcript.revision } : null,
      });
    }
    state.files.push(entry);
  }
  for (const n of state.nodes.filter((x) => x.kind === "lecture" || x.kind === "document")) {
    const res = await call("GET", `/api/nodes/${n.id}/document`, { raw: true });
    if (res.status !== 200) continue;
    const doc = await res.json();
    const content = await call("GET", `/api/documents/${doc.document.id}/content`);
    state.documents.push({
      id: doc.document.id,
      nodeId: n.id,
      title: doc.document.title,
      revision: doc.document.revision,
      blocks: content.blocks.map((b) => ({ id: b.id, type: b.type, content: b.content })),
    });
  }
  return state;
}

function diff(a, b, path = "$", out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    Array.isArray(a) === Array.isArray(b)
  ) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      diff(a[k], b[k], `${path}.${k}`, out);
  } else
    out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} != ${JSON.stringify(b)?.slice(0, 80)}`);
  return out;
}

function summarise(state) {
  const pages = state.files.reduce((n, f) => n + f.pages.length, 0);
  return `${state.nodes.length} library nodes, ${state.files.length} files, ${pages} pages (x2 images), ${state.documents.length} documents`;
}

// ---- commands ----------------------------------------------------------------------------------------------------
async function main() {
  if (!base) die("--base is required");
  if (command === "throttle-ip") {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Forwarded-For": opt("xff", "203.0.113.77"),
      },
      body: JSON.stringify({
        username: opt("who", "nobody-throttle"),
        password: "wrong-password-1",
      }),
    });
    console.log(res.status);
    return;
  }
  if (!user || !pass) die("--user and --pass are required");
  if (command === "login") {
    if (flag("expect-fail")) {
      const status = await login(true);
      console.log(status);
      process.exit(status === 401 ? 0 : 1);
    }
    await login();
    console.log("signed in");
    return;
  }
  await login();
  switch (command) {
    case "seed": {
      await createKey();
      const term = (
        await call("POST", "/api/nodes", {
          body: { parentId: null, kind: "term", name: "Fall 2026" },
        })
      ).node;
      const course = (
        await call("POST", "/api/nodes", {
          body: {
            parentId: term.id,
            kind: "course",
            name: "Pharmacology",
            course: { code: "PHAR 301" },
          },
        })
      ).node;
      const sections = (await call("GET", `/api/nodes?parentId=${course.id}`)).items;
      const lectures = sections.find((s) => s.section === "lectures");
      const sources = sections.find((s) => s.section === "sources");
      if (!lectures || !sources) die("a new course has no Lectures and Sources sections");
      const lecture = (
        await call("POST", "/api/nodes", {
          body: {
            parentId: lectures.id,
            kind: "lecture",
            name: "Beta blockers",
            lecture: { number: 7, date: "2026-10-14" },
          },
        })
      ).node;
      await call("POST", "/api/nodes", {
        body: { parentId: sources.id, kind: "folder", name: "Slides" },
      });
      await call("POST", "/api/documents", {
        body: {
          nodeId: lecture.id,
          kind: "lecture_note",
          title: "Beta blockers",
          blocks: [
            { type: "heading", content: { level: 2, text: "Beta-adrenergic antagonists" } },
            {
              type: "paragraph",
              content: { text: "Atenolol and metoprolol are cardioselective (beta-1) blockers." },
            },
          ],
        },
      });
      const wanted = [
        ["lecture.pptx", "pptx"],
        ["text-layer.pdf", "pdf"],
        ["photo.heic", "heic"],
      ];
      const uploaded = [];
      for (const [name] of wanted)
        uploaded.push(await uploadOne(`${fixtures}/${name}`, lecture.id));
      for (const [i, f] of uploaded.entries()) {
        const done = await waitFile(f.id);
        if (done.status === "failed")
          die(`${wanted[i][0]} failed to convert: ${done.errorCode} ${done.errorMessage}`);
        if (done.type !== wanted[i][1])
          die(`${wanted[i][0]}: type ${done.type}, expected ${wanted[i][1]}`);
        if (!(done.pageCount > 0)) die(`${wanted[i][0]}: no pages`);
      }
      const pdf = uploaded[1];
      const { items: pdfPages } = await call("GET", `/api/files/${pdf.id}/pages`);
      await call("PUT", `/api/pages/${pdfPages[0].id}/transcript`, {
        body: { text: "Beta blockers lower heart rate. Dose: 50 mg once daily." },
      });
      const state = await capture();
      writeFileSync(opt("out"), `${JSON.stringify(state, null, 2)}\n`);
      console.log(`seeded: ${summarise(state)}`);
      break;
    }
    case "capture": {
      const state = await capture();
      writeFileSync(opt("out"), `${JSON.stringify(state, null, 2)}\n`);
      console.log(`captured: ${summarise(state)}`);
      break;
    }
    case "verify": {
      const expected = JSON.parse(readFileSync(opt("expect"), "utf8"));
      const actual = await capture();
      const problems = diff(expected, actual);
      for (const f of actual.files) {
        if (f.originalSha256 !== f.sha256)
          problems.push(`original of ${f.id} does not hash to its recorded sha256`);
        for (const p of f.pages)
          for (const s of ["page", "thumb"])
            if (p.image[s].status !== 200 || p.image[s].bytes === 0)
              problems.push(`page ${p.id} ${s} image not served`);
      }
      if (problems.length > 0) {
        console.error(`verify: ${problems.length} difference(s)`);
        for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
        process.exit(1);
      }
      console.log(`verified identical: ${summarise(actual)}`);
      break;
    }
    case "upload": {
      await createKey();
      const file = await uploadOne(resolve(opt("file")), opt("node"));
      console.log(file.id);
      break;
    }
    case "wait": {
      const file = await waitFile(opt("id"), Number(opt("timeout", "600000")));
      console.log(file.status);
      break;
    }
    case "describe": {
      // Status, page count and per-page facts of one file, for comparing two conversions of the same input.
      const { file } = await call("GET", `/api/files/${opt("id")}`);
      const { items: pages } = await call("GET", `/api/files/${file.id}/pages`);
      const images = [];
      for (const p of pages) {
        const res = await call("GET", `/api/pages/${p.id}/image?size=page`, { raw: true });
        images.push(
          res.status === 200
            ? sha256(new Uint8Array(await res.arrayBuffer()))
            : `HTTP ${res.status}`,
        );
      }
      console.log(
        JSON.stringify({
          status: file.status,
          pageCount: file.pageCount,
          sha256: file.sha256,
          pages: pages.map((p, i) => ({
            index: p.index,
            width: p.width,
            height: p.height,
            text: sha256(Buffer.from(p.nativeText ?? "")),
            image: images[i],
          })),
        }),
      );
      break;
    }
    case "add-note": {
      const created = await call("POST", "/api/documents", {
        body: {
          parentId: opt("parent"),
          kind: "free",
          title: opt("title", "Written after the backup"),
          blocks: [{ type: "paragraph", content: { text: "Newer than the nightly backup." } }],
        },
      });
      console.log(created.documentId);
      break;
    }
    default:
      die(`unknown command ${command}`);
  }
}
await main();
