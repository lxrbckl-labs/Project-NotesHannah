# Concepts and the request queue

The structured layer and the request queue, as built in `packages/schema/src/concepts.ts`,
`requests.ts` and the server domains `apps/server/src/domains/concepts` and `requests`.
Routes are in [api.md](api.md). Related: [architecture.md](architecture.md) (content model, MCP
layer), [features.md](features.md) (sections F, G12 and L), [blocks.md](blocks.md) (concept mentions
in rich text, citations).

## Concepts

A **concept** is one thing in the world: a drug, a drug class, a mechanism, a target, an
indication, an adverse effect, an interaction, a contraindication, a monitoring parameter, a
counselling point, or `other`. There is one per user whichever course mentions it, so
"everything that prolongs QT" works across courses. Agents file concepts while transcribing; the
app answers questions over them with no model.

```
Concept  { id, type, name, aliases[], drug?, summary, citations[], generalKnowledge,
           reviewStatus, origin, provenance }
  drug   { genericName?, brandNames[], rxcui?, nameCheck }      (type "drug" only)
Relation { id, from, to, type, note, interaction?, citations[], generalKnowledge,
           reviewStatus, origin, provenance }
```

- **Identity** is the type plus the normalised name (`conceptKey`): case, accents,
  punctuation and spacing are flattened, so `Metoprolol  TARTRATE®` and `metoprolol tartrate`
  are one concept. Aliases, brand names and generic names are searchable but are not identity.
- **Salts.** `metoprolol tartrate` and `metoprolol succinate` are not treated as `metoprolol`:
  they may differ clinically. `suggestDuplicates` reports look-alikes (an alias match, a
  salt or release-form variant, a one-letter slip on a name of six characters or more) as
  suggestions on creation, on the bulk result and on the concept page. Nothing is merged
  automatically; a person or agent confirms with `merge`.
- **Citations.** An agent-created concept or relation needs a citation or
  `generalKnowledge: true` (shown as "not from your notes"), never both. Citations are not
  rewritten when a source is trashed or deleted; the concept page computes each one's status
  (`available`, `source_trashed`, `source_deleted`) when it is read. Adding to something that
  already exists needs no new citation.
- **Edit protection**, as for blocks: an agent may rewrite a concept or relation only if it is
  its own and unreviewed (`canAgentOverwriteConcept`). Her edit makes it hers (`origin:
  "user"`, sticky) and reviewed. Her marking it reviewed changes only the review status.
  Against protected concepts a bulk upsert still adds aliases, brand names, citations and
  relations, and reports the text it left alone as `protectedFields`.

### Relations

Valid only between certain types (`RELATION_RULES`, one table everything checks):

| Relation | From | To |
|---|---|---|
| `belongs_to_class` | drug, drug class | drug class |
| `has_mechanism` | drug, drug class | mechanism |
| `acts_on` | drug, drug class, mechanism | target |
| `treats` | drug, drug class | indication |
| `causes_adverse_effect` | drug, drug class | adverse effect |
| `interacts_with` (symmetric; may carry severity and effect) | drug, drug class, interaction | drug, drug class, interaction |
| `contraindicated_in` | drug, drug class | contraindication |
| `monitored_by` | drug, drug class | monitoring parameter |
| `brand_of` | drug (the brand) | drug (the generic) |
| `related_to` (symmetric) | any | any |

