// The notes she wrote herself, written through her signed-in session so they show as hers: in-class
// notes under three lectures, a cram sheet for Exam 3, a calculations cheat sheet, and her own lines
// inside the agent's beta blocker guide. Shared by `pnpm local:seed:pharm` (a step after the guides)
// and `pnpm local:seed:pharm:notes` (adds only these to an account that already has the set).
//
// Five documents, 83 blocks (20, 14, 15, 10, 24), every one of the 16 block types at least once,
// plus two blocks and one edit in the guide. Builders take the same
// helpers as the guides: `c` (a citation whose quote must be in that page's transcript), `page`,
// `hot` (a file's hotspot points) and `q` (a practice question's ID by key).
import {
  callout,
  checklist,
  cited,
  compare,
  divider,
  drugCard,
  h,
  image,
  labelledImage,
  mindMap,
  mnemonic,
  node,
  ol,
  p,
  question,
  quote,
  table,
  ul,
} from "./blocks.mjs";

/** The practice questions she drops into her notes, found by key in the seeder and by stem otherwise. */
export const PLACED_QUESTIONS = {
  "beta-hfref": {
    lecture: "beta",
    stem: "Which beta blocker has NOT been shown to lower mortality in HFrEF?",
  },
  "htn-case": {
    lecture: "htn",
    stem: "A 54-year-old Black man has blood pressures of 152/96 and 148/94 mm Hg",
  },
  "chol-op-case": {
    lecture: "chol",
    stem: "A 38-year-old farm worker is brought in after spraying an insecticide",
  },
};

const item = (text, indent = 0) => ({ text, indent });
const done = (text) => ({ text, checked: true });
const todo = (text) => ({ text, checked: false });
const code = (text) => ({ text, code: true });
const b = (text) => ({ text, bold: true });

