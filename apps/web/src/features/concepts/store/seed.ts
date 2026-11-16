import type {
  BrandGenericPair,
  Citation,
  Concept,
  ConceptType,
  Inline,
  InteractionSeverity,
  MentionedIn,
  QuestionLink,
  Relation,
  RelationType,
} from "@notes/schema";

/**
 * An invented but realistic dataset for the demo, tests and screenshots: two courses
 * (Cardiovascular Pharmacology and Pharmacotherapy II), beta blockers, ACE inhibitors and ARBs,
 * adverse effects and interactions. Clinical statements are generic textbook facts.
 */

const pad = (n: number) => `${"0".repeat(22)}${String(n).padStart(4, "0")}`;
export const conceptId = (n: number) => `con_${pad(n)}`;
const relationId = (n: number) => `rel_${pad(n)}`;
const fileId = (n: number) => `fil_${pad(n)}`;
const pageId = (n: number) => `pag_${pad(n)}`;

export const COURSES = {
  pharmacology: "PHRM 5301 Cardiovascular Pharmacology",
  therapy: "PHRM 5410 Pharmacotherapy II",
} as const;

export const FILES: Record<string, { id: string; name: string }> = {
  bb: { id: fileId(1), name: "Beta blockers lecture 7.pdf" },
  ace: { id: fileId(2), name: "ACE inhibitors and ARBs.pdf" },
  htn: { id: fileId(3), name: "Hypertension therapy handout.pdf" },
};

interface CiteDef {
  file: keyof typeof FILES;
  page: number;
  quote: string;
  label: string;
}

const CITE_DEFS = {
  bbMech: {
    file: "bb",
    page: 4,
    quote: "Beta blockers competitively antagonise catecholamines at beta-adrenergic receptors.",
    label: "Slide 4",
  },
  b1: {
    file: "bb",
    page: 6,
    quote: "Metoprolol, atenolol and bisoprolol are cardioselective at usual doses.",
    label: "Slide 6",
  },
  nonsel: {
    file: "bb",
    page: 7,
    quote: "Propranolol blocks beta-1 and beta-2 receptors, so bronchospasm is a risk.",
    label: "Slide 7",
  },
  brady: {
    file: "bb",
    page: 9,
    quote: "Bradycardia and AV block follow reduced sinoatrial and AV node conduction.",
    label: "Slide 9",
  },
  mask: {
    file: "bb",
    page: 11,
    quote: "Tachycardia and tremor of hypoglycaemia may be blunted; sweating is preserved.",
    label: "Slide 11",
  },
  hf: {
    file: "bb",
    page: 13,
    quote: "Carvedilol, metoprolol succinate and bisoprolol reduce mortality in heart failure.",
    label: "Slide 13",
  },
  vera: {
    file: "bb",
    page: 15,
    quote: "Verapamil with a beta blocker adds to AV block and bradycardia.",
    label: "Slide 15",
  },
  aceMech: {
    file: "ace",
    page: 2,
    quote: "ACE inhibitors block conversion of angiotensin I to angiotensin II.",
    label: "Slide 2",
  },
  cough: {
    file: "ace",
    page: 5,
    quote: "Dry cough affects up to one in five patients, from bradykinin accumulation.",
    label: "Slide 5",
  },
  angio: {
    file: "ace",
    page: 6,
    quote: "Angioedema is rare but can threaten the airway; stop the drug at once.",
    label: "Slide 6",
  },
  preg: {
    file: "ace",
    page: 8,
    quote: "ACE inhibitors and ARBs are contraindicated in pregnancy (fetal renal injury).",
    label: "Slide 8",
  },
  k: {
    file: "ace",
    page: 10,
    quote: "Check potassium and creatinine one to two weeks after starting or titrating.",
    label: "Slide 10",
  },
  arb: {
    file: "ace",
    page: 12,
    quote: "ARBs block the AT1 receptor and rarely cause cough.",
    label: "Slide 12",
  },
  nsaid: {
    file: "htn",
    page: 3,
    quote:
      "NSAIDs blunt the antihypertensive effect of ACE inhibitors and raise the risk of kidney injury.",
    label: "Handout p. 3",
  },
  kk: {
    file: "htn",
    page: 4,
    quote: "Do not combine an ACE inhibitor with spironolactone without potassium monitoring.",
    label: "Handout p. 4",
  },
  first: {
    file: "htn",
    page: 2,
    quote: "ACE inhibitors, ARBs, thiazides and calcium channel blockers are first-line options.",
    label: "Handout p. 2",
  },
} satisfies Record<string, CiteDef>;
type CiteKey = keyof typeof CITE_DEFS;