`validateRelation(type, fromType, toType)` explains a refusal ("`causes_adverse_effect` links a
drug or a drug class to an adverse effect, but this one links a mechanism to a drug"), says
when the ends look swapped, lists the types that do fit, and gives a valid example.
Symmetric relations are stored once whichever end is named first. A class's relation reaches
its members: the filter queries and the comparison table follow `belongs_to_class` upward and
downward (up to six levels) and mark such a result as "through a class".

### Reading

Concept page (F2), graph neighbourhood (F3: breadth first, at most four hops and 200 nodes,
deterministic, `truncated` says when capped), shortest path, the three filters (F5), the
comparison-table data (D5), the brand and generic pairs (G12) and prefix search (FTS5 over
name, aliases, generic and brand names, exact name first) are described in api.md. The page
gathers mentions in documents and links from questions through narrow ports, so those lanes
need not be merged for concepts to work (`ConceptMentions`, `ConceptQuestions`, both with
in-memory fakes; a default `createDbConceptMentions` reads the documents lane's `blocks` table).

### Merge

`merge(keepId, mergeId)` folds two concepts of the same type into one: aliases (the old name
included), brand names, generic name, RxCUI, citations and relations are kept; relations that
would become a loop or repeat an existing one are dropped after moving their citations. The old
ID stays valid and leads to the survivor (`redirectedFrom`), including for the concept page,
document mentions of the old ID and links from questions. Redirects are always one hop.

## Drug-name check (F4)

Each drug concept has a `nameCheck`: `unchecked`, `matched` (with the RxCUI), `suggestion` (with
the spelling RxNorm suggests) or `unknown`. It is advisory. Saving a concept never waits for it
and never fails because of it; a timeout, an outage or a bad answer leaves `unchecked`, and a
later call to `POST /api/concepts/name-checks` tries again. It never renames anything.

**It is off unless `RXNORM_CHECK=1`.** When on, drug names, and only drug names, are sent to the
public RxNav service of the US National Library of Medicine
(`https://rxnav.nlm.nih.gov/REST`): never notes, quotes, user names or any other data. Please
keep that in mind before turning it on; it is a request to a US government service. The server
asks `rxcui.json?name=…&search=1` for an exact match (several answers are resolved to the
ingredient through `rxcui/{id}/properties.json`), then `approximateTerm.json` for the nearest
name, whose properties give the suggested spelling. RxNav is free and needs no key; its limit is 20
requests per second, and this client spaces requests at least 200 ms apart (about five per
second), times out after five seconds, and rests for a minute after any failure. Answers
(`matched`, `suggestion`, `unknown`, never failures) are cached in the `rxnorm_cache` table for
30 days, keyed by the normalised name.

Code: `DrugNameChecker` (one method, `check(name)`), `createFakeDrugNameChecker` for tests,
`createRxNavChecker` for the real client, `nameCheckerFromEnv(db, env)` which returns the real
client with the database cache only when `RXNORM_CHECK=1`. The tests of the real client run
against responses recorded once in `apps/server/test/concepts-rxnav-fixtures.json`; no test
touches the network.

## Request queue

A request is her note to the next agent session: a target (the library, a node, a document, a
block, a source file or page, or a question), a `kind` (the quick actions plus `other`), her
`message`, a status and, once answered, a reply with links to what the agent made or changed.

```
waiting --claim--> in_progress --complete--> done --reopen--> waiting
   |  ^                 |  |                   
   |  +--release/expiry-+  +--decline--> declined --reopen--> waiting
   +--decline--> declined
waiting | in_progress --cancel (hers)--> cancelled   (final)
```

The whole machine is data: `REQUEST_TRANSITIONS`, with `canTransition(status, action, actor)`
returning a refusal that says whether the actor or the status was wrong and what is possible
instead. The server enforces it for every route.

Decisions where the design was silent:

- **`cancelled`** is a fifth status, for a request she withdraws. The four named statuses are
  the ones her screen lists by default.
- **Declining** is allowed from `waiting` as well as `in_progress`: an agent can refuse
  something without first claiming it, so it is not left for the next agent to find again.
- **Expiry** is lazy: every call first makes requests with a lapsed claim `waiting` again, so no
  background timer is needed.
- **Edit protection.** A request lifts the documents domain's protection only through
  `verifyForEdit`, and only for a document or block target (see api.md).
- **Counts** count waiting, in progress, done, declined and cancelled (hidden requests, those
  on trashed things, excluded); `open` is waiting plus in progress.
- **Result links** are not checked against the library: an agent may link to anything it
  names. The reply is text for her, not a contract.

## For the integrator

- `apps/server/src/app.ts` mounts `requestsRoutes(deps)` and `conceptsRoutes(deps, ...)` with
  defaults that read the library, documents and files tables directly (`createDbTargetLookup`,
  `createDbConceptMentions`). Pass shared adapters when the real services exist: a
  `ConceptSources` (the same object as the documents lane's `SourceLookup` works), a
  `ConceptQuestions` over practice, a question lookup for requests.
- Call `requests.verifyForEdit` before the documents lane lets a `requestId` lift protection
  (today it trusts any ID).
- Call the hooks from the library and files routes: `requests.onNodeTrashed/Restored/Deleted`,
  `onFilesTrashed/Restored/Deleted`, `onQuestionsDeleted`, and `concepts.onSourceDeleted`
  (returns which concepts and relations cited the deleted file; nothing is rewritten).
- Config: `RXNORM_CHECK=1` (read from the environment by `nameCheckerFromEnv`; add it to
  `config.ts` if you want it validated there).