// ---- 1. Beta blockers, lecture 10 ----------------------------------------------------------------------
function betaInClass({ c, page, q }) {
  const s3 = c("beta", 3, "Competitive antagonists at beta receptors");
  const s3b1 = c("beta", 3, "Beta-1 blockade: lower heart rate, contractility and AV conduction");
  const s3ren = c("beta", 3, "Less renin release from the kidney");
  const s3sp = c(
    "beta",
    3,
    "Because the antagonism is competitive, a large catecholamine surge can partly overcome it.",
  );
  const s4n = c("beta", 4, "Cardioselective does not mean cardiac-only.");
  const s4cs = c(
    "beta",
    4,
    "Beta-1 selective (cardioselective) | Atenolol, metoprolol, bisoprolol, esmolol | Selectivity is lost at high doses",
  );
  const s4ns = c(
    "beta",
    4,
    "Non-selective (beta-1 and beta-2) | Propranolol, nadolol, timolol | Avoid in asthma",
  );
  const s4mix = c(
    "beta",
    4,
    "Mixed alpha-1 and beta | Carvedilol, labetalol | Extra vasodilation from alpha-1 blockade",
  );
  const s5n = c(
    "beta",
    5,
    "Lipophilic agents reach the brain: vivid dreams and sleep disturbance are more common with propranolol.",
  );
  const s5esm = c("beta", 5, "Esmolol | Low | Red blood cell esterases | About 9 minutes");
  const s5nad = c("beta", 5, "Nadolol | Low | Renal | 20 to 24 h");
  const s6hf = c("beta", 6, "HFrEF: only bisoprolol, carvedilol and metoprolol succinate");
  const s6pro = c(
    "beta",
    6,
    "Propranolol: migraine prevention, essential tremor, symptoms of hyperthyroidism",
  );
  const s7bronch = c("beta", 7, "Bronchospasm in asthma, especially with non-selective agents");
  const s7brady = c("beta", 7, "Bradycardia, AV block, hypotension");
  const s8hb = c(
    "beta",
    8,
    "Severe bradycardia or second- or third-degree heart block without a pacemaker",
  );
  const s8asth = c(
    "beta",
    8,
    "Asthma: avoid non-selective agents; a cardioselective agent at low dose if one is needed",
  );
  const s9ver = c("beta", 9, "Verapamil or diltiazem: additive bradycardia and AV block");
  const s10pro = c("beta", 10, "Propranolol | 40 mg | Twice daily");
  const s11taper = c("beta", 11, "Do not stop suddenly: taper over 1 to 2 weeks");
  const s11food = c("beta", 11, "Take carvedilol with food to reduce dizziness");
  const s11rise = c("beta", 11, "Rise slowly from sitting or lying");
  const s11pulse = c("beta", 11, "Check your pulse; report a heart rate that stays below 50");
  const s12 = c(
    "beta",
    12,
    "Three are proven in HFrEF: bisoprolol, carvedilol, metoprolol succinate",
  );
  const n3 = c("hand", 3, "Q for office hrs: why is carvedilol target");

  return [
    p(
      "Lec 10, Tue 11/3. He went fast after slide 5, so the PK and dose slides are the ones to reread. Paper notes from today are filed with the lecture too.",
    ),
    h(2, "Slides 2-3: MOA"),
    ul(
      [
        item("Competitive antagonists at β receptors"),
        item("big catecholamine surge can partly push through the block", 1),
        item("β1 block → ↓ HR, ↓ contractility, slower AV conduction"),
        item("↓ renin from the kidney → BP drops more", 1),
        item("Net: ↓ CO, ↓ BP, ↓ myocardial O2 demand (why they help angina + post-MI)"),
      ],
      [s3, s3sp, s3b1, s3ren],
    ),
    h(2, "Slide 4: the classes"),
    table(
      [
        ["Class", "Drugs", "My note"],
        ["Non-selective (β1 + β2)", "propranolol, nadolol, timolol", "NOT in asthma"],
        [
          "β1-selective",
          "atenolol, metoprolol, bisoprolol, esmolol",
          "selectivity lost at high dose",
        ],
        ["β1 + NO vasodilation", "nebivolol", "the odd one"],
        ["α1 + β", "carvedilol, labetalol", "extra vasodilation, more dizziness"],
        ["ISA", "pindolol, acebutolol", "less resting bradycardia"],
      ],
      [s4ns, s4cs, s4mix],
    ),
    quote("Cardioselective does not mean cardiac-only.", "Prof, lecture 10, slide 4", [s4n]),
    callout(
      "warning",
      "ON THE EXAM (he said it twice)",
      [
        { text: "Which three β blockers lower mortality in HFrEF: " },
        b("bisoprolol, carvedilol, metoprolol succinate"),
        { text: ". Metoprolol " },
        b("tartrate"),
        { text: " is NOT one of them. And: never stop a β blocker abruptly." },
      ],
      [s6hf, s12, s11taper],
    ),
    mnemonic(
      "Be Careful, Sweetie",
      "The three β blockers proven in HFrEF",
      [
        ["Be", "Bisoprolol"],
        ["Careful", "Carvedilol"],
        ["Sweetie", "metoprolol Succinate (not tartrate!)"],
      ],
      "Mine. Sweetie = Succinate is the part I kept forgetting.",
    ),
    h(2, "Slide 5: PK"),
    ul(
      [
        item("Lipophilic → into the brain → vivid dreams, poor sleep (propranolol)"),
        item("Renal: atenolol, nadolol → accumulate in CKD"),
        item("nadolol t½ 20-24 h = longest on the slide", 1),
        item("Esmolol: RBC esterases, t½ ~9 min → IV drip only"),
      ],
      [s5n, s5nad, s5esm],
    ),
    image(
      page("hand", 2),
      "My handwritten notes, page 2: side effects, taper, esmolol and renal clearance",
      "My paper notes from class, p. 2",
    ),
    h(2, "Slides 6-9: uses, ADRs, CIs, DDIs"),
    drugCard(
      {
        name: "propranolol",
        brandNames: ["Inderal LA", "InnoPran XL"],
        drugClass: cited("Non-selective β blocker (β1 + β2)", [s4ns]),
        mechanism: "Competitive β1 and β2 antagonist; lipophilic, crosses the BBB",
        indications: [
          cited("Migraine prevention", [s6pro]),
          cited("Essential tremor", [s6pro]),
          cited("Hyperthyroid symptoms (tremor, palpitations)", [s6pro]),
          "HTN, but not first line",
        ],
        adverseEffects: [
          cited("Bronchospasm", [s7bronch]),
          cited("Vivid dreams, sleep problems", [s5n]),
          cited("Bradycardia, AV block, ↓ BP", [s7brady]),
        ],
        contraindications: [
          cited("Asthma", [s8asth]),
          cited("2nd or 3rd degree heart block w/o pacemaker", [s8hb]),
        ],
        interactions: [cited("Verapamil or diltiazem: too slow, AV block", [s9ver])],
        monitoring: ["HR", "BP", "wheeze in anyone with asthma or COPD"],
        counselling: [cited("Don't stop suddenly; taper 1-2 wk", [s11taper])],
        dosingNotes: [
          cited(
            "HTN start: 40 mg BID",
            [s10pro],
            [{ kind: "dose", quote: "40 mg BID", note: "Copied from slide 10 in class." }],
          ),
        ],
      },
      [],
      { style: { color: "teal" } },
    ),
    ol(
      [
        "Don't stop suddenly, taper over 1-2 wk",
        "Carvedilol with food (less dizzy)",
        "Get up slowly from sitting or lying",
        "Check pulse; call if it stays under 50",
      ],
      [s11taper, s11food, s11rise, s11pulse],
    ),
    divider(),
    h(3, "Ask in office hours"),
    checklist([
      todo("Why is the carvedilol target 50 mg BID if > 85 kg (vs 25 mg BID)?"),
      todo("Labetalol is non-selective at β: so is it also a no in asthma?"),
      todo("Nebivolol is β1-selective: why isn't it one of the HFrEF three?"),
      done("Does esmolol need a renal adjustment? (No: RBC esterases. TA answered.)"),
    ]),
    p("Copied the office hours question off my paper notes, p. 3.", [n3]),
    h(3, "Practice Q I got wrong"),
    question(q("beta-hfref")),
  ];
}

