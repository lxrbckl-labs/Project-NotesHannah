# References

Outside references she relies on, and how they feed her notes. Features O1 to O6 in
[features.md](features.md); routes in [api.md](api.md#references); the agent tool in
[mcp.md](mcp.md).

## What it is for

Her notes are built from her own slides and handwritten notes. Trusted outside references are used
to check and extend them, and anything that comes from a reference is labelled as such.

- **Built-in sites.** A small typed registry, `REFERENCE_SITES` in `packages/schema/src/reference-sites.ts`,
  read by both the web app (one card per entry on `/references`) and the agents (the `references`
  tool). PharmGuides is the first entry: an independent, pharmacist-curated index of clinical
  practice guidelines by therapeutic area, with tools for antibiotic spectrum, emergency dosing,
  tenecteplase dosing and pharmacy equations. Another site is one more entry, no new layout code.
- **Her saved references.** Pages she keeps going back to (a guideline, a dosing chart), with her
  note and the courses, lectures or documents they belong with, so they show up where she studies.
- **Attribution in her notes.** A block can carry `references: [{ title, url, referenceId? }]`.
  These render as their own chip ("PharmGuides · DoseDex", an outside-link icon, opening the live
  page in a new tab), never as one of the numbered source chips that open her slides, and in their
  own "Outside references" group at the end of the document. A block may have both: her slide says
  it (citation) and the guideline confirms it (reference).

## How agents use it

Agents (Claude Code or Codex over MCP) call `references` with `list` before writing or revising notes
on a topic. It returns the built-in sites with their sections and search address pattern, flagged
trusted, and her saved references. Then:

1. Write from her slides and notes first, citing them.
2. Check the matching trusted reference with the agent's own web access (DoseDex for emergency doses,
   AntibioticDex for spectrum, the guideline index for current practice guidelines). The app never
   fetches a site for an agent.
3. Where a reference disagrees with her slide, keep the slide, cite it, and add a `source_conflict`
   flag naming the reference, so she sees the disagreement.
4. Anything taken from or checked against a reference goes in the block's `references`. It is never
   presented as if it came from her slides.
5. Summarise in its own words with the link; never paste long passages, tables or figures from a site.

## The copying rule, and why

PharmGuides' terms of use (read 2026-11-16) say its content may not be reproduced, redistributed,
modified or sold without permission, except for personal educational use. So:

- **Never in the repository.** No PharmGuides text, tables, charts or logo in the app, the seeders,
  fixtures, tests, the in-app guide or its PDF: shipping it with the software would be
  redistribution. The app shows the site's name as text with a generic icon, its section names and
  addresses, and describes it in our own words.
- **No crawling, bulk import or framing.** Links open the live site in a new tab
  (`rel="noopener noreferrer"`), and the Content-Security-Policy is unchanged (no frames).
- **In her notes:** short summaries in an agent's own words with the link, labelled as from the
  reference. That is personal educational use by one student in a private, sign-in-only library.

If the terms change, or the app ever has more than this one user, this rule must be revisited.

## Ties to her library

A reference can be tied to courses, folders, lectures and documents (at most 20). A place going to
the trash keeps its tie (shown as trashed, left out of filters) and the tie returns with it;
deleting the place for good removes the tie and keeps the reference; duplicating a place ties the
copy as well. Deleting a reference needs her browser session; agents can read and add only.
