/**
 * The plain-text agent guide served at GET /agents.txt. Source:
 * docs/agent-guide.md (a test fails when the two differ; copy the file
 * into this string after editing it). {{ORIGIN}} is replaced per request.
 */
export const AGENT_GUIDE_TEMPLATE = `AGENT GUIDE: private study-notes app

What this is
------------
A private web app that builds study material for one pharmacy student from her
own lecture material. She uploads slides and handwritten notes; an AI agent
(Claude Code or Codex) transcribes the pages, files them under term, course and
lecture, and writes study material that cites the page it came from. The app
itself contains no AI. You, the agent, are its intelligence.

It is private. There is nothing public to read or crawl here, and every request
needs a key tied to one person's data.

Where to connect
----------------
MCP endpoint (Streamable HTTP, stateless, JSON responses):

  {{ORIGIN}}/mcp

Authentication: an API key, sent as  Authorization: Bearer <key>
There is no OAuth. A missing or wrong key gets HTTP 401.

Getting a key
-------------
The person who owns the notes creates one in the web app: Settings, API keys,
New key. Choose "read-write" to let the agent work (or "read-only" to only
look). The key is shown once; it starts with nh_write_ or nh_read_. It can be
revoked at any time on the same page. (The operator can also make one on the
server: admin create-key <username> --name "Claude Code" --scope write.)
Keep it in an environment variable, never in a file you commit:

  export NOTES_MCP_KEY='nh_write_...'

Claude Code
-----------
Save this as notes-mcp.json (the \${NOTES_MCP_KEY} reference is expanded by
Claude Code from your environment):

  {"mcpServers": {"notes": {"type": "http",
    "url": "{{ORIGIN}}/mcp",
    "headers": {"Authorization": "Bearer \${NOTES_MCP_KEY}"}}}}

Then run, for example:

  claude --mcp-config notes-mcp.json

Headless:

  claude -p --strict-mcp-config --mcp-config notes-mcp.json \\
    --allowedTools "mcp__notes" "Bash(curl:*)" "Read" "Process the inbox."

Codex CLI
---------
In ~/.codex/config.toml:

  [mcp_servers.notes]
  url = "{{ORIGIN}}/mcp"
  bearer_token_env_var = "NOTES_MCP_KEY"
  default_tools_approval_mode = "approve"

Or per run, without touching the config file:

  codex exec \\
    -c 'mcp_servers.notes.url="{{ORIGIN}}/mcp"' \\
    -c 'mcp_servers.notes.bearer_token_env_var="NOTES_MCP_KEY"' \\
    -c 'mcp_servers.notes.default_tools_approval_mode="approve"' \\
    "Process the inbox."

Without default_tools_approval_mode = "approve" (or interactive approval),
codex exec refuses every tool call with "MCP tool call requires approval".
Codex does not show the server's instructions to the model, so tell it to call
start_here first if it does not.

Uploading files and downloading page images use curl. Codex's default sandbox
blocks network access; allow it for those runs, and give it read access to the
folder with the files:

  -s workspace-write -c 'sandbox_workspace_write.network_access=true' --add-dir <folder>

The activity log in the app names each agent: Claude Code and Codex are
recognised by their User-Agent; any other client can send an X-Agent-Label
header (for example "X-Agent-Label: My script").

First call
----------
Call the tool start_here. It explains the library, the whole workflow, the
transcription and citation rules, the block types and what your key may do, and
reports live facts such as how many files are waiting in the inbox.

The workflow in short: request_upload_links and curl -X PUT each local file (or
take what is already in the inbox), source_files wait until converted, claim,
read every page (get_page), save_transcript for each, create the term, course and
lecture (edit_library), source_files file, collect quotes (get_item on the file
with "text": true), write_document with every block citing its page, release.

Rules in one breath
-------------------
Transcribe verbatim and flag every dose, unit and decimal. Every generated
block cites a page (with a quote copied exactly from its transcript) or is
marked general knowledge. Never overwrite what she wrote or reviewed unless she
asked. Nothing is ever permanently deleted by an agent; trash is restorable.
Errors explain the rule and include a valid example: read them and retry.
`;

export function agentGuide(origin: string): string {
  return AGENT_GUIDE_TEMPLATE.replaceAll("{{ORIGIN}}", origin);
}