// ---- 2. Hypertension, Pharmacotherapy I lecture 8 ------------------------------------------------------
function htnInClass({ c, page, q }) {
  const s3st1 = c("htn", 3, "Stage 1 hypertension | 130 to 139 | or | 80 to 89");
  const s3st2 = c("htn", 3, "Stage 2 hypertension | 140 or higher | or | 90 or higher");
  const s3high = c(
    "htn",
    3,
    "When systolic and diastolic fall in different categories, use the higher category.",
  );
  const s3crisis = c("htn", 3, "A reading above 180/120 mm Hg is a hypertensive crisis.");
  const s4a = c("htn", 4, "Seated and resting for at least 5 minutes, back supported, feet flat");
  const s4b = c("htn", 4, "Arm supported at heart level, correct cuff size");
  const s4c = c("htn", 4, "No caffeine, exercise or smoking for 30 minutes before");
  const s4d = c("htn", 4, "Average at least 2 readings on at least 2 occasions");
  const s4e = c("htn", 4, "Confirm with home or ambulatory readings");
  const s5a = c(
    "htn",
    5,
    "Stage 1 with clinical ASCVD or a 10-year ASCVD risk of 10% or more: lifestyle plus a drug",
  );
  const s5b = c(
    "htn",
    5,
    "Stage 1 with a 10-year risk below 10%: lifestyle first, reassess in 3 to 6 months",
  );
  const s5c = c(
    "htn",
    5,
    "Start two first-line drugs of different classes if BP is more than 20/10 mm Hg above goal",
  );
  const s5goal = c("htn", 5, "Goal for most adults: below 130/80 mm Hg");
  const s7 = c("htn", 7, "Thiazide-type diuretics (chlorthalidone preferred)");
  const s7black = c(
    "htn",
    7,
    "Black adults without heart failure or CKD: start with a thiazide or a calcium channel blocker",
  );
  const s7never = c("htn", 7, "Never combine an ACE inhibitor with an ARB");
  const s7bb = c("htn", 7, "Beta blockers are not first line for uncomplicated hypertension.");
  const s9ace = c(
    "htn",
    9,
    "ACE inhibitor | Lisinopril, enalapril | Dry cough, high potassium, angioedema, rise in creatinine | Serum creatinine, potassium",
  );
  const s9arb = c(
    "htn",
    9,
    "ARB | Losartan, valsartan | High potassium, rise in creatinine; no cough | Serum creatinine, potassium",
  );
  const s11preg = c(
    "htn",
    11,
    "ACE inhibitors, ARBs and aliskiren are fetotoxic: avoid in pregnancy and counsel on contraception",
  );
  const s11scr = c(
    "htn",
    11,
    "A rise in serum creatinine of up to 30% after starting an ACE inhibitor or ARB is expected",
  );
  const board = c("board", 1, "Never ACEi + ARB together!");

  return [
    h(2, "Slide 3: BP categories (ACC/AHA 2017)"),
    table(
      [
        ["Category", "SBP", "", "DBP"],
        ["Normal", "< 120", "and", "< 80"],
        ["Elevated", "120-129", "and", "< 80"],
        ["Stage 1", "130-139", "or", "80-89"],
        ["Stage 2", "≥ 140", "or", "≥ 90"],
      ],
      [s3st1, s3st2],
      { caption: "Different categories for SBP and DBP: the higher one wins." },
    ),
    callout("tip", "Crisis", "> 180/120 = hypertensive crisis. Higher category wins on a split.", [
      s3crisis,
      s3high,
    ]),
    h(2, "Slide 4: measuring it right"),
    ol(
      [
        "Sit 5 min first, back supported, feet flat",
        "Arm at heart level, right cuff size",
        "No caffeine, exercise or smoking 30 min before",
        "Average ≥ 2 readings on ≥ 2 visits",
        "Confirm with home or ambulatory BP",
      ],
      [s4a, s4b, s4c, s4d, s4e],
    ),
    h(2, "Slide 5: when to start meds"),
    mindMap(
      node("Confirmed HTN", [
        node(
          "Stage 1 (130-139 / 80-89)",
          [
            node("ASCVD or 10-yr risk ≥ 10%", [node("Lifestyle + 1 drug")]),
            node("10-yr risk < 10%", [node("Lifestyle, recheck in 3-6 mo")]),
          ],
          "yellow",
        ),
        node(
          "Stage 2 (≥ 140 / ≥ 90)",
          [
            node("Lifestyle + drug"),
            node("> 20/10 above goal", [node("2 first-line drugs, different classes")]),
          ],
          "red",
        ),
        node("Goal < 130/80 for most adults", [], "green"),
      ]),
      [s5a, s5b, s5c, s5goal],
    ),
    h(2, "Slides 7-9: first line"),
    ul(
      [
        item("Thiazide (chlorthalidone preferred)"),
        item("ACEi"),
        item("ARB"),
        item("DHP CCB (amlodipine)"),
        item("Black pts w/o HF or CKD → thiazide or CCB first", 1),
        item("NEVER ACEi + ARB"),
      ],
      [s7, s7black, s7never, board],
    ),
    quote(
      "Beta blockers are not first line for uncomplicated hypertension.",
      "Prof, lecture 8 (only with HFrEF, post-MI, etc.)",
      [s7bb],
    ),
    compare(
      "ACEi vs ARB",
      ["Cough", "K+", "Angioedema", "Pregnancy", "Monitor"],
      [
        [
          "ACEi (lisinopril)",
          cited("Yes, dry cough", [s9ace]),
          "↑",
          "Yes; never rechallenge",
          cited("Avoid, fetotoxic", [s11preg]),
          "SCr + K+",
        ],
        [
          "ARB (losartan)",
          cited("No", [s9arb]),
          "↑",
          "Rare",
          cited("Avoid, fetotoxic", [s11preg]),
          "SCr + K+",
        ],
      ],
      [s11scr],
    ),
    image(
      page("board", 1),
      "Whiteboard photo listing the four first-line hypertension drug classes",
      "Took a pic of the board after class",
    ),
    divider(),
    question(q("htn-case")),
  ];
}

