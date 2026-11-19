/**
 * Authoring rules that go beyond the shape of the data: things a schema
 * cannot say but a wrong question would break. Each rule returns plain-language
 * problems with the path of the offending field, written so an agent can fix
 * its input without asking.
 *
 * The cheap rules run inside the Zod schemas (so stored questions obey them
 * too). The expensive one for calculations, trying the answer expression over
 * every combination of variable values, runs only when `deep` is set (the
 * authoring validator turns it on).
 */
import { ExpressionError, expressionVariables } from "./expression.js";
import { formatNumber } from "./numbers.js";
import { makeRng } from "./rng.js";
import { normaliseLoose } from "./text-match.js";
import { equivalentUnits, parseUnit, SUPPORTED_UNITS_HELP, sameDimension } from "./units.js";
import {
  answerValue,
  type CalcAnswer,
  MAX_VARIABLE_VALUES,
  MAX_VARIABLES,
  placeholdersIn,
  RESERVED_NAMES,
  sampleCombinations,
  VARIABLE_NAME,
  type VariableSpec,
  valueCount,
} from "./variants.js";

export type Path = Array<string | number>;
export interface Issue {
  path: Path;
  message: string;
}

/**
 * Light markdown is allowed in prompts, explanations and vignettes:
 * **bold**, *italic* or _italic_, `inline code`, line breaks, and bulleted
 * ("- item") or numbered ("1. item") lists. Not allowed: headings, tables,
 * code fences, links, images or HTML.
 */
export const LIGHT_MARKDOWN_RULE =
  "Light markdown only: **bold**, *italic*, `code`, line breaks, and '- ' or '1. ' lists. No headings, tables, code fences, links, images or HTML.";