export function citation(key: CiteKey): Citation {
  const def: CiteDef = CITE_DEFS[key];
  return {
    fileId: FILES[def.file]?.id as string,
    pageId: pageId(Object.keys(FILES).indexOf(def.file) * 100 + def.page),
    quote: def.quote,
    label: def.label,
  };
}
export const PAGE_NUMBER = (c: Citation) => Number(c.pageId.slice(-2)) || 1;
export const FILE_NAME = (id: string) =>
  Object.values(FILES).find((f) => f.id === id)?.name ?? null;

type Opts = {
  aliases?: string[];
  generic?: string;
  brands?: string[];
  summary?: string;
  cite?: CiteKey[];
  gk?: boolean;
  reviewed?: boolean;
  nameCheck?: "matched" | "suggestion" | "unchecked";
  suggested?: string;
};

interface ConceptDef extends Opts {
  key: string;
  type: ConceptType;
  name: string;
}

const defs: ConceptDef[] = [];
const def = (key: string, type: ConceptType, name: string, opts: Opts = {}) =>
  defs.push({ key, type, name, ...opts });

// classes
def("bb", "drug_class", "Beta blockers", {
  aliases: ["beta-adrenergic antagonists", "BB"],
  summary:
    "Drugs ending in -olol that block beta-adrenergic receptors. Used for [[hypertension]], [[angina]], [[heart failure]] and rate control.^1",
  cite: ["bbMech"],
});
def("bb1", "drug_class", "Cardioselective beta blockers", {
  aliases: ["beta-1 selective blockers"],
  summary:
    "Beta blockers that favour beta-1 receptors at usual doses; selectivity is lost at high doses.^1",
  cite: ["b1"],
});
def("bbn", "drug_class", "Nonselective beta blockers", {
  summary: "Block beta-1 and beta-2 receptors, so they can narrow the airways.^1",
  cite: ["nonsel"],
});
def("acei", "drug_class", "ACE inhibitors", {
  aliases: ["ACEi", "angiotensin-converting enzyme inhibitors"],
  summary:
    "Drugs ending in -pril. Lower angiotensin II and raise bradykinin, which explains their benefit and their cough.^1",
  cite: ["aceMech"],
});
def("arb", "drug_class", "Angiotensin II receptor blockers", {
  aliases: ["ARBs", "sartans"],
  summary:
    "Drugs ending in -sartan that block the AT1 receptor; an alternative when an ACE inhibitor causes cough.^1",
  cite: ["arb"],
});
def("ksd", "drug_class", "Potassium-sparing diuretics", {
  summary: "Diuretics that retain potassium, so they raise the risk of [[hyperkalaemia]].",
  gk: true,
});
def("ccb", "drug_class", "Non-dihydropyridine calcium channel blockers", {
  aliases: ["non-DHP CCBs"],
  summary: "Verapamil and diltiazem slow AV node conduction as well as relaxing vessels.",
  gk: true,
});
def("nsaid", "drug_class", "NSAIDs", {
  aliases: ["non-steroidal anti-inflammatory drugs"],
  summary:
    "Cyclo-oxygenase inhibitors that cause sodium and water retention and can reduce kidney perfusion.",
  gk: true,
});

// drugs
const drug = (key: string, name: string, brands: string[], opts: Opts = {}) =>
  def(key, "drug", name, { generic: name, brands, nameCheck: "unchecked", ...opts });
