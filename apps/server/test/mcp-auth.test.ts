import { readFileSync } from "node:fs";
import { CreatedApiKey } from "@notes/schema";
import { describe, expect, test } from "vitest";
import { revokeApiKey } from "../src/domains/accounts/keys.js";
import { AGENT_GUIDE_TEMPLATE } from "../src/mcp/agent-guide.js";
import { errorCode } from "./helpers.js";
import { connect, mcpSetup } from "./mcp-harness.js";

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "curl", version: "1" },
  },
};
const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("MCP authentication", () => {
  test("no key: 401 with WWW-Authenticate and where to get a key", async () => {
    const { t } = await mcpSetup();
    const res = await t.request("/mcp", { body: INIT, headers: { accept: MCP_HEADERS.accept } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect(errorCode(res.body)).toBe("unauthenticated");
    const hint = (res.body as { error: { hint: string } }).error.hint;
    expect(hint).toContain("Settings, API keys");
    expect(hint).toContain("/agents.txt");
  });

  test("a wrong key and a malformed header are 401 invalid_token", async () => {
    const { t } = await mcpSetup();
    for (const authorization of [`Bearer nh_write_${"x".repeat(43)}`, "Bearer nope", "Basic abc"]) {
      const res = await t.request("/mcp", {
        body: INIT,
        headers: { ...MCP_HEADERS, authorization },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
      expect((res.body as { error: { message: string } }).error.message).toMatch(/not accepted/);
    }
  });

  test("a revoked key stops working at once", async () => {
    const { t, user, key, app } = await mcpSetup();
    const u = await user("hannah");
    const k = key(u.id);
    const before = await connect(app, k.secret);
    await before.ok("start_here");
    revokeApiKey(t.db, u.id, k.key.id, t.clock.now());
    const res = await app.request("http://localhost/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, authorization: `Bearer ${k.secret}` },
      body: JSON.stringify(INIT),
    });
    expect(res.status).toBe(401);
  });

  test("a browser session cookie is refused", async () => {
    const { t } = await mcpSetup();
    await t.addUser("hannah", "correct horse battery");
    const { cookies } = await t.signIn("hannah", "correct horse battery");
    const res = await t.request("/mcp", { body: INIT, cookies, headers: MCP_HEADERS });
    expect(res.status).toBe(401);
    expect((res.body as { error: { message: string } }).error.message).toMatch(
      /not browser sessions/,
    );
  });

  test("the real app mounts /mcp; a key made in Settings works with the SDK client", async () => {
    const { t } = await mcpSetup();
    await t.addUser("hannah", "correct horse battery");
    const { cookies } = await t.signIn("hannah", "correct horse battery");
    const res = await t.request("/api/keys", {
      cookies,
      body: { name: "Claude Code", scope: "write" },
    });
    const created = CreatedApiKey.parse(res.body);
    const agent = await connect(t.app, created.secret);
    const tools = await agent.client.listTools();
    expect(tools.tools.map((x) => x.name)).toContain("start_here");
    expect(agent.client.getInstructions()).toMatch(/start_here first/);
    const r = await agent.ok("browse_library");
    expect(r.text).toContain("The library is empty");
  });

  test("GET and DELETE /mcp are 405 for a stateless server; unknown /mcp paths 404", async () => {
    const { t, user, key } = await mcpSetup();
    const k = key((await user("hannah")).id);
    for (const method of ["GET", "DELETE"]) {
      const res = await t.request("/mcp", {
        method,
        headers: { authorization: `Bearer ${k.secret}`, accept: "text/event-stream" },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    const other = await t.request("/mcp/other", {
      headers: { authorization: `Bearer ${k.secret}` },
    });
    expect(other.status).toBe(404);
  });

  test("a read-only key sees the write tools but gets read_only_key from them", async () => {
    const { agent } = await mcpSetup();
    const a = await agent("hannah", "read");
    const names = (await a.client.listTools()).tools.map((x) => x.name);
    expect(names).toContain("edit_library");
    const start = await a.ok("start_here");
    expect(start.text).toContain("READ-ONLY");
    await a.ok("browse_library");
    const r = await a.fail("edit_library", {
      action: "create",
      parentId: null,
      kind: "term",
      name: "Fall 2026",
    });
    expect(r.error.code).toBe("read_only_key");
    expect(r.error.hint).toContain("read-write key");
  });
});

describe("agent guide", () => {
  test("GET /agents.txt is plain text with the endpoint and both agents' setup", async () => {
    const { t } = await mcpSetup();
    const res = await t.request("/agents.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = res.body as string;
    expect(text).toContain("http://localhost/mcp");
    expect(text).toContain("Authorization: Bearer");
    expect(text).toContain('default_tools_approval_mode = "approve"');
    expect(text).toContain("bearer_token_env_var");
    expect(text).toContain("network_access=true");
    expect(text).toContain("start_here");
    expect(text).not.toContain("{{ORIGIN}}");
  });

  test("the served guide is docs/agent-guide.md (copy the file into agent-guide.ts after editing)", () => {
    const md = readFileSync(new URL("../../../docs/agent-guide.md", import.meta.url), "utf8");
    expect(AGENT_GUIDE_TEMPLATE).toBe(md);
  });
});
