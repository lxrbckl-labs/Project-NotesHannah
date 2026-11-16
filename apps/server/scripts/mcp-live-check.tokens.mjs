// Read a Claude Code stream-json transcript and print the context size of each
// assistant turn (input + cache read + cache write tokens) and how much it grew,
// so the cost of loading tool schemas and of a tool result can be read off.
// Usage: node scripts/mcp-live-check.tokens.mjs <transcript.jsonl>
import { readFileSync } from "node:fs";

let last = null;
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (e.type === "assistant" && e.message?.usage) {
    const u = e.message.usage;
    const ctx =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    const did = (e.message.content ?? [])
      .filter((c) => c.type !== "thinking")
      .map((c) => (c.type === "tool_use" ? `${c.name} ${JSON.stringify(c.input)}` : c.type))
      .join(", ");
    if (ctx !== last) {
      console.log(
        `context ${ctx} tokens${last === null ? "" : ` (+${ctx - last})`}; this turn: ${did}`,
      );
    }
    last = ctx;
  }
  if (e.type === "user") {
    for (const c of e.message?.content ?? []) {
      if (c.type === "tool_result" && Array.isArray(c.content)) {
        const refs = c.content.filter((x) => x.type === "tool_reference").length;
        if (refs) console.log(`  (ToolSearch loaded ${refs} tool schema(s))`);
      }
    }
  }
  if (e.type === "result") console.log(`cost $${e.total_cost_usd}`);
}