drug("metoprolol", "Metoprolol", ["Lopressor"], {
  aliases: ["metoprolol tartrate"],
  summary:
    "Cardioselective beta blocker given twice daily as the tartrate. Used for [[hypertension]], [[angina]] and after [[myocardial infarction]].^1",
  cite: ["b1"],
  reviewed: true,
  nameCheck: "matched",
});
drug("metoprololS", "Metoprolol succinate", ["Toprol-XL"], {
  summary:
    "Extended-release metoprolol, given once daily; has outcome data in [[heart failure]].^1",
  cite: ["hf"],
});
drug("atenolol", "Atenolol", ["Tenormin"], {
  summary:
    "Cardioselective beta blocker that is water soluble and cleared by the kidney, so doses fall in renal impairment.",
  cite: ["b1"],
  nameCheck: "matched",
});
drug("bisoprolol", "Bisoprolol", ["Zebeta"], {
  summary: "Highly cardioselective beta blocker with outcome data in [[heart failure]].^1",
  cite: ["hf"],
});
drug("propranolol", "Propranolol", ["Inderal"], {
  summary: "Lipophilic nonselective beta blocker that crosses the blood-brain barrier.^1",
  cite: ["nonsel"],
  nameCheck: "matched",
});
drug("carvedilol", "Carvedilol", ["Coreg"], {
  summary:
    "Nonselective beta blocker with additional alpha-1 blockade, used in [[heart failure]].^1",
  cite: ["hf"],
});
drug("lisinopril", "Lisinopril", ["Prinivil", "Zestril"], {
  summary:
    "ACE inhibitor that is not a prodrug and is excreted unchanged by the kidney. Once-daily dosing for [[hypertension]] and [[heart failure]].",
  gk: true,
  nameCheck: "matched",
});
drug("enalapril", "Enalapril", ["Vasotec"], {
  summary: "Prodrug ACE inhibitor converted to enalaprilat in the liver.",
  gk: true,
});
drug("ramipril", "Ramipril", ["Altace"], {
  summary: "ACE inhibitor with outcome data after [[myocardial infarction]].",
  gk: true,
});
drug("losartan", "Losartan", ["Cozaar"], {
  summary: "ARB used for [[hypertension]] and diabetic nephropathy; rarely causes cough.^1",
  cite: ["arb"],
});
drug("spironolactone", "Spironolactone", ["Aldactone"], {
  summary: "Aldosterone antagonist that retains potassium.",
  gk: true,
});
drug("verapamil", "Verapamil HCl", ["Calan"], {
  aliases: ["verapamil"],
  summary: "Non-dihydropyridine calcium channel blocker that slows AV node conduction.^1",
  cite: ["vera"],
  nameCheck: "suggestion",
  suggested: "verapamil hydrochloride",
});
drug("ibuprofen", "Ibuprofen", ["Advil", "Motrin"], {
  summary: "Over-the-counter NSAID.",
  gk: true,
});

// mechanisms and targets
def("mb1", "mechanism", "Beta-1 receptor antagonism", {
  summary: "Less heart rate, contractility and renin release.^1",
  cite: ["bbMech"],
});
def("mb12", "mechanism", "Nonselective beta receptor antagonism", {
  summary: "Beta-1 effects plus bronchial and vascular beta-2 blockade.^1",
  cite: ["nonsel"],
});
def("mace", "mechanism", "ACE inhibition", {
  summary: "Less angiotensin II, more bradykinin.^1",
  cite: ["aceMech"],
});
def("mat1", "mechanism", "AT1 receptor blockade", {
  summary: "Blocks angiotensin II at its receptor without raising bradykinin.^1",
  cite: ["arb"],
});
def("mmr", "mechanism", "Aldosterone receptor antagonism", {
  summary: "Blocks aldosterone in the distal tubule.",
  gk: true,
});
def("tb1", "target", "Beta-1 adrenergic receptor", {
  gk: true,
  summary: "Found mainly in the heart and the kidney's juxtaglomerular cells.",
});
def("tb2", "target", "Beta-2 adrenergic receptor", {
  gk: true,
  summary: "Found in bronchial and vascular smooth muscle.",
});
def("tace", "target", "Angiotensin-converting enzyme", { aliases: ["ACE"], gk: true });
def("tat1", "target", "AT1 receptor", { aliases: ["angiotensin II type 1 receptor"], gk: true });
def("tmr", "target", "Mineralocorticoid receptor", { gk: true });

