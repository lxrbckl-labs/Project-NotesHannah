/**
 * An invented question bank for the mock store and the demo: a beta-blocker lecture (7) and an
 * ACE-inhibitor lecture (8). Drug names are made up (lorvanol, tenzolol, mirexapril, ...); the class
 * statements are general pharmacology, kept simple. Covers every question type.
 */
import { practice } from "@notes/schema";

const pad = (n: number) => String(n).padStart(26, "0");
export const fid = (prefix: string, n: number) => `${prefix}_${pad(n)}`;

export const NODE_COURSE = fid("nod", 1);
export const NODE_L7 = fid("nod", 2);
export const NODE_L8 = fid("nod", 3);

export interface NodeInfo {
  id: string;
  title: string;
  path: string;
  parent: string | null;
}
export const NODES: NodeInfo[] = [
  {
    id: NODE_COURSE,
    title: "Cardiovascular Pharmacology",
    path: "Cardiovascular Pharmacology",
    parent: null,
  },
  {
    id: NODE_L7,
    title: "Lecture 7: Beta-blockers",
    path: "Cardiovascular Pharmacology / Lecture 7: Beta-blockers",
    parent: NODE_COURSE,
  },
  {
    id: NODE_L8,
    title: "Lecture 8: ACE inhibitors",
    path: "Cardiovascular Pharmacology / Lecture 8: ACE inhibitors",
    parent: NODE_COURSE,
  },
];

export const CONCEPTS: Record<string, string> = {
  [fid("con", 1)]: "Beta-blockers",
  [fid("con", 2)]: "ACE inhibitors",
  [fid("con", 3)]: "Heart failure",
  [fid("con", 4)]: "Adverse effects",
  [fid("con", 5)]: "Dose calculations",
  [fid("con", 6)]: "Brand and generic names",
  [fid("con", 7)]: "Hypertension",
  [fid("con", 8)]: "Potassium and kidneys",
};
const C = (...n: number[]) => n.map((x) => fid("con", x));

/** Which lecture a question lives in (the mock's stand-in for the document tree). */
export const LECTURE_OF: Record<string, 7 | 8> = {};

function src(lecture: 7 | 8, page: number, quote: string) {
  return {
    fileId: fid("fil", lecture),
    pageId: fid("pag", lecture * 100 + page),
    quote,
    label: `Lecture ${lecture}, page ${page}`,
  };
}

type Raw = Record<string, unknown>;
const raw: { n: number; lecture: 7 | 8; q: Raw }[] = [];
let counter = 0;
function add(lecture: 7 | 8, q: Raw) {
  counter += 1;
  raw.push({ n: counter, lecture, q });
}
const opt = (text: string, correct = false, rationale?: string) => ({
  text,
  ...(correct ? { correct: true } : {}),
  ...(rationale ? { rationale } : {}),
});