// ---- 3. Cholinergic agonists and antagonists, lecture 8 -------------------------------------------------
function cholInClass({ c, page, hot, q }) {
  const a4 = c("ans", 4, "Every ganglion uses acetylcholine at nicotinic NN receptors.");
  const s3beth = c(
    "chol",
    3,
    "Bethanechol | Muscarinic selective; not broken down by acetylcholinesterase | Non-obstructive urinary retention",
  );
  const s3pilo = c(
    "chol",
    3,
    "Pilocarpine | Tertiary amine; also an eye drop | Dry mouth in Sjogren syndrome; glaucoma",
  );
  const s3meth = c("chol", 3, "Methacholine | Inhaled | Bronchial challenge test for asthma");
  const s3sp = c(
    "chol",
    3,
    "Bethanechol must never be used when the bladder or bowel is mechanically obstructed.",
  );
  const s5neo = c(
    "chol",
    5,
    "Neostigmine | Reversible; quaternary, no CNS entry | Reversal of nondepolarising blockade; myasthenia gravis",
  );
  const s5phys = c(
    "chol",
    5,
    "Physostigmine | Reversible; tertiary, enters the CNS | Severe anticholinergic toxicity",
  );
  const s5op = c(
    "chol",
    5,
    "Organophosphates (malathion, sarin) | Irreversible | Insecticides and nerve agents: poisoning",
  );
  const s6atr = c("chol", 6, "Atropine: repeat and titrate until bronchial secretions are dry");
  const s6pam = c(
    "chol",
    6,
    "Pralidoxime regenerates acetylcholinesterase if given before the enzyme ages",
  );
  const s6bzd = c("chol", 6, "Benzodiazepines for seizures");
  const s6pupil = c("chol", 6, "Pupil size is a poor end point for atropine.");
  const s7atr = c(
    "chol",
    7,
    "Atropine | Non-selective, tertiary | Symptomatic bradycardia; organophosphate poisoning",
  );
  const s8tox = c(
    "chol",
    8,
    "Toxicity: hot, dry, flushed skin, dilated pupils, delirium, urinary retention",
  );
  const s10atr = c(
    "chol",
    10,
    "Atropine (symptomatic bradycardia) | 1 mg IV every 3 to 5 minutes, maximum 3 mg",
  );
  const card = c("card", 1, "Tx: supportive; physostigmine");
  const pts = hot("ans");

  return [
    p("Lec 8, Tue 10/20. Pulled up the pathway slide from lec 7 to see where each drug hits."),
    h(2, "Where they act"),
    labelledImage(
      page("ans", 4),
      "Autonomic pathway diagram from lecture 7 with my labels for where cholinergic drugs act",
      [
        {
          ...pts.ganglion0,
          label: "NN: every ganglion",
          detail: "Nicotinic NN in every autonomic ganglion, both divisions.",
        },
        {
          ...pts.target0,
          label: "Muscarinic (M2, M3)",
          detail: "Bethanechol, pilocarpine turn it on; atropine, scopolamine block it.",
        },
        {
          ...pts.target2,
          label: "Sweat glands = muscarinic",
          detail: "Sympathetic but ACh on M3: why anticholinergic tox is hot and DRY.",
        },
        {
          ...pts.target4,
          label: "NM: skeletal muscle",
          detail: "Neuromuscular blockers act here (succinylcholine, rocuronium).",
        },
      ],
      [a4],
    ),
    h(2, "Slide 3: direct agonists"),
    ul(
      [
        item("Bethanechol: urinary retention"),
        item("only NON-obstructive! never if bladder or bowel is blocked", 1),
        item("Pilocarpine: dry mouth (Sjogren), glaucoma drops"),
        item("Methacholine: inhaled, bronchial challenge test"),
      ],
      [s3beth, s3sp, s3pilo, s3meth],
    ),
    h(2, "Slide 5: cholinesterase inhibitors"),
    table(
      [
        ["Drug", "Into CNS?", "Use"],
        ["Neostigmine", "No (quaternary)", "reverse NMB; MG"],
        ["Pyridostigmine", "No", "MG, oral"],
        ["Physostigmine", "Yes (tertiary)", "severe anticholinergic tox"],
        ["Donepezil etc.", "Yes", "Alzheimer"],
        ["Organophosphates", "Yes", "poisoning (irreversible)"],
      ],
      [s5neo, s5phys, s5op],
    ),
    h(2, "Slide 6: organophosphate poisoning"),
    callout(
      "important",
      "Treat it",
      [
        b("Atropine"),
        { text: ": repeat until bronchial secretions are DRY (not the pupils). " },
        b("Pralidoxime"),
        { text: " early, before the enzyme ages. Benzo for seizures." },
      ],
      [s6atr, s6pam, s6bzd],
    ),
    quote("Pupil size is a poor end point for atropine.", "Prof, lecture 8", [s6pupil]),
    h(2, "Slides 7-10: antagonists"),
    drugCard(
      {
        name: "atropine",
        drugClass: cited("Non-selective muscarinic antagonist, tertiary amine", [s7atr]),
        indications: [
          cited("Symptomatic bradycardia", [s7atr]),
          cited("Organophosphate poisoning", [s7atr]),
        ],
        adverseEffects: [
          cited("Hot, dry, flushed skin; big pupils; delirium; urinary retention", [s8tox]),
          "Tachycardia",
        ],
        monitoring: ["HR", cited("OP poisoning: bronchial secretions and oxygenation", [s6atr])],
        dosingNotes: [
          cited(
            "Bradycardia: 1 mg IV q3-5 min, max 3 mg",
            [s10atr],
            [
              {
                kind: "dose",
                quote: "1 mg IV q3-5 min, max 3 mg",
                note: "Check the current ACLS dose.",
              },
            ],
          ),
        ],
      },
      [],
      { style: { color: "red" } },
    ),
    mnemonic(
      "Hot, Dry, Red, Blind, Mad, Full",
      "Anticholinergic toxicity",
      [
        ["Hot", "no sweating → hyperthermia"],
        ["Dry", "dry mouth and skin"],
        ["Red", "flushed skin"],
        ["Blind", "dilated pupils, blurry vision"],
        ["Mad", "confusion, delirium"],
        ["Full", "urinary retention"],
      ],
      "My short version of the old 'hot as a hare' line. Tx: supportive; physostigmine only if severe.",
      { citations: [s8tox, card] },
    ),
    divider(),
    question(q("chol-op-case")),
  ];
}