// indications
def("htn", "indication", "Hypertension", {
  aliases: ["high blood pressure"],
  summary:
    "First-line options include ACE inhibitors, ARBs, thiazides and calcium channel blockers.^1",
  cite: ["first"],
});
def("hf", "indication", "Heart failure", {
  aliases: ["HFrEF"],
  summary: "Some beta blockers and ACE inhibitors reduce mortality.^1",
  cite: ["hf"],
});
def("angina", "indication", "Angina", { gk: true });
def("mi", "indication", "Myocardial infarction", { aliases: ["MI", "heart attack"], gk: true });
def("afib", "indication", "Atrial fibrillation rate control", { gk: true });

// adverse effects
def("brady", "adverse_effect", "Bradycardia", {
  summary: "A slow heart rate from reduced sinoatrial node firing.^1",
  cite: ["brady"],
});
def("bronch", "adverse_effect", "Bronchospasm", {
  summary: "Airway narrowing from beta-2 blockade.^1",
  cite: ["nonsel"],
});
def("mask", "adverse_effect", "Masked hypoglycaemia symptoms", {
  summary: "Tremor and palpitations are blunted; sweating remains.^1",
  cite: ["mask"],
});
def("cough", "adverse_effect", "Dry cough", {
  summary: "Persistent and non-productive; resolves after stopping.^1",
  cite: ["cough"],
});
def("angio", "adverse_effect", "Angioedema", {
  summary: "Swelling of lips, tongue or throat.^1",
  cite: ["angio"],
});
def("hyperk", "adverse_effect", "Hyperkalaemia", { aliases: ["high potassium"], gk: true });
def("hypot", "adverse_effect", "Hypotension", { gk: true });

// contraindications
def("avb", "contraindication", "Second- or third-degree AV block", { gk: true });
def("asthma", "contraindication", "Asthma", { gk: true });
def("pregnancy", "contraindication", "Pregnancy", {
  summary: "Fetal renal injury with drugs acting on the renin-angiotensin system.^1",
  cite: ["preg"],
});
def("hxangio", "contraindication", "History of angioedema", { gk: true });
def("rasn", "contraindication", "Bilateral renal artery stenosis", { gk: true });

// monitoring, interaction
def("hr", "monitoring_parameter", "Heart rate", { gk: true });
def("bp", "monitoring_parameter", "Blood pressure", { gk: true });
def("potassium", "monitoring_parameter", "Serum potassium", {
  summary: "Check one to two weeks after starting or changing the dose.^1",
  cite: ["k"],
});
def("creat", "monitoring_parameter", "Serum creatinine", {
  summary: "Accept a rise of up to 30 percent; more means review.^1",
  cite: ["k"],
});
def("cyp", "interaction", "CYP2D6 inhibition", {
  gk: true,
  summary: "Strong inhibitors raise metoprolol exposure several-fold.",
});

export const KEY: Record<string, string> = {};
defs.forEach((d, i) => {
  KEY[d.key] = conceptId(i + 1);
});
const idOf = (k: string) => KEY[k] as string;

const AGENT = { type: "agent" as const, keyId: `key_${pad(1)}`, label: "Study agent" };
const USER = { type: "user" as const, userId: `usr_${pad(1)}` };
const AT = "2026-11-02T14:00:00.000Z";

function rich(text: string, cites: Citation[]): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(/(\[\[.+?\]\]|\^\d)/)) {
    if (!part) continue;
    const mention = part.match(/^\[\[(.+)\]\]$/);
    if (mention) {
      const name = mention[1] as string;
      const target = defs.find((d) => d.name.toLowerCase() === name.toLowerCase());
      out.push(target ? { concept: idOf(target.key), text: name } : { text: name });
    } else if (/^\^\d$/.test(part) && cites.length > 0) out.push({ cite: Number(part.slice(1)) });
    else out.push({ text: part });
  }
  return out;
}