// ------------------------------------------------------------ multiple choice
add(7, {
  type: "multiple_choice",
  prompt: "Which effect is expected with the beta-blocker lorvanol?",
  options: [
    opt("Slower heart rate", true, "Beta blockade lowers heart rate."),
    opt("Faster heart rate", false, "That would be a beta agonist effect."),
    opt("Higher serum potassium"),
    opt("Wider pupils"),
  ],
  explanation:
    "Beta-blockers slow the heart rate and lower contractility, which reduces oxygen demand.",
  sources: [src(7, 4, "Beta-blockers lower heart rate and contractility.")],
  tags: ["pharmacology", "mechanism"],
  conceptIds: C(1),
  difficulty: 1,
});
add(7, {
  type: "multiple_choice",
  prompt: "Tenzolol is called cardioselective. What does that mean?",
  options: [
    opt("It blocks mainly beta-1 receptors in the heart", true),
    opt("It blocks mainly beta-2 receptors in the lungs"),
    opt("It blocks alpha and beta receptors equally"),
    opt("It stimulates the heart"),
  ],
  explanation:
    "Cardioselective drugs favour beta-1 receptors, so they are less likely to narrow the airways at usual doses.",
  sources: [src(7, 9, "Beta-1 selective agents: less bronchospasm at usual doses.")],
  tags: ["pharmacology", "mechanism"],
  conceptIds: C(1),
});
add(7, {
  type: "multiple_choice",
  prompt: "A patient with asthma needs a beta-blocker. Which choice is safer?",
  options: [
    opt("A cardioselective agent such as tenzolol, with care", true),
    opt("A non-selective agent such as lorvanol"),
    opt("Doubling the dose of any beta-blocker"),
    opt("No difference between them"),
  ],
  explanation:
    "Non-selective blockade of beta-2 receptors can cause bronchospasm; selective agents lower that risk but do not remove it.",
  sources: [src(7, 10, "Non-selective beta-blockers may precipitate bronchospasm.")],
  tags: ["adverse-effects", "safety"],
  conceptIds: C(1, 4),
  difficulty: 2,
});
add(7, {
  type: "multiple_choice",
  prompt: "Which sign should be checked before giving a beta-blocker?",
  options: [
    opt("Resting heart rate and blood pressure", true),
    opt("Skin colour"),
    opt("Serum calcium only"),
    opt("Body temperature only"),
  ],
  explanation: "A low heart rate or low pressure before the dose is a reason to hold it and ask.",
  sources: [src(7, 11, "Check pulse and blood pressure before each dose.")],
  tags: ["monitoring"],
  conceptIds: C(1),
  difficulty: 1,
});
add(8, {
  type: "multiple_choice",
  prompt: "Which adverse effect is characteristic of ACE inhibitors such as mirexapril?",
  options: [
    opt("Persistent dry cough", true, "Bradykinin builds up when ACE is blocked."),
    opt("Constipation"),
    opt("Hair loss"),
    opt("Hypoglycaemia"),
  ],
  explanation:
    "ACE also breaks down bradykinin. Blocking it lets bradykinin build up, which causes the dry cough.",
  sources: [src(8, 6, "Dry cough affects up to 1 in 5 patients: bradykinin accumulates.")],
  tags: ["adverse-effects"],
  conceptIds: C(2, 4),
  difficulty: 1,
});
add(8, {
  type: "multiple_choice",
  prompt: "A patient on valdopril develops lip and tongue swelling. What is the best next step?",
  options: [
    opt("Stop the drug and treat urgently as angioedema", true),
    opt("Give a second dose"),
    opt("Reassure and continue"),
    opt("Switch to a larger tablet"),
  ],
  explanation:
    "Angioedema is rare but can close the airway. The drug is stopped and the patient treated at once.",
  sources: [src(8, 7, "Angioedema: stop the ACE inhibitor immediately.")],
  tags: ["adverse-effects", "safety"],
  conceptIds: C(2, 4),
  difficulty: 2,
});
add(8, {
  type: "multiple_choice",
  prompt: "Which lab value most needs follow-up after starting an ACE inhibitor?",
  options: [
    opt("Serum potassium and creatinine", true),
    opt("Serum sodium only"),
    opt("Platelet count"),
    opt("Vitamin D"),
  ],
  explanation:
    "Lower aldosterone raises potassium, and kidney function can change, so both are rechecked in the first weeks.",
  sources: [src(8, 8, "Recheck potassium and creatinine 1 to 2 weeks after starting.")],
  tags: ["monitoring"],
  conceptIds: C(2, 8),
  difficulty: 2,
});