export function markdownProblem(text: string): string | null {
  if (/<\/?[a-zA-Z][^>]*>/.test(text)) return `HTML is not allowed. ${LIGHT_MARKDOWN_RULE}`;
  if (/!\[[^\]]*\]\([^)]*\)/.test(text)) {
    return `Images cannot be embedded in text; use the image field. ${LIGHT_MARKDOWN_RULE}`;
  }
  if (/\[[^\]]+\]\([^)]*\)/.test(text)) return `Links are not allowed. ${LIGHT_MARKDOWN_RULE}`;
  if (/^\s{0,3}#{1,6}\s/m.test(text)) return `Headings are not allowed. ${LIGHT_MARKDOWN_RULE}`;
  if (/^\s*```/m.test(text)) return `Code fences are not allowed. ${LIGHT_MARKDOWN_RULE}`;
  if (/^\s*\|.*\|\s*$/m.test(text)) {
    return `Tables are not allowed in question text. ${LIGHT_MARKDOWN_RULE}`;
  }
  return null;
}

function markdownIssues(value: unknown, path: Path): Issue[] {
  if (typeof value !== "string") return [];
  const problem = markdownProblem(value);
  return problem ? [{ path, message: problem }] : [];
}

// ---------------------------------------------------------------- envelope

export interface EnvelopeLike {
  sources?: unknown[];
  generalKnowledge?: boolean;
}

/** Every question cites a source, or says it is general knowledge. */
export function citationIssues(q: EnvelopeLike): Issue[] {
  const n = q.sources?.length ?? 0;
  if (n === 0 && !q.generalKnowledge) {
    return [
      {
        path: ["sources"],
        message:
          "A question needs at least one source: sources: [{ fileId, pageId, quote }] pointing at the page it came from. " +
          "If it genuinely does not come from her notes, set generalKnowledge: true instead (it will be labeled 'not from your notes').",
      },
    ];
  }
  if (n > 0 && q.generalKnowledge) {
    return [
      {
        path: ["generalKnowledge"],
        message:
          "generalKnowledge: true means the question has no source from her notes, but sources are listed. Remove generalKnowledge, or remove the sources.",
      },
    ];
  }
  return [];
}

// ------------------------------------------------------------------- cores

interface OptionLike {
  id?: string;
  text: string;
  correct?: boolean;
}

function duplicateTexts(items: Array<{ text: string }>, path: Path, noun: string): Issue[] {
  const seen = new Map<string, number>();
  const issues: Issue[] = [];
  items.forEach((item, i) => {
    const key = normaliseLoose(item.text);
    if (key === "") {
      issues.push({
        path: [...path, i, "text"],
        message: `${noun} ${i + 1} is blank or has no letters or digits.`,
      });
      return;
    }
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({
        path: [...path, i, "text"],
        message: `${noun} ${i + 1} ("${item.text}") repeats ${noun.toLowerCase()} ${first + 1}. Each ${noun.toLowerCase()} must be different, ignoring case and punctuation.`,
      });
    } else seen.set(key, i);
  });
  return issues;
}

function duplicateIds(items: Array<{ id?: string }>, path: Path): Issue[] {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  items.forEach((item, i) => {
    if (item.id === undefined) return;
    if (seen.has(item.id)) {
      issues.push({
        path: [...path, i, "id"],
        message: `Id "${item.id}" is used twice. Ids must be unique within the question; leave id out and one is assigned.`,
      });
    }
    seen.add(item.id);
  });
  return issues;
}

function multipleChoiceIssues(q: { options: OptionLike[] }): Issue[] {
  const issues = [
    ...duplicateTexts(q.options, ["options"], "Option"),
    ...duplicateIds(q.options, ["options"]),
  ];
  const correct = q.options.filter((o) => o.correct).length;
  if (correct === 0) {
    issues.push({
      path: ["options"],
      message: "No option is marked correct. Set correct: true on exactly one option.",
    });
  } else if (correct > 1) {
    issues.push({
      path: ["options"],
      message: `${correct} options are marked correct, but multiple_choice has exactly one correct answer. Keep correct: true on one option, or use type "select_all" when several are right.`,
    });
  }
  return issues;
}

function selectAllIssues(q: { options: OptionLike[] }): Issue[] {
  const issues = [
    ...duplicateTexts(q.options, ["options"], "Option"),
    ...duplicateIds(q.options, ["options"]),
  ];
  if (!q.options.some((o) => o.correct)) {
    issues.push({
      path: ["options"],
      message:
        "No option is marked correct. select_all needs at least one option with correct: true.",
    });
  }
  return issues;
}

function matchingIssues(q: {
  pairs: Array<{ id?: string; left: string; right: string }>;
  distractors?: string[];
}): Issue[] {
  const issues: Issue[] = [...duplicateIds(q.pairs, ["pairs"])];
  const seenLeft = new Map<string, number>();
  q.pairs.forEach((p, i) => {
    const l = normaliseLoose(p.left);
    const r = normaliseLoose(p.right);
    if (l === "")
      issues.push({ path: ["pairs", i, "left"], message: `Pair ${i + 1} has an empty left item.` });
    if (r === "")
      issues.push({
        path: ["pairs", i, "right"],
        message: `Pair ${i + 1} has an empty right item.`,
      });
    const first = seenLeft.get(l);
    if (l !== "" && first !== undefined) {
      issues.push({
        path: ["pairs", i, "left"],
        message: `Left item "${p.left}" appears in pairs ${first + 1} and ${i + 1}. Each left item may appear once (several left items may share a right item, such as two drugs of the same class).`,
      });
    } else seenLeft.set(l, i);
  });
  const rights = new Set(q.pairs.map((p) => normaliseLoose(p.right)));
  const seenDistractor = new Set<string>();
  (q.distractors ?? []).forEach((d, i) => {
    const key = normaliseLoose(d);
    if (key === "") {
      issues.push({ path: ["distractors", i], message: `Distractor ${i + 1} is blank.` });
    } else if (rights.has(key)) {
      issues.push({
        path: ["distractors", i],
        message: `Distractor "${d}" is the same as a right item in pairs. A distractor must be a wrong answer for every left item.`,
      });
    } else if (seenDistractor.has(key)) {
      issues.push({ path: ["distractors", i], message: `Distractor "${d}" is listed twice.` });
    }
    seenDistractor.add(key);
  });
  return issues;
}

function fillBlankIssues(q: {
  text: string;
  blanks: Array<{ answers: string[]; strict?: boolean; allowTypos?: boolean }>;
}): Issue[] {
  const issues: Issue[] = [];
  const found = [...q.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  if (found.length === 0) {
    issues.push({
      path: ["text"],
      message:
        "The text has no blank. Mark each gap as {{1}}, {{2}}, ... and give one entry in blanks for each, in the same order.",
    });
  }
  const counts = new Map<number, number>();
  for (const n of found) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const [n, times] of counts) {
    if (n < 1 || n > q.blanks.length) {
      issues.push({
        path: ["text"],
        message: `The text has {{${n}}} but blanks has ${q.blanks.length} ${q.blanks.length === 1 ? "entry" : "entries"}. The text may only use {{1}} to {{${q.blanks.length}}}.`,
      });
    } else if (times > 1) {
      issues.push({
        path: ["text"],
        message: `{{${n}}} appears ${times} times; each blank marker may appear once.`,
      });
    }
  }
  q.blanks.forEach((b, i) => {
    if (found.length > 0 && !counts.has(i + 1)) {
      issues.push({
        path: ["blanks", i],
        message: `blanks[${i}] has accepted answers but the text has no {{${i + 1}}}. The blank count must match: ${found.length} marker(s) in the text, ${q.blanks.length} in blanks.`,
      });
    }
    const seen = new Set<string>();
    b.answers.forEach((a, j) => {
      const key = normaliseLoose(a);
      if (key === "") {
        issues.push({
          path: ["blanks", i, "answers", j],
          message: `Answer "${a}" has no letters or digits.`,
        });
      } else if (seen.has(key)) {
        issues.push({
          path: ["blanks", i, "answers", j],
          message: `Answer "${a}" repeats an earlier answer for this blank (case and punctuation are ignored).`,
        });
      }
      seen.add(key);
    });
    if (b.strict && b.allowTypos) {
      issues.push({
        path: ["blanks", i],
        message:
          "A blank cannot be both strict and allowTypos: strict means the answer must match exactly.",
      });
    } else if (b.allowTypos) {
      const usable = b.answers.some((a) => {
        const n = normaliseLoose(a);
        return n.length >= 6 && !/\d/.test(n);
      });
      if (!usable) {
        issues.push({
          path: ["blanks", i, "allowTypos"],
          message:
            "allowTypos does nothing here: typo tolerance applies only to answers of 6 or more characters that contain no digits. Remove allowTypos or list a suitable answer.",
        });
      }
    }
  });
  return issues;
}

interface CalcLike {
  prompt: string;
  explanation?: string;
  answer: CalcAnswer;
  units: string[];
  tolerance?: { mode: "relative"; percent: number } | { mode: "absolute"; amount: number };
  rounding?: unknown;
  allowFractions?: boolean;
}

function describeCombo(combo: Record<string, number>): string {
  return Object.keys(combo)
    .sort()
    .map((k) => `${k} = ${formatNumber(combo[k] as number)}`)
    .join(", ");
}

function calculationIssues(q: CalcLike, deep: boolean): Issue[] {
  const issues: Issue[] = [];

  // Units: all in the table, all measuring the same thing, all the same size.
  const parsed = q.units.map((u) => parseUnit(u));
  parsed.forEach((p, i) => {
    if (!p) {
      issues.push({
        path: ["units", i],
        message: `Unit "${q.units[i]}" is not in the supported table. ${SUPPORTED_UNITS_HELP}`,
      });
    }
  });
  const first = parsed[0];
  if (first) {
    parsed.forEach((p, i) => {
      if (i === 0 || !p) return;
      if (!sameDimension(first, p)) {
        issues.push({
          path: ["units", i],
          message: `Unit "${q.units[i]}" measures something different from "${q.units[0]}". units lists equivalent spellings of ONE unit (for example ["mg", "milligram"]).`,
        });
      } else if (!equivalentUnits(first, p)) {
        issues.push({
          path: ["units", i],
          message: `Unit "${q.units[i]}" is a different size from "${q.units[0]}". units lists equivalent spellings only, for example ["mg", "milligram"]; a student who answers in another size is converted automatically.`,
        });
      }
    });
  }

  const roundingOn = q.rounding !== undefined;
  const tol = q.tolerance ?? { mode: "relative" as const, percent: 1 };
  const tolIsZero = tol.mode === "relative" ? tol.percent === 0 : tol.amount === 0;

  if (roundingOn && q.allowFractions) {
    issues.push({
      path: ["allowFractions"],
      message:
        "allowFractions cannot be combined with a rounding instruction: a fraction has no decimal places to round. Remove one of them.",
    });
  }

  const answer = q.answer;
  const promptNames = placeholdersIn(q.prompt);
  const explanationNames = placeholdersIn(q.explanation ?? "");

  if (answer.kind === "fixed") {
    if (promptNames.length > 0) {
      issues.push({
        path: ["prompt"],
        message: `The prompt uses {${promptNames[0]}} but answer.kind is "fixed" and has no variables. Use answer.kind "expression" with variables, or write the number into the prompt.`,
      });
    }
    if (answer.value === 0 && tol.mode === "relative") {
      issues.push({
        path: ["tolerance"],
        message:
          'The answer is 0 and tolerance is relative, which would accept only exactly 0. Use an absolute tolerance, for example { mode: "absolute", amount: 0.01 }.',
      });
    }
    if (tolIsZero && !roundingOn && !Number.isInteger(answer.value)) {
      issues.push({
        path: ["tolerance"],
        message: `Tolerance 0 would accept only the exact value ${formatNumber(answer.value)}, which nobody can type exactly. Allow some tolerance (the default is 1% relative) or add a rounding instruction.`,
      });
    }
    return issues;
  }

  // Parameterised.
  const names = Object.keys(answer.variables);
  if (names.length === 0) {
    issues.push({
      path: ["answer", "variables"],
      message:
        'An "expression" answer needs at least one variable. For a single fixed number use { kind: "fixed", value }.',
    });
  }
  if (names.length > MAX_VARIABLES) {
    issues.push({
      path: ["answer", "variables"],
      message: `At most ${MAX_VARIABLES} variables are allowed; ${names.length} given.`,
    });
  }
  for (const name of names) {
    const spec = answer.variables[name] as VariableSpec;
    if (!VARIABLE_NAME.test(name)) {
      issues.push({
        path: ["answer", "variables", name],
        message: `Variable name "${name}" is invalid. Names start with a lower-case letter and use letters, digits and underscores (max 24), like weightKg.`,
      });
    } else if (RESERVED_NAMES.has(name)) {
      issues.push({
        path: ["answer", "variables", name],
        message: `"${name}" is reserved (a function, constant or placeholder). Pick another variable name.`,
      });
    }
    if (spec.kind === "range") {
      if (spec.max < spec.min) {
        issues.push({
          path: ["answer", "variables", name],
          message: `Variable ${name}: max (${spec.max}) is less than min (${spec.min}).`,
        });
      } else if (valueCount(spec) > MAX_VARIABLE_VALUES) {
        issues.push({
          path: ["answer", "variables", name, "step"],
          message: `Variable ${name} has ${valueCount(spec)} possible values; at most ${MAX_VARIABLE_VALUES}. Use a larger step.`,
        });
      }
    } else if (new Set(spec.values).size !== spec.values.length) {
      issues.push({
        path: ["answer", "variables", name, "values"],
        message: `Variable ${name} lists the same number twice.`,
      });
    }
  }

  let used: string[] = [];
  let syntaxOk = true;
  try {
    used = expressionVariables(answer.expression);
  } catch (e) {
    syntaxOk = false;
    const where =
      e instanceof ExpressionError && e.position !== undefined
        ? ` (at character ${e.position + 1})`
        : "";
    issues.push({
      path: ["answer", "expression"],
      message: `The expression cannot be read${where}: ${(e as Error).message} Use numbers, variables, + - * / ^, parentheses and the functions min, max, round, ceil, floor, sqrt, ln, log10, exp.`,
    });
  }
  if (syntaxOk) {
    for (const v of used) {
      if (!Object.hasOwn(answer.variables, v)) {
        issues.push({
          path: ["answer", "expression"],
          message: `The expression uses "${v}" but no variable of that name is declared. Declared: ${names.join(", ") || "(none)"}. Add it to answer.variables or fix the spelling.`,
        });
      }
    }
    for (const n of names) {
      if (!used.includes(n)) {
        issues.push({
          path: ["answer", "variables", n],
          message: `Variable "${n}" is declared but never used in the expression. Remove it or use it.`,
        });
      }
    }
  }
  for (const n of names) {
    if (!promptNames.includes(n)) {
      issues.push({
        path: ["prompt"],
        message: `Variable "${n}" is not shown in the prompt, so the student could not know its value. Write {${n}} where the number belongs.`,
      });
    }
  }
  for (const n of promptNames) {
    if (!names.includes(n)) {
      issues.push({
        path: ["prompt"],
        message: `The prompt uses {${n}} but there is no variable named "${n}". Declared: ${names.join(", ") || "(none)"}.`,
      });
    }
  }
  for (const n of explanationNames) {
    if (!names.includes(n) && n !== "answer") {
      issues.push({
        path: ["explanation"],
        message: `The explanation uses {${n}} but there is no variable named "${n}". Only the variables and {answer} can be used.`,
      });
    }
  }

  // Deep: try the expression over the whole range.
  if (deep && syntaxOk && issues.length === 0) {
    const rng = makeRng(12345);
    let nonInteger: Record<string, number> | null = null;
    let zero: Record<string, number> | null = null;
    for (const combo of sampleCombinations(answer.variables, rng)) {
      try {
        const v = answerValue(answer, combo);
        if (!Number.isInteger(v) && !nonInteger) nonInteger = combo;
        if (v === 0 && !zero) zero = combo;
      } catch (e) {
        issues.push({
          path: ["answer", "expression"],
          message: `The expression fails for some values in range: ${(e as Error).message.replace(/\.$/, "")} when ${describeCombo(combo)}. Narrow the ranges or change the expression so it is defined for every combination.`,
        });
        return issues;
      }
    }
    if (zero && tol.mode === "relative") {
      issues.push({
        path: ["tolerance"],
        message: `The answer is exactly 0 when ${describeCombo(zero)}, and a relative tolerance would then accept only exactly 0. Use an absolute tolerance.`,
      });
    }
    if (nonInteger && tolIsZero && !roundingOn) {
      issues.push({
        path: ["tolerance"],
        message: `Tolerance 0 would accept only the exact value, but the answer is not a whole number when ${describeCombo(nonInteger)}. Allow some tolerance (default 1% relative) or add a rounding instruction.`,
      });
    }
  }
  return issues;
}

function flashcardIssues(q: { front: string; back: string }): Issue[] {
  return normaliseLoose(q.front) === normaliseLoose(q.back)
    ? [
        {
          path: ["back"],
          message: "The back of the card is the same as the front. Put the answer on the back.",
        },
      ]
    : [];
}

function freeResponseIssues(q: { rubric: Array<{ point: string; points: number }> }): Issue[] {
  const seen = new Map<string, number>();
  const issues: Issue[] = [];
  q.rubric.forEach((r, i) => {
    const key = normaliseLoose(r.point);
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push({
        path: ["rubric", i, "point"],
        message: `Key point ${i + 1} repeats key point ${earlier + 1}.`,
      });
    } else seen.set(key, i);
  });
  return issues;
}

/** A question "core": everything specific to a type, plus its own text fields. */
export interface CoreLike {
  type: string;
  [key: string]: unknown;
}

/**
 * Rule problems for one question core (a question body or one part of a case).
 * `deep` also tries calculation expressions over their whole range.
 */
export function coreIssues(core: CoreLike, deep = false): Issue[] {
  const issues: Issue[] = [
    ...markdownIssues(core.prompt, ["prompt"]),
    ...markdownIssues(core.explanation, ["explanation"]),
    ...markdownIssues(core.vignette, ["vignette"]),
    ...markdownIssues(core.front, ["front"]),
    ...markdownIssues(core.back, ["back"]),
  ];
  switch (core.type) {
    case "multiple_choice":
      issues.push(...multipleChoiceIssues(core as never));
      break;
    case "select_all":
      issues.push(...selectAllIssues(core as never));
      break;
    case "matching":
      issues.push(...matchingIssues(core as never));
      break;
    case "fill_blank":
      issues.push(...fillBlankIssues(core as never));
      break;
    case "calculation":
      issues.push(...calculationIssues(core as never, deep));
      break;
    case "flashcard":
      issues.push(...flashcardIssues(core as never));
      break;
    case "free_response":
      issues.push(...freeResponseIssues(core as never));
      break;
    case "case": {
      const parts = (core.questions as CoreLike[] | undefined) ?? [];
      parts.forEach((part, i) => {
        for (const issue of coreIssues(part, deep)) {
          issues.push({
            path: ["questions", i, ...issue.path],
            message: `Sub-question ${i + 1}: ${issue.message}`,
          });
        }
      });
      break;
    }
  }
  return issues;
}