export const CONCEPTS: Concept[] = defs.map((d) => {
  const cites = (d.cite ?? []).map(citation);
  const isDrug = d.type === "drug";
  return {
    id: idOf(d.key),
    type: d.type,
    name: d.name,
    aliases: d.aliases ?? [],
    drug: isDrug
      ? {
          genericName: d.generic ?? null,
          brandNames: d.brands ?? [],
          rxcui: d.nameCheck === "matched" ? "6918" : null,
          nameCheck:
            d.nameCheck === "matched"
              ? { status: "matched", checkedAt: AT, rxcui: "6918" }
              : d.nameCheck === "suggestion"
                ? { status: "suggestion", checkedAt: AT, suggested: d.suggested as string }
                : { status: "unchecked" },
        }
      : null,
    summary: rich(d.summary ?? "", cites),
    citations: cites,
    generalKnowledge: d.gk === true || cites.length === 0,
    reviewStatus: d.reviewed ? "reviewed" : "unverified",
    origin: d.reviewed ? "user" : "agent",
    provenance: {
      createdBy: AGENT,
      createdAt: AT,
      lastEditedBy: d.reviewed ? USER : AGENT,
      lastEditedAt: AT,
    },
  } satisfies Concept;
});

interface RelOpts {
  cite?: CiteKey[];
  note?: string;
  sev?: InteractionSeverity;
  effect?: string;
}
const relDefs: Array<{ from: string; type: RelationType; to: string } & RelOpts> = [];
const rel = (from: string, type: RelationType, to: string, o: RelOpts = {}) =>
  relDefs.push({ from, type, to, ...o });

rel("bb1", "belongs_to_class", "bb", { cite: ["b1"] });
rel("bbn", "belongs_to_class", "bb", { cite: ["nonsel"] });
for (const d of ["metoprolol", "metoprololS", "atenolol", "bisoprolol"])
  rel(d, "belongs_to_class", "bb1", { cite: ["b1"] });
for (const d of ["propranolol", "carvedilol"])
  rel(d, "belongs_to_class", "bbn", { cite: ["nonsel"] });
for (const d of ["lisinopril", "enalapril", "ramipril"])
  rel(d, "belongs_to_class", "acei", { cite: ["aceMech"] });
rel("losartan", "belongs_to_class", "arb", { cite: ["arb"] });
rel("spironolactone", "belongs_to_class", "ksd");
rel("verapamil", "belongs_to_class", "ccb", { cite: ["vera"] });
rel("ibuprofen", "belongs_to_class", "nsaid");

rel("bb1", "has_mechanism", "mb1", { cite: ["bbMech"] });
rel("bbn", "has_mechanism", "mb12", { cite: ["nonsel"] });
rel("acei", "has_mechanism", "mace", { cite: ["aceMech"] });
rel("arb", "has_mechanism", "mat1", { cite: ["arb"] });
rel("ksd", "has_mechanism", "mmr");
rel("mb1", "acts_on", "tb1", { cite: ["bbMech"] });
rel("mb12", "acts_on", "tb1", { cite: ["nonsel"] });
rel("mb12", "acts_on", "tb2", { cite: ["nonsel"] });
rel("mace", "acts_on", "tace", { cite: ["aceMech"] });
rel("mat1", "acts_on", "tat1", { cite: ["arb"] });
rel("mmr", "acts_on", "tmr");

rel("bb", "treats", "htn", { cite: ["first"] });
rel("bb", "treats", "angina");
rel("bb", "treats", "mi");
rel("bisoprolol", "treats", "hf", { cite: ["hf"] });
rel("carvedilol", "treats", "hf", { cite: ["hf"] });
rel("metoprololS", "treats", "hf", { cite: ["hf"] });
rel("metoprolol", "treats", "afib");
rel("acei", "treats", "htn", { cite: ["first"] });
rel("acei", "treats", "hf");
rel("ramipril", "treats", "mi");
rel("arb", "treats", "htn", { cite: ["first"] });
rel("spironolactone", "treats", "hf");
rel("verapamil", "treats", "afib");
rel("verapamil", "treats", "angina");