// ----------------------------------------------------------------- select all
add(7, {
  type: "select_all",
  prompt: "Which of these are expected effects of beta blockade?",
  options: [
    opt("Lower heart rate", true),
    opt("Lower blood pressure", true),
    opt("Reduced cardiac contractility", true),
    opt("Increased bronchodilation"),
    opt("Faster AV conduction"),
  ],
  explanation:
    "Beta-1 blockade slows the heart and weakens contraction. Bronchodilation is a beta-2 effect, so blocking it can do the opposite.",
  sources: [src(7, 5, "Effects: lower HR, lower BP, lower contractility, slower AV conduction.")],
  tags: ["pharmacology", "mechanism"],
  conceptIds: C(1),
});
add(7, {
  type: "select_all",
  prompt: "Which are cautions or contraindications for non-selective beta-blockers?",
  options: [
    opt("Asthma", true),
    opt("Severe bradycardia", true),
    opt("Second or third degree heart block", true),
    opt("Mild seasonal allergies"),
    opt("Previous sprained ankle"),
  ],
  explanation: "Airway disease, a slow pulse and conduction block all make beta-blockade risky.",
  sources: [src(7, 12, "Avoid in asthma, severe bradycardia and AV block.")],
  tags: ["safety"],
  conceptIds: C(1, 4),
  difficulty: 2,
});
add(8, {
  type: "select_all",
  prompt: "Which are recognised adverse effects of ACE inhibitors?",
  options: [
    opt("Dry cough", true),
    opt("Hyperkalaemia", true),
    opt("Angioedema", true),
    opt("Hypokalaemia"),
    opt("Weight gain from appetite"),
  ],
  explanation:
    "Cough, high potassium and angioedema are the classic three. Potassium goes up, not down.",
  sources: [
    src(8, 6, "Adverse effects: cough, hyperkalaemia, angioedema, first-dose hypotension."),
  ],
  tags: ["adverse-effects"],
  conceptIds: C(2, 4, 8),
});
add(8, {
  type: "select_all",
  prompt: "Which situations call for extra care with an ACE inhibitor?",
  options: [
    opt("Pregnancy", true, "ACE inhibitors can harm the fetus."),
    opt("Bilateral renal artery stenosis", true),
    opt("Taking potassium supplements", true),
    opt("Wearing glasses"),
  ],
  explanation:
    "Avoid in pregnancy; kidney perfusion depends on angiotensin II in renal artery stenosis; extra potassium adds to the rise.",
  sources: [src(8, 9, "Contraindicated in pregnancy and bilateral renal artery stenosis.")],
  tags: ["safety"],
  conceptIds: C(2, 8),
  difficulty: 3,
});

// ------------------------------------------------------------------ matching
add(7, {
  type: "matching",
  prompt: "Match each brand name to its generic name. All names are invented.",
  pairs: [
    { left: "Veloxa", right: "lorvanol" },
    { left: "Cardimar", right: "tenzolol" },
    { left: "Bivantra", right: "carvonidol" },
  ],
  distractors: ["mirexapril", "valdopril"],
  explanation: "Brand names are what is on the box; the generic name is what you chart.",
  sources: [src(7, 3, "Veloxa (lorvanol), Cardimar (tenzolol), Bivantra (carvonidol).")],
  tags: ["names"],
  conceptIds: C(1, 6),
  difficulty: 1,
});
add(8, {
  type: "matching",
  prompt: "Match each brand name to its generic name. All names are invented.",
  pairs: [
    { left: "Corelix", right: "mirexapril" },
    { left: "Vasenta", right: "valdopril" },
    { left: "Renolar", right: "tenvapril" },
  ],
  distractors: ["lorvanol"],
  explanation: "Generic ACE inhibitor names end in -pril.",
  sources: [src(8, 3, "Corelix (mirexapril), Vasenta (valdopril), Renolar (tenvapril).")],
  tags: ["names"],
  conceptIds: C(2, 6),
  difficulty: 1,
});
add(7, {
  type: "matching",
  prompt: "Match each drug to its class.",
  pairs: [
    { left: "lorvanol", right: "Non-selective beta-blocker" },
    { left: "tenzolol", right: "Beta-1 selective blocker" },
    { left: "carvonidol", right: "Alpha and beta blocker" },
    { left: "mirexapril", right: "ACE inhibitor" },
  ],
  distractors: ["Calcium channel blocker", "Loop diuretic"],
  explanation: "Selectivity decides which receptors a beta-blocker mostly acts on.",
  sources: [src(7, 8, "Classes: non-selective, beta-1 selective, mixed alpha and beta.")],
  tags: ["classification"],
  conceptIds: C(1, 2),
  difficulty: 2,
});
add(8, {
  type: "matching",
  prompt: "Match each problem to its likely cause.",
  pairs: [
    { left: "Dry cough", right: "Bradykinin build-up" },
    { left: "High potassium", right: "Less aldosterone" },
    { left: "First-dose hypotension", right: "Sudden fall in angiotensin II" },
  ],
  distractors: ["Histamine release"],
  explanation: "Each effect follows from which part of the renin-angiotensin system is blocked.",
  sources: [
    src(
      8,
      5,
      "Mechanism links: cough (bradykinin), hyperkalaemia (aldosterone), hypotension (AII).",
    ),
  ],
  tags: ["mechanism"],
  conceptIds: C(2, 4),
  difficulty: 2,
});