// ---- 4. Exam 3 cram sheet ------------------------------------------------------------------------------
function cramSheet({ c }) {
  const a6m2 = c(
    "ans",
    6,
    "M2 | Gi-coupled | Heart (SA and AV nodes) | Slower heart rate and AV conduction",
  );
  const a6m3 = c(
    "ans",
    6,
    "M3 | Gq-coupled | Smooth muscle, exocrine glands, vascular endothelium | Contraction, secretion, NO-mediated vasodilation",
  );
  const a7a1 = c(
    "ans",
    7,
    "alpha-1 | Gq | Vascular smooth muscle, iris dilator muscle, bladder sphincter | Vasoconstriction, mydriasis, urinary retention",
  );
  const a7a2 = c(
    "ans",
    7,
    "alpha-2 | Gi | Presynaptic nerve terminals, CNS | Less NE release; lower sympathetic outflow",
  );
  const a7b1 = c(
    "ans",
    7,
    "beta-1 | Gs | Heart, juxtaglomerular cells of the kidney | Higher heart rate and contractility; renin release",
  );
  const a7b2 = c(
    "ans",
    7,
    "beta-2 | Gs | Bronchial and vascular smooth muscle, liver, uterus | Bronchodilation, vasodilation, glycogenolysis, uterine relaxation",
  );
  const a8sweat = c(
    "ans",
    8,
    "Sweat glands | Secretion (muscarinic, sympathetic cholinergic) | No innervation",
  );
  const b6hf = c("beta", 6, "HFrEF: only bisoprolol, carvedilol and metoprolol succinate");
  const b9clo = c("beta", 9, "Clonidine: stop the beta blocker first when withdrawing both");
  const b4n = c("beta", 4, "Cardioselective does not mean cardiac-only.");
  const htnPreg = c(
    "htn",
    8,
    "Pregnancy | Labetalol or nifedipine; avoid ACE inhibitors, ARBs and aliskiren",
  );
  const ch6 = c("chol", 6, "Pupil size is a poor end point for atropine.");
  const ch9 = c(
    "chol",
    9,
    "Neostigmine reverses nondepolarising block and is given with glycopyrrolate to block its muscarinic effects.",
  );
  const ch12 = c(
    "chol",
    12,
    "Atropine for muscarinic toxicity; pralidoxime for organophosphates; physostigmine for severe anticholinergic toxicity",
  );
  const ch9roc = c("chol", 9, "Rocuronium | Nondepolarising | Reversed by sugammadex");

  return [
    callout(
      "exam_tip",
      "Exam 3",
      "Lectures 7-10. Receptor table + toxidromes are always on it. One page, no excuses.",
    ),
    h(2, "Receptor → effect"),
    table(
      [
        ["Receptor", "G", "Where", "Turn it on →"],
        [
          "α1",
          "Gq",
          "vessels, iris dilator, bladder sphincter",
          "vasoconstriction, mydriasis, retention",
        ],
        ["α2", "Gi", "presynaptic, CNS", "↓ NE release (clonidine)"],
        ["β1", "Gs", "heart, kidney JG cells", "↑ HR, ↑ contractility, ↑ renin"],
        [
          "β2",
          "Gs",
          "bronchi, vessels, liver, uterus",
          "bronchodilation, vasodilation, glycogenolysis",
        ],
        ["M2", "Gi", "SA + AV node", "↓ HR, slower AV conduction"],
        [
          "M3",
          "Gq",
          "smooth muscle, glands, endothelium",
          "contraction, secretion, miosis, NO vasodilation",
        ],
        [
          "NN",
          "ion channel",
          "every ganglion, adrenal medulla",
          "fires the 2nd neuron; epi release",
        ],
        ["NM", "ion channel", "NMJ", "skeletal muscle contraction"],
      ],
      [a7a1, a7a2, a7b1, a7b2, a6m2, a6m3],
      { headerColumn: true, caption: "Gq contracts, Gs = cAMP, Gi inhibits." },
    ),
    compare(
      "Selective vs non-selective β blockers",
      ["Blocks", "Drugs", "Asthma / COPD", "HFrEF?", "Extra"],
      [
        [
          "Non-selective",
          "β1 + β2",
          "propranolol, nadolol, timolol",
          "avoid",
          "no",
          "propranolol: migraine, tremor, thyroid",
        ],
        [
          "β1-selective",
          cited("β1 (fades at high dose)", [b4n]),
          "atenolol, metoprolol, bisoprolol, esmolol",
          "low dose if needed",
          cited("bisoprolol, metoprolol succ", [b6hf]),
          "esmolol IV only",
        ],
        [
          "α1 + β",
          "α1, β1, β2",
          "carvedilol, labetalol",
          "avoid",
          cited("carvedilol", [b6hf]),
          cited("labetalol in pregnancy", [htnPreg]),
        ],
      ],
    ),
    h(2, "Antidotes"),
    ul(
      [
        item("Organophosphates → atropine + pralidoxime (+ benzo for seizures)"),
        item("titrate atropine to dry secretions, not pupils", 1),
        item("Severe anticholinergic tox → physostigmine (severe only)"),
        item("Roc / vec → sugammadex, or neostigmine + glycopyrrolate"),
        item("β blocker overdose → glucagon (not in our slides, from the tox lecture)"),
      ],
      [ch12, ch6, ch9, ch9roc],
    ),
    h(2, "The five things I keep getting wrong"),
    ol(
      [
        "Metoprolol TARTRATE is not an HFrEF drug. Succinate is.",
        "Sweat glands: sympathetic nerves, but ACh on muscarinic receptors. So atropine = dry, and sweating still happens with masked hypoglycemia.",
        "Cardioselective ≠ cardiac-only: selectivity is lost at higher doses.",
        "Pupils: α1 dilates (mydriasis), M3 constricts (miosis). Not β.",
        "Stopping clonidine + a β blocker: stop the β blocker first, then taper clonidine.",
      ],
      [b6hf, a8sweat, b4n, b9clo],
    ),
    h(2, "Topics"),
    checklist([
      done("ANS overview + receptor table"),
      done("Organ responses (sympathetic vs parasympathetic)"),
      done("Direct cholinergic agonists"),
      done("Cholinesterase inhibitors"),
      todo("Organophosphate case: redo it timed"),
      todo("Anticholinergics + Beers list"),
      todo("NM blockers (sux vs nondepolarising)"),
      todo("Adrenergic agonists: pressors and inotropes"),
      todo("α agonists: clonidine (α2) vs midodrine (α1) Qs"),
      done("Beta blockers"),
      done("Toxidrome index card"),
    ]),
  ];
}