rel("bb", "causes_adverse_effect", "brady", { cite: ["brady"] });
rel("bb", "causes_adverse_effect", "hypot");
rel("bb", "causes_adverse_effect", "mask", { cite: ["mask"] });
rel("bbn", "causes_adverse_effect", "bronch", { cite: ["nonsel"] });
rel("verapamil", "causes_adverse_effect", "brady", { cite: ["vera"] });
rel("verapamil", "causes_adverse_effect", "hypot");
rel("acei", "causes_adverse_effect", "cough", { cite: ["cough"] });
rel("acei", "causes_adverse_effect", "angio", { cite: ["angio"] });
rel("acei", "causes_adverse_effect", "hyperk", { cite: ["k"] });
rel("acei", "causes_adverse_effect", "hypot");
rel("arb", "causes_adverse_effect", "hyperk", { cite: ["k"] });
rel("ksd", "causes_adverse_effect", "hyperk");

rel("bb", "contraindicated_in", "avb");
rel("verapamil", "contraindicated_in", "avb");
rel("bbn", "contraindicated_in", "asthma", { cite: ["nonsel"] });
rel("acei", "contraindicated_in", "pregnancy", { cite: ["preg"] });
rel("arb", "contraindicated_in", "pregnancy", { cite: ["preg"] });
rel("acei", "contraindicated_in", "hxangio", { cite: ["angio"] });
rel("acei", "contraindicated_in", "rasn");
rel("arb", "contraindicated_in", "rasn");

rel("bb", "monitored_by", "hr");
rel("bb", "monitored_by", "bp");
rel("acei", "monitored_by", "potassium", { cite: ["k"] });
rel("acei", "monitored_by", "creat", { cite: ["k"] });
rel("arb", "monitored_by", "potassium", { cite: ["k"] });
rel("arb", "monitored_by", "creat", { cite: ["k"] });
rel("ksd", "monitored_by", "potassium");

rel("propranolol", "interacts_with", "verapamil", {
  cite: ["vera"],
  sev: "major",
  effect: "Additive bradycardia and AV block; avoid the combination or monitor closely.",
});
rel("bb", "interacts_with", "ccb", {
  cite: ["vera"],
  sev: "major",
  effect: "Additive AV block and bradycardia.",
});
rel("acei", "interacts_with", "ksd", {
  cite: ["kk"],
  sev: "major",
  effect: "Hyperkalaemia; check potassium within a week.",
});
rel("lisinopril", "interacts_with", "ibuprofen", {
  cite: ["nsaid"],
  sev: "moderate",
  effect: "Weaker blood pressure control and a higher risk of kidney injury.",
});
rel("acei", "interacts_with", "nsaid", {
  cite: ["nsaid"],
  sev: "moderate",
  effect: "Weaker blood pressure control and a higher risk of kidney injury.",
});
rel("metoprolol", "interacts_with", "cyp", {
  sev: "moderate",
  effect: "Strong CYP2D6 inhibitors raise metoprolol levels; expect a slower heart rate.",
});
rel("metoprolol", "related_to", "metoprololS", {
  note: "Same active ingredient, different release form.",
});
rel("metoprolol", "interacts_with", "verapamil", {
  cite: ["vera"],
  sev: "major",
  effect: "Additive bradycardia and AV block.",
});

export const RELATIONS: Relation[] = relDefs.map((r, i) => ({
  id: relationId(i + 1),
  from: idOf(r.from),
  to: idOf(r.to),
  type: r.type,
  note: r.note ?? "",
  interaction: r.sev ? { severity: r.sev, effect: r.effect as string } : null,
  citations: (r.cite ?? []).map(citation),
  generalKnowledge: (r.cite ?? []).length === 0,
  reviewStatus: "unverified",
  origin: "agent",
  provenance: { createdBy: AGENT, createdAt: AT, lastEditedBy: AGENT, lastEditedAt: AT },
}));