// ----------------------------------------------------------------- fill blank
add(7, {
  type: "fill_blank",
  text: "Lorvanol is a {{1}} blocker that lowers the {{2}}.",
  blanks: [{ answers: ["beta"] }, { answers: ["heart rate", "pulse"] }],
  explanation: "Beta-blockers slow the heart.",
  sources: [src(7, 4, "Lorvanol: beta-blocker, lowers heart rate.")],
  tags: ["pharmacology"],
  conceptIds: C(1),
  difficulty: 1,
});
add(7, {
  type: "fill_blank",
  text: "Abruptly stopping a beta-blocker can cause {{1}} tachycardia and a rise in {{2}}.",
  blanks: [{ answers: ["rebound"] }, { answers: ["blood pressure", "bp"] }],
  explanation:
    "Receptors become more numerous during blockade; stopping suddenly exposes them. Doses are tapered.",
  sources: [src(7, 13, "Do not stop abruptly: rebound tachycardia and hypertension.")],
  tags: ["safety"],
  conceptIds: C(1, 4),
});
add(8, {
  type: "fill_blank",
  text: "ACE stands for angiotensin-{{1}} enzyme.",
  blanks: [{ answers: ["converting"], allowTypos: true }],
  explanation: "The enzyme converts angiotensin I into angiotensin II.",
  sources: [src(8, 4, "ACE: angiotensin-converting enzyme.")],
  tags: ["mechanism"],
  conceptIds: C(2),
  difficulty: 1,
});
add(8, {
  type: "fill_blank",
  text: "ACE inhibitors can raise serum {{1}}, so {{2}} supplements are used with caution.",
  blanks: [
    { answers: ["potassium"], allowTypos: true },
    { answers: ["potassium"], allowTypos: true },
  ],
  explanation: "Less aldosterone means the kidney keeps more potassium.",
  sources: [src(8, 8, "Hyperkalaemia: avoid routine potassium supplements.")],
  tags: ["adverse-effects"],
  conceptIds: C(2, 8),
});
add(8, {
  type: "fill_blank",
  text: "Generic names of ACE inhibitors end in {{1}}.",
  blanks: [{ answers: ["pril"] }],
  explanation: "mirexapril, valdopril and tenvapril all share the stem.",
  sources: [src(8, 3, "Stem: -pril.")],
  tags: ["names"],
  conceptIds: C(2, 6),
  difficulty: 1,
});