// ---- 5. Calculations cheat sheet -------------------------------------------------------------------------
function calcSheet({ c }) {
  const cg = c("calc", 1, "CrCl (mL/min) = [(140 - age) x weight (kg)] / (72 x SCr (mg/dL))");
  const cgF = c("calc", 1, "Multiply by 0.85 for female patients.");
  const cgW = c(
    "calc",
    1,
    "Course convention for the weight: use ideal body weight (IBW), or actual weight if it is lower. If actual weight is more than 120% of IBW, use adjusted body weight.",
  );
  const ibwM = c("calc", 1, "IBW (male) = 50 kg + 2.3 kg for each inch over 5 feet");
  const ibwF = c("calc", 1, "IBW (female) = 45.5 kg + 2.3 kg for each inch over 5 feet");
  const adj = c("calc", 1, "Adjusted body weight = IBW + 0.4 x (actual weight - IBW)");
  const meq = c("calc", 3, "mEq = mg x valence / molecular weight");
  const rate = c("calc", 2, "Rate (mL/hr) = dose per hour / concentration");
  const drip = c("calc", 2, "Drops per minute = volume (mL) x drop factor (gtt/mL) / time (min)");
  const size = c(
    "calc",
    2,
    "Check every answer for size: a heparin rate of 144 mL/hr or a dopamine rate of 1.3 mL/hr should make you stop and recalculate.",
  );

  const formula = (lines) =>
    p(lines.flatMap((line, i) => (i ? [{ text: "\n" }, code(line)] : [code(line)])));

  return [
    callout(
      "tip",
      "Before every answer",
      "Units on every line. Then ask: is this size believable? A heparin drip at 144 mL/hr means I slipped a decimal.",
      [size],
    ),
    h(2, "1. CrCl (Cockcroft-Gault)"),
    formula(["CrCl (mL/min) = (140 − age) × wt (kg) / (72 × SCr)", "× 0.85 if female"]),
    ul(
      [
        item("Which weight (our course): IBW, or actual if actual is lower"),
        item("actual > 120% of IBW → adjusted BW", 1),
        item("AdjBW = IBW + 0.4 × (actual − IBW)", 2),
      ],
      [cg, cgF, cgW, adj],
    ),
    p([
      b("Example: "),
      {
        text: "F, 62 y, 5'6\", 70 kg, SCr 1.2. IBW = 45.5 + 2.3 × 6 = 59.3 kg; 70 / 59.3 = 118%, under 120%, so use 59.3. CrCl = 78 × 59.3 / (72 × 1.2) × 0.85 = 45.5 mL/min.",
      },
    ]),
    h(2, "2. IBW"),
    formula([
      "IBW (M) = 50 + 2.3 × (inches over 5 ft)",
      "IBW (F) = 45.5 + 2.3 × (inches over 5 ft)",
    ]),
    p("Example: M, 6'0\" → 50 + 2.3 × 12 = 77.6 kg.", [ibwM, ibwF]),
    h(2, "3. BSA (Mosteller)"),
    formula(["BSA (m²) = √( ht (cm) × wt (kg) / 3600 )", "or √( ht (in) × wt (lb) / 3131 )"]),
    p("Example: 170 cm, 70 kg → √(11,900 / 3600) = √3.31 = 1.82 m²."),
    h(2, "4. mEq and mmol"),
    formula(["mEq = mg × valence / MW", "mmol = mg / MW"]),
    p(
      "Example: magnesium sulfate heptahydrate (MW 246.5, Mg is 2+). 1 g = 1000 × 2 / 246.5 = 8.1 mEq = 4.1 mmol of Mg.",
      [meq],
    ),
    h(2, "5. Flow rate and drop rate"),
    formula([
      "Rate (mL/hr) = dose per hr / concentration",
      "gtt/min = volume (mL) × drop factor (gtt/mL) / time (min)",
    ]),
    table(
      [
        ["Problem", "Set-up", "Answer"],
        ["Diltiazem 125 mg / 125 mL, run at 10 mg/hr", "10 mg/hr ÷ 1 mg/mL", "10 mL/hr"],
        ["500 mL over 4 hr, 20 gtt/mL set", "500 × 20 / 240", "41.7 → 42 gtt/min"],
      ],
      [rate, drip],
    ),
    h(2, "6. Percent and ratio strength"),
    formula([
      "% w/v = g per 100 mL      (2% = 2 g/100 mL = 20 mg/mL)",
      "1:x = 1 g in x mL          % = 100 / x",
    ]),
    ul([
      item("D5W, 500 mL: 5 g/100 mL × 500 mL = 25 g dextrose"),
      item("Lidocaine 2% = 20 mg/mL"),
      item("Epinephrine 1:1000 = 1 g/1000 mL = 1 mg/mL = 0.1%"),
      item("1:10,000 = 0.1 mg/mL (the code-cart syringe)", 1),
    ]),
    h(2, "7. Alligation"),
    p([
      { text: "Make " },
      b("100 g of 2.5%"),
      {
        text: " hydrocortisone cream from 5% and 1%. Parts of 5% = 2.5 − 1 = 1.5; parts of 1% = 5 − 2.5 = 2.5; 4 parts total. 5%: 1.5/4 × 100 = 37.5 g. 1%: 2.5/4 × 100 = 62.5 g. Check: 1.875 g + 0.625 g = 2.5 g in 100 g. ✓",
      },
    ]),
    divider(),
    table(
      [
        ["Conversion", "Value"],
        ["1 kg", "2.2 lb"],
        ["1 inch", "2.54 cm"],
        ["1 tsp / 1 tbsp", "5 mL / 15 mL"],
        ["1 fl oz", "29.57 mL (30 on most exams)"],
      ],
      [],
      { caption: "Things I should not have to look up" },
    ),
  ];
}

