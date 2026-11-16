# Risks and research findings

Research run on 2026-11-15, before any code. Four areas: agent connectors, canvas and
editor libraries, file ingestion, hosting. Items marked **checked** were confirmed at the
source by a second read; the rest are as reported by the research pass, and several rest
on general knowledge rather than a fetched source. Re-verify anything load-bearing before
relying on it.

## Findings that changed the design

### Chat apps do not reliably pass connector images to the model (checked)

- Claude web and desktop: an open issue reports the model receiving empty image slots
  from remote MCP tools, while Claude Code works with the same server.
  <https://github.com/anthropics/claude-ai-mcp/issues/238>
- ChatGPT: OpenAI support said connector output should not be treated as a guaranteed
  path for tool-returned images to reach the model.
  <https://community.openai.com/t/chatgpt-connector-returns-empty-for-mcp-tool-results-with-type-image-while-same-tool-works-in-mcp-inspector/1375446>
- **Consequence:** transcription is done by Claude Code or Codex sessions, not by a chat
  app. For bulk work the agent downloads page images and reads them from disk.

### tldraw needs a production licence key (checked)

- Hobby keys are discretionary and require the "made with tldraw" watermark.
  <https://tldraw.dev/community/license>
- **Consequence:** React Flow for the canvas.

### Chat-app connectors require OAuth

- Claude's connector client is stricter than the MCP specification, and ChatGPT's
  personal plans appear limited (reported, not confirmed).
  <https://claude.com/docs/connectors/building/authentication.md>
- **Consequence:** version one uses app-issued API keys only, which Claude Code and Codex
  accept. Chat apps are out of scope.

## Open risks, most serious first

| Risk | Mitigation |
|---|---|
| Misread drug names, doses, units and decimals in handwriting. No published accuracy figures for current models; prescription studies show look-alike names as the main error. | Keep the verbatim reading beside the normalised value. Flag uncertainty. Check names against RxNorm (free, 20 requests per second). Mark notes unverified until reviewed. Test on a real lecture as soon as one is available. |
| Container starts before the external drive is mounted and writes into an empty folder. | Marker file on the drive; the container refuses to start without it. |
| SQLite on a Docker Desktop bind mount has corruption reports; unconfirmed for this setup. | Keep the live database on a named volume. Stress-test with concurrent writers and an integrity check. |
| Docker Desktop may not start after a power loss without a login. | Reboot test on the mini. |
| Untrusted Office, PDF and image files (PDF, PPTX, PPT, DOCX, DOC, ODP, ODT, and JPEG, PNG, HEIC, WebP, GIF, TIFF, AVIF, BMP) are parsed by LibreOffice, netpbm and image libraries. SVG is not accepted at all, since it can carry scripts. | Throwaway conversion container: no network, read-only root, limits on CPU, memory, time, size, page count and pixel count. Detect type by content, not extension. Reject encrypted files with a clear error. |
| PPTX fidelity in LibreOffice: fonts, gradients, SmartArt; speaker notes dropped by default. | Install broad font packs. Extract text and notes from the file separately. Keep the original. |
| Automatic layout needs card sizes before it runs, and card heights vary. | Size classes per block type for first placement; re-layout in the browser after measuring; store positions once dragged. |
| React Bits is animation-heavy, and browsers cap live WebGL contexts. | Lightweight components only inside canvas cards; at most one WebGL background; pause off-screen; respect reduced motion; expect to retheme for dark mode. |
| Tool-result limits differ by client (Claude Code about 25,000 tokens per result; Codex 60-second default timeout; Codex reads only the first 512 characters of server instructions). | Short calls, paging, job IDs for long work, brief instructions with detail in the overview tool. |
| iOS installed web apps: gesture conflicts on a canvas, reports of lost local storage. | Server is the source of truth; local storage is only a cache. Test on a real iPad early. |
| iOS Safari may hand over HEIC or JPEG depending on the file input's accept list. | Accept both; detect by content; test the exact accept string on a device. |
| Many universities require instructor permission before course slides go into AI tools. | She checks her syllabi. Consider a per-course flag. |

## Not verified

- Handwriting accuracy of current models on pharmacy material.
- Apple Pencil, touch-editing and keyboard behaviour of the chosen libraries on iPad.
- Whether Codex shows image tool results to the model.
- ChatGPT's current plan requirements for connectors with write tools.
- External drive sleep and ejection behaviour on the mini.
- Storage estimates (roughly 10 to 20 MB of page images per 60-slide lecture).
- Current free-versus-paid split of Tiptap extensions.