// ---------------------------------------------------------------- calculation
add(7, {
  type: "calculation",
  prompt: "A patient takes lorvanol 25 mg twice daily. What is the total daily dose?",
  answer: { kind: "fixed", value: 50 },
  units: ["mg", "milligram"],
  explanation: "25 mg x 2 doses = {answer} a day.",
  sources: [src(7, 14, "Usual starting dose 25 mg twice daily.")],
  tags: ["dosing"],
  conceptIds: C(1, 5),
  difficulty: 1,
});
add(7, {
  type: "calculation",
  prompt:
    "A patient weighs {weightKg} kg. The order is {doseMgPerKg} mg/kg as a single dose. How many mg is the dose?",
  answer: {
    kind: "expression",
    expression: "weightKg * doseMgPerKg",
    variables: {
      weightKg: { kind: "range", min: 50, max: 90, step: 5 },
      doseMgPerKg: { kind: "list", values: [2, 3, 5] },
    },
  },
  units: ["mg", "milligram"],
  explanation: "Dose = {weightKg} kg x {doseMgPerKg} mg/kg = {answer}.",
  sources: [src(7, 15, "Weight-based dosing: dose = weight x mg/kg.")],
  tags: ["dosing"],
  conceptIds: C(1, 5),
  difficulty: 2,
});
add(7, {
  type: "calculation",
  prompt:
    "Lorvanol is infused at {rate} mcg/kg/min in a {weightKg} kg patient. How many mcg per minute is that?",
  answer: {
    kind: "expression",
    expression: "rate * weightKg",
    variables: {
      rate: { kind: "list", values: [2, 5, 10] },
      weightKg: { kind: "list", values: [60, 70, 80] },
    },
  },
  units: ["mcg/min"],
  explanation: "{rate} mcg/kg/min x {weightKg} kg = {answer}.",
  sources: [src(7, 16, "Infusion rate in mcg/min = mcg/kg/min x weight in kg.")],
  tags: ["dosing", "infusions"],
  conceptIds: C(1, 5),
  difficulty: 3,
});
add(8, {
  type: "calculation",
  prompt:
    "Mirexapril liquid is 1 mg/mL. The dose is 0.1 mg/kg for a child of {weightKg} kg. How many mL? Round to 1 decimal place.",
  answer: {
    kind: "expression",
    expression: "weightKg * 0.1",
    variables: { weightKg: { kind: "list", values: [12, 15, 18, 24] } },
  },
  units: ["mL", "millilitre"],
  rounding: { mode: "decimals", places: 1 },
  explanation: "{weightKg} kg x 0.1 mg/kg = dose in mg; at 1 mg/mL the volume in mL is {answer}.",
  sources: [src(8, 12, "Paediatric dosing: mg/kg, then divide by the concentration.")],
  tags: ["dosing"],
  conceptIds: C(2, 5),
  difficulty: 2,
});
add(8, {
  type: "calculation",
  prompt: "Convert 2.5 g of valdopril to milligrams.",
  answer: { kind: "fixed", value: 2500 },
  units: ["mg"],
  rounding: { mode: "decimals", places: 0 },
  explanation: "1 g = 1000 mg, so 2.5 g = {answer}.",
  sources: [src(8, 13, "1 g = 1000 mg.")],
  tags: ["dosing", "units"],
  conceptIds: C(5),
  difficulty: 1,
});
add(8, {
  type: "calculation",
  prompt:
    "{volumeMl} mL of an infusion runs over {hours} hr. What is the rate? Round to 1 decimal place.",
  answer: {
    kind: "expression",
    expression: "volumeMl / hours",
    variables: {
      volumeMl: { kind: "list", values: [250, 500, 1000] },
      hours: { kind: "list", values: [3, 4, 8] },
    },
  },
  units: ["mL/hr"],
  rounding: { mode: "decimals", places: 1 },
  explanation: "{volumeMl} mL / {hours} hr = {answer}.",
  sources: [src(8, 14, "Rate (mL/hr) = volume / time.")],
  tags: ["dosing", "infusions"],
  conceptIds: C(5),
  difficulty: 2,
});

// ------------------------------------------------------------------ flashcard
const cards: [7 | 8, number, string, string, number[]][] = [
  [7, 3, "Brand name of lorvanol?", "Veloxa", [1, 6]],
  [7, 3, "Brand name of tenzolol?", "Cardimar", [1, 6]],
  [
    7,
    5,
    "Name two effects of beta blockade on the heart.",
    "Slower heart rate and weaker contraction.",
    [1],
  ],
  [
    7,
    13,
    "Why are beta-blockers tapered rather than stopped suddenly?",
    "Rebound tachycardia and high blood pressure.",
    [1, 4],
  ],
  [
    8,
    4,
    "What does an ACE inhibitor stop the body making?",
    "Angiotensin II (it blocks the conversion of angiotensin I).",
    [2],
  ],
  [
    8,
    6,
    "Which ACE inhibitor effect comes from bradykinin?",
    "The dry cough (and, rarely, angioedema).",
    [2, 4],
  ],
  [
    8,
    9,
    "Which patients should not take an ACE inhibitor?",
    "Pregnant patients and those with bilateral renal artery stenosis.",
    [2, 8],
  ],
  [8, 3, "Brand name of mirexapril?", "Corelix", [2, 6]],
];
for (const [lec, page, front, back, con] of cards) {
  add(lec, {
    type: "flashcard",
    front,
    back,
    explanation: "",
    sources: [src(lec, page, back)],
    tags: ["recall"],
    conceptIds: C(...con),
    difficulty: 1,
  });
}

