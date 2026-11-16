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

The workflow in short: first her requests (requests list, claim, do it,
complete with a reply). Then the inbox: source_files upload_links and one bare
curl -X PUT per local file (or take what is already there), source_files wait
until converted, claim, read every page (get_page), save_transcript for each,
create the term, course and lecture (edit_library), source_files file. Then claim
the lecture for writing (edit_library claim), collect quotes (get_item on the file
with "text": true), write the lecture note (write_document), record concepts and
relations (concepts upsert), author practice questions (practice_questions
create), and release every claim.

Filing needs transcripts: source_files file (and move) is refused while any page
of the file has no transcript, and the error lists the page numbers. Only if a
page truly cannot be transcribed, pass "force": true with a short "reason"
(it is recorded in the activity log).

Study map: every document has a map she can open, its blocks as cards in frames
joined by labelled connectors. When she asks you to arrange or summarise a
document visually, use study_map (get, set_structure, change). You describe the
structure only; the app lays it out, she can drag cards, and what she places
stays where she put it. Never send coordinates. Her pinned or edited items are
left alone unless you pass the requestId of her request about the whole document.
start_here with topic "study_map" has every operation.

Trusted references: her notes are built from her slides and handwriting, and
trusted outside references check and extend them. Call references (action
"list") before writing or revising notes on a topic: it returns the built-in
sites (PharmGuides: the guideline index, AntibioticDex for spectrum, DoseDex for
emergency doses, TNKalc, Pharmacy Notes, and its search address) and the pages
she saved, tied to her lectures. Read them with your own web access; the app
does not fetch pages for you. Her slides come first: where a reference
disagrees, keep her slide, cite it, and add a source_conflict flag naming the
reference. Anything taken from or checked against a reference goes in the
block's "references" ([{"title", "url"}]): it shows as its own labelled chip,
never as one of her sources. Summarise in your own words with the link; never
paste long passages, tables or figures from a site.

Answering a request: the numbers with units in your reply (doses, ranges,
decimals) are checked against the page or block the request is about and what you
link. Figures found nowhere come back as a warning and nothing is completed; link
a source that has them, or pass "acknowledgeUnsourced": true if they truly come
from general knowledge (she then sees the reply flagged).

Rules in one breath
-------------------
Transcribe verbatim and flag every dose, unit and decimal. Every generated
block cites a page (with a quote copied exactly from its transcript), names
the trusted reference it comes from, or is marked general knowledge. Never overwrite what she wrote or reviewed unless she
asked: her request, claimed by you, is what lifts that protection (pass its
requestId). Nothing is ever permanently deleted by an agent; trash is restorable.
Errors explain the rule and include a valid example: read them and retry.
`;

export function agentGuide(origin: string): string {
  return AGENT_GUIDE_TEMPLATE.replaceAll("{{ORIGIN}}", origin);
}