// ---- appears in -----------------------------------------------------------------------------

const DOCS = {
  bb: {
    documentId: `doc_${pad(1)}`,
    nodeId: `nod_${pad(11)}`,
    title: `Beta blockers lecture 7 (${COURSES.pharmacology})`,
  },
  ace: {
    documentId: `doc_${pad(2)}`,
    nodeId: `nod_${pad(12)}`,
    title: `ACE inhibitors and ARBs (${COURSES.pharmacology})`,
  },
  htn: {
    documentId: `doc_${pad(3)}`,
    nodeId: `nod_${pad(13)}`,
    title: `Hypertension case notes (${COURSES.therapy})`,
  },
};
const mention = (doc: keyof typeof DOCS, n: number, preview: string): MentionedIn => ({
  documentId: DOCS[doc].documentId,
  blockId: `blk_${pad(n)}`,
  nodeId: DOCS[doc].nodeId,
  title: DOCS[doc].title,
  preview,
  trashed: false,
});

export const MENTIONS: Record<string, MentionedIn[]> = {
  metoprolol: [
    mention("bb", 21, "Metoprolol tartrate 25 to 100 mg twice daily; the succinate is once daily."),
    mention("htn", 31, "Case 3: start metoprolol after the MI, titrate to a resting rate near 60."),
  ],
  bb: [mention("bb", 20, "Beta blockers: the -olol drugs, grouped by selectivity.")],
  acei: [
    mention("ace", 22, "ACE inhibitors: the -pril drugs and their shared adverse effects."),
    mention("htn", 32, "Case 1: stop the ACE inhibitor if cough interferes with sleep."),
  ],
  lisinopril: [
    mention(
      "ace",
      23,
      "Lisinopril is excreted unchanged: reduce the dose when creatinine clearance falls.",
    ),
  ],
  cough: [mention("ace", 24, "Dry cough: bradykinin; switch to an ARB.")],
  hyperk: [mention("htn", 33, "Potassium above 5.5: hold the ACE inhibitor and recheck.")],
  htn: [mention("htn", 30, "Hypertension: first-line drug classes and compelling indications.")],
};
export const QUESTIONS: Record<string, QuestionLink[]> = {
  cough: [
    {
      questionId: `qst_${pad(1)}`,
      stem: "A patient on lisinopril develops a persistent dry cough. What is the best next step?",
      nodeId: DOCS.ace.nodeId,
    },
  ],
  metoprolol: [
    {
      questionId: `qst_${pad(2)}`,
      stem: "Which beta blocker is cardioselective at usual doses?",
      nodeId: DOCS.bb.nodeId,
    },
  ],
  hyperk: [
    {
      questionId: `qst_${pad(3)}`,
      stem: "Which combination most raises the risk of hyperkalaemia?",
      nodeId: DOCS.htn.nodeId,
    },
  ],
};

export const SUGGESTIONS: Record<
  string,
  Array<{ other: string; reason: string; explanation: string }>
> = {
  metoprolol: [
    {
      other: "metoprololS",
      reason: "salt_variant",
      explanation:
        "Metoprolol succinate looks like another form of metoprolol; they can differ clinically, so a person decides.",
    },
  ],
};

export function brandPairs(): BrandGenericPair[] {
  const cls = (id: string): string | null => {
    const r = RELATIONS.find((x) => x.from === id && x.type === "belongs_to_class");
    return r ? (CONCEPTS.find((c) => c.id === r.to)?.name ?? null) : null;
  };
  return CONCEPTS.flatMap((c) =>
    c.drug
      ? c.drug.brandNames.map((brand) => ({
          conceptId: c.id,
          generic: c.name === "Verapamil HCl" ? "Verapamil" : c.name,
          brand,
          drugClass: cls(c.id),
          citations: [],
        }))
      : [],
  );
}