// ----------------------------------------------------------------------- case
add(7, {
  type: "case",
  vignette:
    "A 64-year-old man with **heart failure** is started on lorvanol. He also has well-controlled asthma. His resting pulse is 58 per minute and his blood pressure is 104/66.",
  questions: [
    {
      type: "multiple_choice",
      prompt: "Which finding is the most worrying before the first dose?",
      options: [
        opt("Pulse of 58 per minute", true),
        opt("Well-controlled asthma"),
        opt("Age 64"),
        opt("Taking tablets"),
      ],
      explanation:
        "A slow pulse and a low-normal pressure are reasons to ask before giving a drug that lowers both.",
    },
    {
      type: "fill_blank",
      text: "Lorvanol is {{1}}-selective, so it can narrow the airways.",
      blanks: [{ answers: ["non"] }],
      explanation: "A non-selective agent blocks beta-2 receptors in the lungs too.",
    },
    {
      type: "select_all",
      prompt: "Which would you monitor after starting?",
      options: [
        opt("Heart rate", true),
        opt("Blood pressure", true),
        opt("Breathing and wheeze", true),
        opt("Hair length"),
      ],
      explanation: "Rate, pressure and breathing cover the main risks here.",
    },
  ],
  sources: [src(7, 17, "Case: heart failure, asthma, pulse 58.")],
  tags: ["case", "safety"],
  conceptIds: C(1, 3, 4),
  difficulty: 3,
});
add(8, {
  type: "case",
  vignette:
    "A 52-year-old woman with **hypertension** started mirexapril 10 mg daily two weeks ago. She now has a dry, irritating cough. Her potassium is 5.4 mmol/L and she takes a potassium supplement.",
  questions: [
    {
      type: "multiple_choice",
      prompt: "What most likely explains the cough?",
      options: [
        opt("Bradykinin build-up", true),
        opt("A chest infection only"),
        opt("Low potassium"),
        opt("Allergy to the tablet colour"),
      ],
      explanation: "The cough is a class effect of ACE inhibitors.",
    },
    {
      type: "calculation",
      prompt: "She is given {doses} doses of 10 mg over the next period. What is the total in mg?",
      answer: {
        kind: "expression",
        expression: "doses * 10",
        variables: { doses: { kind: "list", values: [5, 7, 14] } },
      },
      units: ["mg"],
      explanation: "{doses} x 10 mg = {answer}.",
    },
    {
      type: "free_response",
      prompt: "Explain what you would recommend about the potassium supplement.",
      modelAnswer:
        "Stop or review the supplement, because the ACE inhibitor already raises potassium; recheck potassium and creatinine.",
      rubric: [
        { point: "Says to stop or review the supplement", points: 2 },
        { point: "Links it to potassium rise with ACE inhibitors", points: 1 },
        { point: "Rechecks potassium and creatinine", points: 1 },
      ],
      explanation: "A raised potassium on an ACE inhibitor should not be topped up.",
    },
  ],
  sources: [src(8, 10, "Case: cough, potassium 5.4, on supplement.")],
  tags: ["case", "adverse-effects"],
  conceptIds: C(2, 4, 8),
  difficulty: 3,
});
add(8, {
  type: "case",
  vignette:
    "A 70-year-old man with **heart failure** takes valdopril and lorvanol. He asks why he needs both.",
  questions: [
    {
      type: "matching",
      prompt: "Match each drug to what it does here.",
      pairs: [
        { left: "valdopril", right: "Lowers angiotensin II" },
        { left: "lorvanol", right: "Lowers heart rate" },
      ],
      distractors: ["Raises potassium on purpose"],
      explanation:
        "They act on different systems, which is why they are often combined in heart failure.",
    },
    {
      type: "multiple_choice",
      prompt: "Which lab would you check first after a dose increase of valdopril?",
      options: [opt("Potassium and creatinine", true), opt("Vitamin B12"), opt("Haemoglobin A1c")],
      explanation: "Potassium and kidney function can move within days.",
    },
  ],
  sources: [src(8, 15, "Heart failure: ACE inhibitor plus beta-blocker.")],
  tags: ["case"],
  conceptIds: C(1, 2, 3),
  difficulty: 2,
});

