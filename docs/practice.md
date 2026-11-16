# Practice: questions, grading, sessions

Code: `packages/schema/src/practice/`. Everything here is pure TypeScript: no I/O, no clock, no randomness
except from an explicit seed. The app has no AI, so the code in this folder is the only thing that grades.
Covers features G1 to G12 (and K1 for the source rule). See [features.md](features.md) and
[architecture.md](architecture.md) (Practice formats, Citations).

## Contents

1. [Common fields](#common-fields)
2. [Question types](#question-types) (one example each)
3. [How grading works](#how-grading-works)
4. [Calculation answer rules](#calculation-answer-rules)
5. [Sessions and attempts](#sessions-and-attempts)
6. [The missed-questions notebook](#the-missed-questions-notebook)
7. [Spaced repetition](#spaced-repetition)
8. [Weak areas](#weak-areas)
9. [For agents: authoring and validation](#for-agents-authoring-and-validation)
10. [Decisions and reasons](#decisions-and-reasons)

## Common fields

Two shapes exist for each type. **`QuestionInput`** is what an agent sends (no id, author or timestamps; option
and pair ids optional). **`Question`** is the stored form (adds `id`, `author`, `createdAt`, `updatedAt`,
`review`, and an id on every option and pair). `toStoredQuestion` turns one into the other.

| Field | Meaning |
|---|---|
| `type` | one of the eight types below |
| `prompt` | the question text (not on `fill_blank`, `flashcard`, `case`; see each type) |
| `image` | optional `{ pageId, region? }`; `region` is `{ x, y, width, height }` as fractions 0 to 1 of the page |
| `explanation` | required, shown after answering (optional on `flashcard` and `case`) |
| `sources` | up to 10 `Citation` (the shared type): `{ fileId, pageId, quote (1..1000), transcriptId?, transcriptRevision?, region?, label? }` |
| `generalKnowledge` | `true` only for a question not from her notes; labelled "not from your notes" |
| `difficulty` | 1 to 3, default 2 |
| `tags` | up to 20, lower-cased and de-duplicated on the way in |
| `conceptIds` | up to 20 concept links |
| stored only: `id`, `author` (Actor), `createdAt`, `updatedAt`, `review` (`unverified` or `reviewed`) | |

**Citation rule:** at least one source, or `generalKnowledge: true`, never both. Sources are the shared
`Citation` type of `citations.ts`.

**Light markdown** is allowed in `prompt`, `explanation`, `vignette`, `front`, `back` and `text`:
`**bold**`, `*italic*`, `` `code` ``, line breaks, and `- ` or `1. ` lists. Not allowed: headings, tables, code
fences, links, images, HTML. Option text, answers and rubric points are plain text.

## Question types

### multiple_choice
One question, 2 to 6 options, exactly one correct. Fields: `prompt`, `options[] { id?, text, correct?, rationale? }`,
`shuffle` (default true).

```json
{ "type": "multiple_choice",
  "prompt": "Which effect is expected with the (fictional) beta blocker lorvanol?",
  "options": [
    { "text": "Slower heart rate", "correct": true, "rationale": "Beta blockade lowers heart rate." },
    { "text": "Faster heart rate" }, { "text": "Higher potassium" } ],
  "explanation": "Beta blockers slow the heart rate and lower contractility.",
  "sources": [{ "fileId": "fil_...", "pageId": "pag_...", "quote": "Beta blockers lower heart rate" }] }
```

### select_all
2 to 8 options, one or more correct. Same fields as multiple choice. All-or-nothing, with a partial score also reported.

### matching
Left items matched to right items (brand to generic, drug to class). Fields: `prompt`, `pairs[] { id?, left, right }`
(2 to 12), `distractors[]` (extra wrong right-hand items, up to 6), `shuffle`. Left items are unique; several left
items may share a right item.

```json
{ "type": "matching", "prompt": "Match each brand name to its generic name (all fictional).",
  "pairs": [{ "left": "Veloxa", "right": "lorvanol" }, { "left": "Cardimar", "right": "tenzolol" }],
  "distractors": ["mirexapril"], "explanation": "...", "sources": [ ... ] }
```

### fill_blank
`text` with blanks written `{{1}}`, `{{2}}`, and one `blanks[]` entry per marker, in order. Each blank:
`answers[]` (1 to 10 accepted answers), `strict` (default false), `allowTypos` (default false).

```json
{ "type": "fill_blank", "text": "Lorvanol is a {{1}} blocker that lowers the {{2}}.",
  "blanks": [{ "answers": ["beta"] }, { "answers": ["heart rate", "pulse"] }],
  "explanation": "...", "sources": [ ... ] }
```

### calculation
A numeric answer with a required unit. See [Calculation answer rules](#calculation-answer-rules). Fields: `prompt`,
`answer` (`fixed` or `expression`), `units[]`, `tolerance` (default 1% relative), `rounding?`,
`allowFractions` (default false), `convertUnits` (default true).

```json
{ "type": "calculation",
  "prompt": "A patient weighs {weightKg} kg. The order is {doseMgPerKg} mg/kg as a single dose. How many mg?",
  "answer": { "kind": "expression", "expression": "weightKg * doseMgPerKg",
    "variables": { "weightKg": { "kind": "range", "min": 50, "max": 90, "step": 5 },
                   "doseMgPerKg": { "kind": "list", "values": [2, 3, 5] } } },
  "units": ["mg", "milligram"],
  "explanation": "Dose = {weightKg} x {doseMgPerKg} = {answer}.", "sources": [ ... ] }
```

### flashcard
`front`, `back`, optional `explanation`. Self-graded: again, hard, good, easy. Scheduled by spaced repetition.

```json
{ "type": "flashcard", "front": "Brand name of lorvanol (fictional)?", "back": "Veloxa", "sources": [ ... ] }
```

### case
A patient `vignette` plus 1 to 8 `questions[]` of any other type (not another case). Sub-questions carry their own
prompt, options and explanation; they share the case's sources, tags, concepts and difficulty and have no ids of
their own (they are addressed by position).

```json
{ "type": "case", "vignette": "A 64-year-old man with heart failure is started on lorvanol (fictional).",
  "questions": [
    { "type": "multiple_choice", "prompt": "Which finding should be monitored first?",
      "options": [{ "text": "Heart rate", "correct": true }, { "text": "Hair growth" }],
      "explanation": "Beta blockers can cause bradycardia." },
    { "type": "fill_blank", "text": "Lorvanol belongs to the {{1}} blocker class.",
      "blanks": [{ "answers": ["beta"] }], "explanation": "It is a beta blocker." } ],
  "sources": [ ... ] }
```

### free_response
`prompt`, `modelAnswer`, `rubric[] { point, points (1..10) }` (1 to 12 key points), `passFraction` (default 0.7).
Self-graded by ticking the key points she covered.

```json
{ "type": "free_response", "prompt": "Explain why lorvanol (fictional) is used in heart failure.",
  "modelAnswer": "It lowers heart rate and oxygen demand and reduces remodelling.",
  "rubric": [{ "point": "Lowers heart rate", "points": 1 }, { "point": "Reduces remodelling", "points": 2 }],
  "explanation": "...", "sources": [ ... ] }
```

## How grading works

`grade(question, answer, { variantSeed })` returns a `GradeResult`:
`{ correct, score (0..1), points, maxPoints, partialScore?, selfGraded, malformed, feedback[], correctAnswer, parts? }`.
`feedback` has one line per part (option, pair, blank, sub-question): `{ label, correct, code, message }`.
`correctAnswer` is `{ text, data }`: `text` for display, `data` in the same shape as a submitted answer.
It **never throws**: an unreadable answer (wrong type, unknown option id, wrong number of blanks, garbage) gives
`correct: false, score: 0, malformed: true` with the reason in the feedback.

Answers submitted by the client (one schema per type, `Answer` is their union):

| Type | Answer |
|---|---|
| multiple_choice | `{ type, optionId }` |
| select_all | `{ type, optionIds[] }` (empty = none of these) |
| matching | `{ type, matches[] { pairId, right } }` (`right` is the right-hand text she chose) |
| fill_blank | `{ type, blanks[] }` in order; `""` = left blank |
| calculation | `{ type, response, unit? }`, e.g. `"2.5 mg"`, or `"2.5"` plus a unit picker |
| flashcard | `{ type, rating }` |
| free_response | `{ type, text, covered[] }` (rubric positions from 0) |
| case | `{ type, parts[] }`, one entry per sub-question or `null` if skipped |

Per type:

- **multiple_choice:** correct if the chosen option is the correct one. Feedback combines the chosen option's
  rationale and the correct option's rationale.
- **select_all:** `correct` and `score` are all-or-nothing (every correct option selected, nothing else).
  `partialScore = max(0, (correct picks - wrong picks) / number correct)` is reported alongside. Feedback names
  each option as correct_pick, correct_skip, missed or wrongly_selected.
- **matching:** each pair is compared to the chosen right-hand text, ignoring case, spaces and punctuation.
  `points` = pairs right, `score` = pairs right / pairs, `correct` only when all are.
- **fill_blank:** each blank is matched against its accepted answers. Default matching is case-, space- and
  punctuation-insensitive (`Beta-Blocker`, `beta blocker` and `betablocker` are equal) but keeps digits, decimal
  points between digits, a minus sign before a number and `%`, so `2.5` and `25` differ; `2,5` equals `2.5` and
  `1,000` equals `1000`. `strict: true` compares exactly after trimming and collapsing spaces (case and
  punctuation count). `allowTypos: true` accepts edit distance 1 (a swap of neighbours counts as one) only for an
  accepted answer of 6 or more characters that contains no digit; it is never applied to anything with a digit.
  `points` = blanks right; `correct` only when all are.
- **calculation:** see below. One point.
- **flashcard:** self-graded. Score: again 0, hard 0.5, good 1, easy 1. `correct` unless "again".
- **free_response:** self-graded. `points` = sum of ticked key points, `score` = points / total, `correct` when
  `score >= passFraction`. A tick for a key point that does not exist is malformed.
- **case:** each sub-question is graded with its own derived variant seed. `points` and `maxPoints` add up (a
  matching sub-question is worth its pairs, a free response its rubric total), `score = points / maxPoints`,
  `correct` only when every sub-question is. A skipped sub-question scores zero. `parts[]` holds each result.

## Calculation answer rules

**Correct value.** `answer` is `{ kind: "fixed", value }` or `{ kind: "expression", expression, variables }`.

**Variants.** Variables are `{ kind: "range", min, max, step }` (every step from min to max) or
`{ kind: "list", values }`. Write `{name}` in the prompt (and explanation; `{answer}` also works in the
explanation) where a number belongs. `instantiateCalculation(question, seed)` picks a value for each variable
from the seed (same seed, same numbers, on any machine) and evaluates the expression.

**Expressions** use a hand-written parser, never `eval` or `Function`. Allowed: numbers (`1.5`, `1e3`),
variables, `+ - * / ^`, parentheses, `pi`, and the functions `min max round ceil floor sqrt ln log10 exp`.
Precedence: `^` (right-associative, `2^3^2 = 512`), then unary minus (`-2^2 = -4`), then `* /`, then `+ -`.
Unknown names (including `constructor`, `__proto__`, `process`), property access, and any other function are
errors. Division by zero, `sqrt` of a negative, `ln` or `log10` of zero or less, and non-finite results are errors.

**Reading her answer** (`parseLeadingNumber`):
- Number then unit, with or without a space: `2.5mg`, `2.5 mg`. Unit may be in a separate box (`unit`).
- Leading and trailing zeros are fine: `02.50` is 2.5. `.5` and `5.` work.
- Thousands separators: `1,250` and `1,250,000` (comma followed by exactly three digits is thousands),
  `1.250.000`, `1,250.5`, `1.250,5`. A single comma not followed by three digits is a decimal comma: `2,5` is 2.5.
  A space is not treated as a separator (`1 250 mg` reports an unreadable unit).
- Scientific notation: `1.5e3`, `1.5E-3`, `1.5 x 10^3`, `1.5×10^3`, `1.5 * 10^3`.
- Fractions (`1/2`, `1 1/2`) only if `allowFractions` is true; otherwise rejected with a specific reason.
- A real minus sign or Unicode minus is accepted.

**Units.** A fixed table: mass `mcg (ug, μg, µg) mg g kg`; volume `mL dL L`; time `min hr day`; `units`; `mEq`; `gtt`;
`tablet`; combined with `/` or "per": `mg/kg`, `mL/hr`, `mcg/kg/min`, `mg/dL`, `units/hr`. Case-insensitive.
Not accepted on purpose: bare `U` or `IU` (a classic error-prone abbreviation), `cc`, `oz`, `lb`. Kinds above and
below the line are compared without cancelling, so `mg/kg` is never confused with `mL/L`.
`units` on a question lists equivalent spellings (`["mg", "milligram"]`); they must be in the table, measure the
same thing and be the same size. The first is displayed.

**Checks, in order, first failure is reported:**
1. No answer (`empty`); no number (`no_number`); unreadable number (`bad_number`); fraction not allowed
   (`fraction_not_allowed`); `1/0` (`zero_denominator`).
2. Unit missing (`missing_unit`: the message shows an example); unit given twice; unit not in the table
   (`unknown_unit`); unit measures something else (`wrong_unit`: "mL measures a volume, but this answer is a mass").
3. Another size of the right unit. If `convertUnits` (default) and no rounding is set, the value is converted and
   compared (`0.0025 g` is accepted for 2.5 mg; the feedback says so). Otherwise it is rejected (`wrong_unit`).
4. Tolerance. Relative (default 1%) or absolute; the boundary counts as inside; a tiny epsilon absorbs
   floating-point noise.
5. Rounding instruction (`decimals` 0 to 6, or `sigfigs` 1 to 8), enforced when present: the correct value is first
   rounded half away from zero, and she may not give more decimal places or significant figures than asked
   (fewer is fine when the value is the same: `2.5` for 2 decimals). Whole-number trailing zeros do not count as
   significant. Right value, too precise: `rounding`. Unit conversion is switched off when rounding is set.
6. When wrong: if her value is a power of ten (10 to a billion, within 5%) away from the right one, the code is
   `magnitude_off` and the message says "1000 times too large" or "too small"; otherwise `too_high` or `too_low`.
   A 1000-fold unit error (`2.5 g` for `2.5 mg`) is therefore wrong, with the converted value shown
   (`2.5 g equals 2500 mg`).

## Sessions and attempts

`PracticeSession`: `id`, `scope`, `formats[]`, `length`, `seed`, `items[]`, `startedAt`, `finishedAt`.
`scope` is `{ kind: "nodes", nodeIds }`, `{ kind: "concepts", conceptIds }`, `{ kind: "exam", examId }`,
`{ kind: "missed" }` or `{ kind: "all" }`. Each item is `{ questionId, type, variantSeed, shuffleSeed }`: the
variant seed fixes a calculation's numbers, the shuffle seed fixes option order (`displayOrder`).

`Attempt`: `id`, `sessionId` (null for a one-off such as a flashcard review), `questionId`, `variantSeed` (null if
no variants), `answer`, `result` (a GradeResult), `timeTakenMs`, `at`.

`buildSession({ id, startedAt, scope, formats, length, seed, pool, history? })` is pure and reproducible (same input,
same session, whatever order the pool arrives in).
- `pool` is `{ question, nodeIds, examIds }[]`; the server fills `nodeIds` (the lecture and every folder above it)
  and `examIds` from the document tree, because questions do not store their location.
- **Balance:** questions are handed to the requested types in turn, so shares differ by at most one; a type with too
  few questions gives its share to the others.
- **Weak first:** with a `history`, questions are sampled with weight `1 + 3 x miss rate + 2 if the last attempt was
  wrong` (1 to 6; unseen is 1), by weighted sampling without replacement.
- The order is shuffled. A small pool gives a shorter session (`sessionShortfall`), never an error.

## The missed-questions notebook

Rule (`notebookEntries`): per question, in time order.
- An incorrect attempt puts it in the notebook (or keeps it there) and resets its run of correct answers to 0.
- While in the notebook, each correct attempt adds 1 to the run; an incorrect one resets it.
- At the required run it leaves: **1** correct answer for most types, **2 in a row for calculations** (a first
  success can be luck or a remembered variant).
- A correct attempt on a question not in the notebook changes nothing.
- Flashcards never enter: they have their own deck and schedule, and "again" is not a miss.
- Entries report `timesMissed`, `firstMissedAt`, `lastMissedAt`, `correctRun`, `stillNeeds`, newest miss first.
  Self-graded results use her self-assessment.

## Spaced repetition

**FSRS-6 with its 21 published default parameters** (the open-spaced-repetition reference implementations ts-fsrs
and py-fsrs). Each card keeps stability (days until recall falls to 90%) and difficulty (1 to 10).
`reviewCard(card, rating, now)` returns `{ card, intervalDays, retrievabilityBefore }`; `nextIntervals` previews
all four buttons; `dueCards(cards, now, { limit, newLimit })` lists overdue reviews (most overdue first), then new
cards. The clock is always passed in.

- First review: stability from the weights (again 0.212, hard 1.2931, good 2.3065, easy 8.2956), difficulty from
  `w4 - e^((g-1) w5) + 1`. Later: recall probability `(1 + FACTOR t/S)^-w20`; stability grows on success
  (hard penalty, easy bonus), drops after "again" (a lapse), and a review within the same day uses the short-term rule.
- Intervals are whole days, at least 1, at 90% target retention, capped at 36,500, kept in order again < hard < good < easy.
- No learning steps and **no interval fuzz** (fuzz is random; this must be reproducible).
- `ratingFromGrade` lets any question type be scheduled: correct is good, score 0.5 or more is hard, else again.

## Weak areas

`weakAreas(attempts, labels, options)` gives accuracy by tag, by concept and by lecture/folder (a question counts
under every folder above it). `labels` is `{ questionId, tags, conceptIds, nodeIds }[]`.
An area is `insufficient_data` until it has **5 attempts across 3 different questions** (or all the questions it has,
if fewer); then `weak` below 70% accuracy, else `ok`. So one wrong answer, or one question retried five times, never
labels a topic weak. Weak areas sort first (worst first), insufficient data last; partial credit shows in `meanScore`.
Attempts on questions with no labels are counted in `unmatchedAttempts`. All three thresholds are options.

## For agents: authoring and validation

`QUESTION_REGISTRY[type]` gives `{ label, description, schema, grading, appGrades, example }`. `validateQuestionInput(input)`
returns `{ ok: true, question }` (defaults filled, tags tidied) or `{ ok: false, problems[] }` where each problem is
`{ path: "$.options[2].text", message, example }` and `example` is a minimal valid question of that type. Every
problem is reported, not just the first. Beyond shape, it checks: no or several correct options, duplicate
options (ignoring case and punctuation), blank count not matching the `{{n}}` markers, duplicate left items in
matching, a distractor equal to a right item, calculation variables unused, undefined, or not shown in the prompt,
expressions that fail or are not finite anywhere in the variable ranges (all combinations are tried when there
are 600 or fewer, otherwise the corners plus a seeded sample), zero tolerance on a non-whole answer, relative tolerance
on an answer that can be 0, units outside the table or not equivalent, missing sources, markdown the app does not render.
`z.toJSONSchema(QuestionInput, { io: "input" })` works for the whole union and for each type.

## Decisions and reasons

- **FSRS-6, not SM-2.** Faithful to the published formulas and defaults, deterministic with fuzz off, better
  scheduling for the same effort. Caveat: the 21 weights, the difficulty formulas and
  the success-stability formula were checked against the ts-fsrs documentation; the forgetting-stability,
  same-day rule and interval ordering are written from memory of the same library and were not compared with a
  running copy. Tests pin hand-computed values, so a later comparison will show any drift.
- **Strict objects for author input.** A misspelt field (`choices` for `options`) is an error that names the allowed
  fields instead of being silently dropped.
- **Option and pair ids.** Answers refer to ids, not positions, so editing or reordering a question never breaks old
  attempts. Authors may omit them; `toStoredQuestion` assigns `o1`, `p1` and so on.
- **flashcard and fill_blank have no `prompt`.** They use `front`/`back` and `text`, as specified; `questionText()`
  returns the display text for any type.
- **Flashcard and case `explanation` are optional**, since the back of a card and each sub-question's own
  explanation already do that job.
- **select_all is all-or-nothing** (`score` 0 or 1) with `partialScore` reported; matching and fill-in report
  partial `score` but are `correct` only when everything is. Aggregated counts for cases use points.
- **Typos are off by default and capped:** one edit, 6+ characters, never near a digit. A wrong drug name one letter
  away from a real one would otherwise pass; authors turn it on per blank.
- **Calculation units must be in a closed table**, with no `U`/`IU`; unit conversion is on by default because
  `0.0025 g` is a right answer for 2.5 mg, but off when a rounding instruction is set.
- **Comma handling:** `2,500` is two thousand five hundred (comma plus exactly three digits is thousands), `2,5` is
  2.5. This is the one real ambiguity; it follows the app's US setting.
- **Variants are checked at authoring time over the whole range**, and at run time a failing draw is skipped, so a
  stored question cannot hand her a division by zero.
- **A case's sub-questions are unrefined parts**; the case checks them (with "Sub-question N:" in messages) so a
  mistake in sub-question 2 is reported once, at its own path.
- **Question location is not stored on the question.** Scopes and weak areas take `nodeIds` and `examIds` from the
  caller, because the document tree is the source of truth for where a block lives.
- **Self-graded results are trusted.** A free-response `correct` follows her ticks; nothing second-guesses her.

## Open questions for the product owner

- Should "hard" on a flashcard count as correct for weak-area accuracy (it does now) or as half?
- Should calculations ever accept an answer in another size of the unit during an exam-style session (conversion is a per-question flag today)?
- Is two correct in a row right for the calculation notebook, and should free-response and cases also need two?
- Which units are missing from the table (mmol, mOsm, INR; mg/min and mL/min already work as combinations)?