// ---- her lines in the agent's beta blocker guide -----------------------------------------------------------
export const HER_PARAGRAPH_START = "My version: β1 = heart (one heart), β2 = lungs (two lungs).";
const HER_CALLOUT_TITLE = "My note: two different questions";
const HER_EDIT = "In asthma: cardioselective, lowest dose, and ask about wheeze at every visit.";
const EDIT_TARGET_TITLE = "Cardioselective is not cardiac-only";

const plain = (rich) =>
  typeof rich === "string" ? rich : (rich ?? []).map((x) => x.text ?? "").join("");

/**
 * What her edits to the beta blocker guide still need, read from its blocks. Throws when the
 * agent's blocks she writes next to are not there (the guide is not the seeder's).
 */
export function planGuideEdits(blocks) {
  const userBlock = (type, test) =>
    blocks.find((x) => x.type === type && x.origin === "user" && test(x));
  const agentBlock = (type, test, what) => {
    const found = blocks.find((x) => x.type === type && test(x));
    if (!found) throw new Error(`the beta blocker guide has no ${what}`);
    return found;
  };
  const net = agentBlock(
    "callout",
    (x) => x.content.title === "Net effect",
    '"Net effect" callout',
  );
  const pk = agentBlock(
    "bulleted_list",
    (x) => x.content.items.some((i) => plain(i.text).startsWith("Lipophilic (propranolol)")),
    "pharmacokinetics list",
  );
  const target = agentBlock(
    "callout",
    (x) => x.content.title === EDIT_TARGET_TITLE,
    `"${EDIT_TARGET_TITLE}" callout`,
  );
  return {
    paragraph: userBlock("paragraph", (x) => plain(x.content.text).startsWith(HER_PARAGRAPH_START))
      ? null
      : { after: net.id },
    callout: userBlock("callout", (x) => x.content.title === HER_CALLOUT_TITLE)
      ? null
      : { after: pk.id },
    edit: plain(target.content.text).includes(HER_EDIT)
      ? null
      : { blockId: target.id, text: `${plain(target.content.text)} ${HER_EDIT}` },
  };
}