// -------------------------------------------------------------- free response
add(7, {
  type: "free_response",
  prompt: "Explain why lorvanol is used in heart failure.",
  modelAnswer:
    "It lowers heart rate and oxygen demand, and over time reduces harmful remodelling of the heart.",
  rubric: [
    { point: "Lowers heart rate", points: 1 },
    { point: "Lowers oxygen demand", points: 1 },
    { point: "Reduces remodelling", points: 2 },
  ],
  explanation: "Started low and raised slowly, because it can worsen heart failure at first.",
  sources: [src(7, 18, "Heart failure: reduces remodelling and mortality; start low.")],
  tags: ["pharmacology"],
  conceptIds: C(1, 3),
  difficulty: 3,
});
add(8, {
  type: "free_response",
  prompt: "Describe how an ACE inhibitor lowers blood pressure.",
  modelAnswer:
    "It blocks the enzyme that makes angiotensin II, so there is less vasoconstriction and less aldosterone, so less salt and water retention.",
  rubric: [
    { point: "Blocks ACE / less angiotensin II", points: 2 },
    { point: "Less vasoconstriction", points: 1 },
    { point: "Less aldosterone, so less salt and water retained", points: 1 },
  ],
  explanation: "Both vessel tone and volume fall.",
  sources: [src(8, 4, "ACE inhibitors: less AII, less aldosterone, vasodilation.")],
  tags: ["mechanism"],
  conceptIds: C(2, 7),
  difficulty: 2,
});
add(8, {
  type: "free_response",
  prompt: "A patient on an ACE inhibitor has a new dry cough. What would you tell her?",
  modelAnswer:
    "The cough is a known effect caused by bradykinin; it is not dangerous but is a reason to talk to the prescriber, who may change to a different class.",
  rubric: [
    { point: "Names it as a known drug effect", points: 1 },
    { point: "Mentions bradykinin", points: 1 },
    { point: "Suggests contacting the prescriber about changing", points: 1 },
  ],
  explanation: "The cough usually resolves after stopping the drug.",
  sources: [src(8, 6, "Cough: change to a different class if troublesome.")],
  tags: ["adverse-effects"],
  conceptIds: C(2, 4),
  difficulty: 2,
});

// -------------------------------------------------------------------- export
const NOW = "2026-11-01T09:00:00.000Z";

function build(): practice.Question[] {
  return raw.map(({ n, lecture, q }) => {
    const checked = practice.validateQuestionInput(q);
    if (!checked.ok) {
      throw new Error(`Bank question ${n} is invalid: ${JSON.stringify(checked.problems)}`);
    }
    const id = fid("qst", n);
    LECTURE_OF[id] = lecture;
    return practice.toStoredQuestion(checked.question, {
      id,
      now: NOW,
      author: { type: "user", userId: fid("usr", 1) },
    });
  });
}

export const BANK: practice.Question[] = build();

export function nodesOf(questionId: string): string[] {
  const lecture = LECTURE_OF[questionId];
  return lecture === 7 ? [NODE_L7, NODE_COURSE] : [NODE_L8, NODE_COURSE];
}
export function nodeOf(id: string): NodeInfo | undefined {
  return NODES.find((n) => n.id === id);
}