function guideEditBlocks({ c }) {
  const s3b1 = c("beta", 3, "Beta-1 blockade: lower heart rate, contractility and AV conduction");
  const s7bronch = c("beta", 7, "Bronchospasm in asthma, especially with non-selective agents");
  const hand = c("hand", 2, "Atenolol + nadolol = renal -> adjust in CKD");
  const cyp = c("beta", 9, "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels");
  return {
    paragraph: p(
      `${HER_PARAGRAPH_START} Block β1 and the heart slows and squeezes less, and the kidney lets out less renin, so BP comes down from two sides. Hit β2 too (non-selective, or a selective one at a high dose) and the airways tighten.`,
      [s3b1, s7bronch],
    ),
    callout: callout(
      "tip",
      HER_CALLOUT_TITLE,
      "Renal ones (atenolol, nadolol) are the ones to dose-adjust in CKD. Liver ones (metoprolol, carvedilol, propranolol) are where CYP2D6 interactions come in. On a case, ask both.",
      [hand, cyp],
    ),
  };
}

// ---- writing ---------------------------------------------------------------------------------------------------

/** Her documents: where each goes, what kind, and its builder. */
export const OWN_DOCUMENTS = [
  { place: "beta", title: "In-class notes", kind: "lecture_note", build: betaInClass },
  { place: "htn", title: "In-class notes", kind: "lecture_note", build: htnInClass },
  { place: "chol", title: "In-class notes", kind: "lecture_note", build: cholInClass },
  { place: "cram", title: "Exam 3 cram sheet", kind: "study_guide", build: cramSheet },
  { place: "calc", title: "Calculations cheat sheet", kind: "study_guide", build: calcSheet },
];

/** Every block of every document, built (and every citation checked) before anything is written. */
export function buildOwnNotes(ctx) {
  return {
    documents: OWN_DOCUMENTS.map((spec) => ({ ...spec, blocks: spec.build(ctx) })),
    guide: guideEditBlocks(ctx),
  };
}

/** Split a document where she starts a new slide group (a level 2 heading): she types it in that many sittings. */
function sittings(blocks) {
  const out = [];
  for (const block of blocks) {
    if (!out.length || (block.type === "heading" && block.content.level === 2 && out.at(-1).length))
      out.push([]);
    out.at(-1).push(block);
  }
  return out;
}

/**
 * Write her notes through her session, the way the web editor does: a document node, its document,
 * then blocks inserted as she goes. Skips a document whose name already exists under its parent
 * and any guide edit already made.
 *
 * `places` maps each document's place (beta, htn, chol, cram, calc) to its parent node ID, and
 * `betaGuide` to the beta blocker guide's document ID.
 */
export async function writeOwnNotes({ call, list, built, places, betaGuide, log = console.log }) {
  const report = { written: [], skipped: [], guide: [] };
  for (const doc of built.documents) {
    const parentId = places[doc.place];
    const siblings = await list(`/nodes?parentId=${parentId}&limit=200`);
    let nodeNode = siblings.find((n) => n.kind === "document" && n.name === doc.title);
    if (nodeNode) {
      const existing = await call("GET", `/nodes/${nodeNode.id}/document`).catch(() => null);
      if (existing) {
        report.skipped.push(`${doc.title} (${doc.place})`);
        log(`  ${doc.title} under ${doc.place}: already there, skipped`);
        continue;
      }
    }
    nodeNode ??= (await call("POST", "/nodes", { parentId, kind: "document", name: doc.title }))
      .node;
    const { documentId } = await call("POST", "/documents", {
      nodeId: nodeNode.id,
      kind: doc.kind,
      title: doc.title,
    });
    for (const blocks of sittings(doc.blocks)) {
      await call("POST", `/documents/${documentId}/blocks`, { blocks, position: "end" });
    }
    const types = [...new Set(doc.blocks.map((x) => x.type))];
    report.written.push({
      title: doc.title,
      place: doc.place,
      documentId,
      blocks: doc.blocks.length,
      types,
    });
    log(`  ${doc.title} under ${doc.place}: ${doc.blocks.length} blocks (${types.length} types)`);
  }

  const { blocks } = await call("GET", `/documents/${betaGuide}/content?limit=1000`);
  const plan = planGuideEdits(blocks);
  if (plan.paragraph) {
    await call("POST", `/documents/${betaGuide}/blocks`, {
      blocks: [built.guide.paragraph],
      position: plan.paragraph,
    });
    report.guide.push("paragraph");
  }
  if (plan.callout) {
    await call("POST", `/documents/${betaGuide}/blocks`, {
      blocks: [built.guide.callout],
      position: plan.callout,
    });
    report.guide.push("callout");
  }
  if (plan.edit) {
    await call("PATCH", `/documents/${betaGuide}/blocks/${plan.edit.blockId}`, {
      mode: "patch",
      patch: { content: { text: plan.edit.text } },
    });
    report.guide.push("edit");
  }
  log(
    report.guide.length
      ? `  beta blocker guide: her ${report.guide.join(", ")} added`
      : "  beta blocker guide: her edits are already there, skipped",
  );
  return report;
}
