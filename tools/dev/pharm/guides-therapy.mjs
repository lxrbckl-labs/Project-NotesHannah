// Study guides for the Pharmacotherapy I lectures: hypertension and heart failure (HFrEF).
import {
  callout,
  checklist,
  cited,
  compare,
  divider,
  drugCard,
  gk,
  h,
  image,
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

export function hypertensionGuide({ c, concept, page, q }) {
  const s3n = c("htn", 3, "Normal | Below 120 | and | Below 80");
  const s3e = c("htn", 3, "Elevated | 120 to 129 | and | Below 80");
  const s3s1 = c("htn", 3, "Stage 1 hypertension | 130 to 139 | or | 80 to 89");
  const s3s2 = c("htn", 3, "Stage 2 hypertension | 140 or higher | or | 90 or higher");
  const s3hi = c(
    "htn",
    3,
    "When systolic and diastolic fall in different categories, use the higher category.",
  );
  const s3cr = c("htn", 3, "A reading above 180/120 mm Hg is a hypertensive crisis.");
  const s4 = c("htn", 4, "Seated and resting for at least 5 minutes, back supported, feet flat");
  const s4arm = c("htn", 4, "Arm supported at heart level, correct cuff size");
  const s4caf = c("htn", 4, "No caffeine, exercise or smoking for 30 minutes before");
  const s4avg = c("htn", 4, "Average at least 2 readings on at least 2 occasions");
  const s4home = c("htn", 4, "Confirm with home or ambulatory readings");
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
  const s5c = c("htn", 5, "Stage 2: lifestyle plus a drug");
  const s5two = c(
    "htn",
    5,
    "Start two first-line drugs of different classes if BP is more than 20/10 mm Hg above goal",
  );
  const s5goal = c("htn", 5, "Goal for most adults: below 130/80 mm Hg");
  const s6w = c("htn", 6, "Weight loss | About 1 mm Hg for every kg lost");
  const s6d = c("htn", 6, "DASH eating pattern | About 11 mm Hg");
  const s6na = c("htn", 6, "Less sodium (ideally below 1500 mg a day) | 5 to 6 mm Hg");
  const s6k = c("htn", 6, "More dietary potassium (3500 to 5000 mg a day) | 4 to 5 mm Hg");
  const s6ex = c("htn", 6, "Aerobic exercise, 90 to 150 minutes a week | 5 to 8 mm Hg");
  const s6al = c("htn", 6, "Alcohol: at most 2 drinks a day (men) or 1 (women) | About 4 mm Hg");
  const s6n = c(
    "htn",
    6,
    "Effects are roughly additive and are larger in people who already have hypertension.",
  );
  const s7 = c("htn", 7, "Thiazide-type diuretics (chlorthalidone preferred)");
  const s7acei = c("htn", 7, "ACE inhibitors");
  const s7arb = c("htn", 7, "Angiotensin receptor blockers (ARBs)");
  const s7ccb = c("htn", 7, "Dihydropyridine calcium channel blockers");
  const s7black = c(
    "htn",
    7,
    "Black adults without heart failure or CKD: start with a thiazide or a calcium channel blocker",
  );
  const s7never = c("htn", 7, "Never combine an ACE inhibitor with an ARB");
  const s7bb = c("htn", 7, "Beta blockers are not first line for uncomplicated hypertension.");
  const s8hf = c(
    "htn",
    8,
    "HFrEF | Guideline-directed therapy: ARNI, ACE inhibitor or ARB; evidence-based beta blocker; MRA",
  );
  const s8ckd = c("htn", 8, "CKD with albuminuria | ACE inhibitor or ARB");
  const s8dm = c("htn", 8, "Diabetes with albuminuria | ACE inhibitor or ARB");
  const s8ihd = c(
    "htn",
    8,
    "Stable ischaemic heart disease or previous MI | Beta blocker plus ACE inhibitor or ARB",
  );
  const s8preg = c(
    "htn",
    8,
    "Pregnancy | Labetalol or nifedipine; avoid ACE inhibitors, ARBs and aliskiren",
  );
  const s9thz = c(
    "htn",
    9,
    "Thiazide | Chlorthalidone, hydrochlorothiazide | Low potassium and sodium, high uric acid (gout), high glucose | Electrolytes, uric acid",
  );
  const s9acei = c(
    "htn",
    9,
    "ACE inhibitor | Lisinopril, enalapril | Dry cough, high potassium, angioedema, rise in creatinine | Serum creatinine, potassium",
  );
  const s9arb = c(
    "htn",
    9,
    "ARB | Losartan, valsartan | High potassium, rise in creatinine; no cough | Serum creatinine, potassium",
  );
  const s9dhp = c(
    "htn",
    9,
    "Dihydropyridine CCB | Amlodipine, nifedipine ER | Ankle oedema, headache, flushing | Blood pressure, oedema",
  );
  const s9non = c(
    "htn",
    9,
    "Non-dihydropyridine CCB | Diltiazem, verapamil | Bradycardia, constipation (verapamil) | Heart rate; avoid in HFrEF",
  );
  const s10chl = c("htn", 10, "Chlorthalidone | Thalitone | 12.5 mg once daily | 12.5 to 25 mg");
  const s10hct = c(
    "htn",
    10,
    "Hydrochlorothiazide | Microzide | 12.5 to 25 mg once daily | 25 to 50 mg",
  );
  const s10lis = c("htn", 10, "Lisinopril | Zestril, Prinivil | 10 mg once daily | 10 to 40 mg");
  const s10los = c("htn", 10, "Losartan | Cozaar | 50 mg once daily | 50 to 100 mg");
  const s10val = c("htn", 10, "Valsartan | Diovan | 80 to 160 mg once daily | 80 to 320 mg");
  const s10aml = c("htn", 10, "Amlodipine | Norvasc | 5 mg once daily | 2.5 to 10 mg");
  const s10n = c(
    "htn",
    10,
    "Start lower (for example lisinopril 5 mg) in older adults, in volume depletion or when already on a diuretic.",
  );
  const s11preg = c(
    "htn",
    11,
    "ACE inhibitors, ARBs and aliskiren are fetotoxic: avoid in pregnancy and counsel on contraception",
  );
  const s11ang = c(
    "htn",
    11,
    "History of angioedema with an ACE inhibitor: do not use an ACE inhibitor again",
  );
  const s11ras = c(
    "htn",
    11,
    "Bilateral renal artery stenosis: ACE inhibitors and ARBs can cause acute kidney injury",
  );
  const s11scr = c(
    "htn",
    11,
    "A rise in serum creatinine of up to 30% after starting an ACE inhibitor or ARB is expected",
  );
  const s12a = c("htn", 12, "Recheck monthly until at goal, then every 3 to 6 months");
  const s12b = c(
    "htn",
    12,
    "Check potassium and creatinine within 2 to 4 weeks of starting or raising an ACE inhibitor, ARB or diuretic",
  );
  const s12c = c("htn", 12, "Ask about adherence before adding a drug");
  const s13 = c("htn", 13, "Lifestyle helps every patient");
  const wb = c("board", 1, "1st line HTN drugs (ACC/AHA 2017)");

  return [
    h(2, "Blood pressure categories"),
    table(
      [
        ["Category", "Systolic", "", "Diastolic"],
        ["Normal", "below 120", "and", "below 80"],
        ["Elevated", "120 to 129", "and", "below 80"],
        ["Stage 1", "130 to 139", "or", "80 to 89"],
        ["Stage 2", "140 or higher", "or", "90 or higher"],
      ],
      [s3n, s3e, s3s1, s3s2],
      { caption: "2017 ACC/AHA categories, mm Hg" },
    ),
    callout(
      "exam_tip",
      "Use the higher category",
      "When systolic and diastolic fall in different categories, the higher one wins: 128/84 is stage 1, not elevated.",
      [s3hi],
    ),
    callout("warning", "Hypertensive crisis", "A reading above 180/120 mm Hg.", [s3cr]),
    h(3, "Measuring it properly"),
    ol(
      [
        "Seated and resting at least 5 minutes, back supported, feet flat.",
        "Arm supported at heart level, cuff the right size.",
        "No caffeine, exercise or smoking for 30 minutes before.",
        "Average at least 2 readings on at least 2 occasions.",
        "Confirm with home or ambulatory readings.",
      ],
      [s4, s4arm, s4caf, s4avg, s4home],
    ),
    divider(),
    h(2, "When to start a drug"),
    table(
      [
        ["Situation", "Plan"],
        ["Stage 1, ASCVD or 10-year risk 10% or more", "Lifestyle plus a drug"],
        ["Stage 1, 10-year risk below 10%", "Lifestyle, reassess in 3 to 6 months"],
        ["Stage 2", "Lifestyle plus a drug"],
        ["More than 20/10 above goal", "Two first-line drugs of different classes"],
      ],
      [s5a, s5b, s5c, s5two],
    ),
    callout("important", "Goal", "Below 130/80 mm Hg for most adults.", [s5goal]),
    h(3, "Lifestyle"),
    compare(
      "What each change is worth",
      ["Target", "Systolic fall"],
      [
        ["Weight", "Lose weight", cited("About 1 mm Hg per kg", [s6w])],
        ["DASH diet", "Fruit, vegetables, low-fat dairy", cited("About 11 mm Hg", [s6d])],
        ["Sodium", "Ideally below 1500 mg a day", cited("5 to 6 mm Hg", [s6na])],
        ["Potassium", "3500 to 5000 mg a day from food", cited("4 to 5 mm Hg", [s6k])],
        ["Exercise", "90 to 150 min aerobic a week", cited("5 to 8 mm Hg", [s6ex])],
        ["Alcohol", "2 drinks a day or fewer (men), 1 (women)", cited("About 4 mm Hg", [s6al])],
      ],
      [s6w],
    ),
    p("The effects roughly add up, and are bigger in people who already have hypertension.", [s6n]),
    divider(),
    h(2, "First-line drugs"),
    ul(
      [
        "Thiazide-type diuretic (chlorthalidone preferred)",
        "ACE inhibitor",
        "ARB",
        "Dihydropyridine calcium channel blocker",
        { text: "Black adults without HF or CKD: start with a thiazide or a CCB", indent: 1 },
      ],
      [s7, s7acei, s7arb, s7ccb, s7black, wb],
    ),
    mnemonic(
      "A, C, D",
      "First-line antihypertensive classes",
      [
        ["A", "ACE inhibitor or ARB (Angiotensin)"],
        ["C", "Calcium channel blocker (dihydropyridine)"],
        ["D", "Diuretic (thiazide type)"],
      ],
      "Beta blockers are not on the list unless there is another reason for one.",
      { citations: [s7, s7bb] },
    ),
    callout(
      "warning",
      "Never ACE inhibitor plus ARB",
      "More hyperkalaemia and kidney injury, no extra benefit.",
      [s7never],
    ),
    image(
      page("board", 1),
      "Whiteboard table of first-line hypertension drug classes, an example of each and what to watch for",
      [{ text: "Whiteboard from the review session" }],
    ),
    h(3, "Compelling indications"),
    table(
      [
        ["If the patient has", "Prefer"],
        ["HFrEF", "ARNI or ACE inhibitor or ARB, evidence-based beta blocker, MRA"],
        ["CKD with albuminuria", "ACE inhibitor or ARB"],
        ["Diabetes with albuminuria", "ACE inhibitor or ARB"],
        ["Ischaemic heart disease or past MI", "Beta blocker plus ACE inhibitor or ARB"],
        ["Pregnancy", "Labetalol or nifedipine"],
      ],
      [s8hf, s8ckd, s8dm, s8ihd, s8preg],
    ),
    compare(
      "Adverse effects and monitoring",
      ["Watch for", "Monitor"],
      [
        ["Thiazide", "Low K and Na, high uric acid, high glucose", "Electrolytes, uric acid"],
        [
          "ACE inhibitor",
          "Dry cough, high K, angioedema, creatinine rise",
          "Creatinine, potassium",
        ],
        ["ARB", "High K, creatinine rise; no cough", "Creatinine, potassium"],
        ["Dihydropyridine CCB", "Ankle oedema, headache, flushing", "BP, oedema"],
        ["Diltiazem, verapamil", "Bradycardia, constipation", "Heart rate; avoid in HFrEF"],
      ],
      [s9thz, s9acei, s9arb, s9dhp, s9non],
    ),
    drugCard(
      {
        name: "lisinopril",
        concept: concept("drug", "lisinopril"),
        brandNames: ["Zestril", "Prinivil"],
        drugClass: "ACE inhibitor",
        mechanism: gk(
          "Blocks conversion of angiotensin I to angiotensin II and the breakdown of bradykinin",
        ),
        indications: [
          cited("Hypertension (first line)", [s7acei]),
          cited("CKD or diabetes with albuminuria", [s8ckd, s8dm]),
        ],
        adverseEffects: [
          cited("Dry cough", [s9acei]),
          cited("Hyperkalaemia", [s9acei]),
          cited("Angioedema", [s9acei]),
        ],
        contraindications: [
          cited("Pregnancy", [s11preg]),
          cited("Previous angioedema with an ACE inhibitor", [s11ang]),
          cited("Use with an ARB", [s7never]),
        ],
        monitoring: [cited("Serum creatinine and potassium", [s9acei])],
        counselling: [gk("Report swelling of the lips, tongue or face at once")],
        dosingNotes: [
          cited(
            "10 mg once daily; usual 10 to 40 mg",
            [s10lis],
            [{ kind: "dose", quote: "10 mg once daily", note: "Check against the slide." }],
          ),
          cited("Start at 5 mg in older adults or with a diuretic", [s10n]),
        ],
      },
      [s9acei],
      { style: { color: "green" } },
    ),
    drugCard(
      {
        name: "chlorthalidone",
        concept: concept("drug", "chlorthalidone"),
        brandNames: ["Thalitone"],
        drugClass: cited("Thiazide-type diuretic (preferred)", [s7]),
        indications: ["Hypertension"],
        adverseEffects: [
          cited("Hypokalaemia and hyponatraemia", [s9thz]),
          cited("Hyperuricaemia and gout", [s9thz]),
          cited("Hyperglycaemia", [s9thz]),
        ],
        monitoring: [cited("Electrolytes and uric acid", [s9thz])],
        counselling: [gk("Take in the morning to avoid waking at night to pass urine")],
        dosingNotes: [
          cited(
            "12.5 mg once daily to start; usual 12.5 to 25 mg",
            [s10chl],
            [{ kind: "decimal", quote: "12.5 mg", note: "Check the decimal." }],
          ),
        ],
      },
      [s9thz],
      { style: { color: "teal" } },
    ),
    h(3, "Starting doses"),
    table(
      [
        ["Drug", "Brand", "Start", "Usual range"],
        ["Chlorthalidone", "Thalitone", "12.5 mg daily", "12.5 to 25 mg"],
        ["Hydrochlorothiazide", "Microzide", "12.5 to 25 mg daily", "25 to 50 mg"],
        ["Lisinopril", "Zestril, Prinivil", "10 mg daily", "10 to 40 mg"],
        ["Losartan", "Cozaar", "50 mg daily", "50 to 100 mg"],
        ["Valsartan", "Diovan", "80 to 160 mg daily", "80 to 320 mg"],
        ["Amlodipine", "Norvasc", "5 mg daily", "2.5 to 10 mg"],
      ],
      [s10chl, s10hct, s10lis, s10los, s10val, s10aml],
      { flags: [{ kind: "decimal", quote: "12.5 mg daily", note: "Check the decimal." }] },
    ),
    h(2, "Special situations"),
    ul(
      [
        "Pregnancy: no ACE inhibitor, ARB or aliskiren (fetotoxic); counsel on contraception.",
        "Angioedema on an ACE inhibitor: never again.",
        "Bilateral renal artery stenosis: ACE inhibitors and ARBs can cause acute kidney injury.",
      ],
      [s11preg, s11ang, s11ras],
    ),
    callout(
      "definition",
      "Expected creatinine rise",
      "Up to a 30% rise in serum creatinine after starting an ACE inhibitor or ARB is expected and is not a reason to stop.",
      [s11scr],
    ),
    h(2, "Follow-up"),
    ol(
      [
        "Recheck monthly until at goal, then every 3 to 6 months.",
        "Potassium and creatinine within 2 to 4 weeks of starting or raising an ACE inhibitor, ARB or diuretic.",
        "Ask about adherence before adding another drug.",
      ],
      [s12a, s12b, s12c],
      {
        flags: [
          {
            kind: "uncertain",
            quote: "within 2 to 4 weeks",
            note: "Timing varies between sources.",
          },
        ],
      },
    ),
    mindMap(
      node("Choosing a first drug", [
        node(
          "No compelling indication",
          [node("Thiazide"), node("ACE inhibitor or ARB"), node("DHP CCB")],
          "blue",
        ),
        node("Black adult, no HF or CKD", [node("Thiazide"), node("CCB")], "teal"),
        node("CKD or diabetes with albuminuria", [node("ACE inhibitor or ARB")], "green"),
        node("Pregnancy", [node("Labetalol"), node("Nifedipine")], "pink"),
        node("Previous MI", [node("Beta blocker"), node("ACE inhibitor or ARB")], "red"),
      ]),
      [s7, s7black, s8ckd, s8preg, s8ihd],
    ),
    quote("Lifestyle helps every patient", "Lecture 8, summary slide", [s13]),
    question(q("htn-case")),
    checklist([
      { text: "Classify ten blood pressure readings", checked: true },
      "Match each first-line class with its main adverse effect",
      "Learn the six starting doses",
      "Redo the hypertension case",
    ]),
  ];
}

export function heartFailureGuide({ c, concept, q }) {
  const s3r = c("hf", 3, "HFrEF (reduced) | 40% or less");
  const s3m = c("hf", 3, "HFmrEF (mildly reduced) | 41% to 49%");
  const s3p = c("hf", 3, "HFpEF (preserved) | 50% or more");
  const s3i = c("hf", 3, "HFimpEF (improved) | Was 40% or less, now above 40%");
  const s4 = c("hf", 4, "C | Structural disease with current or past symptoms");
  const s4n = c("hf", 4, "Stages only move forward. NYHA class can improve with treatment.");
  const s4iv = c("hf", 4, "IV | Symptoms at rest");
  const s5 = c(
    "hf",
    5,
    "A failing heart activates the renin-angiotensin-aldosterone system and the sympathetic nervous system",
  );
  const s5res = c(
    "hf",
    5,
    "Result: vasoconstriction, salt and water retention, cardiac remodelling",
  );
  const s5blk = c("hf", 5, "Blocking these systems slows remodelling and improves survival");
  const s5diu = c("hf", 5, "Diuretics relieve congestion but do not improve survival");
  const s6arni = c(
    "hf",
    6,
    "ARNI (or ACE inhibitor or ARB) | Sacubitril/valsartan | Lower mortality and fewer HF hospitalisations",
  );
  const s6bb = c(
    "hf",
    6,
    "Evidence-based beta blocker | Bisoprolol, carvedilol, metoprolol succinate | Lower mortality",
  );
  const s6mra = c(
    "hf",
    6,
    "Mineralocorticoid receptor antagonist (MRA) | Spironolactone, eplerenone | Lower mortality",
  );
  const s6sglt = c(
    "hf",
    6,
    "SGLT2 inhibitor | Dapagliflozin, empagliflozin | Fewer HF hospitalisations and cardiovascular deaths",
  );
  const s6n = c(
    "hf",
    6,
    "Start all four as soon as possible, at low doses, rather than maximising one drug before adding the next.",
  );
  const s7sv = c("hf", 7, "Sacubitril/valsartan | 49/51 mg twice daily | 97/103 mg twice daily");
  const s7lis = c("hf", 7, "Lisinopril | 2.5 to 5 mg once daily | 20 to 40 mg once daily");
  const s7car = c(
    "hf",
    7,
    "Carvedilol | 3.125 mg twice daily | 25 mg twice daily (50 mg twice daily if over 85 kg)",
  );
  const s7met = c("hf", 7, "Metoprolol succinate | 12.5 to 25 mg once daily | 200 mg once daily");
  const s7bis = c("hf", 7, "Bisoprolol | 1.25 mg once daily | 10 mg once daily");
  const s7spi = c("hf", 7, "Spironolactone | 12.5 to 25 mg once daily | 25 to 50 mg once daily");
  const s7sg = c("hf", 7, "Dapagliflozin or empagliflozin | 10 mg once daily | 10 mg once daily");
  const s7n = c("hf", 7, "Beta blocker doses are doubled no more often than every 2 weeks.");
  const s8nep = c("hf", 8, "Sacubitril blocks neprilysin, so natriuretic peptides last longer");
  const s8gap = c("hf", 8, "Stop an ACE inhibitor at least 36 hours before the first dose");
  const s8nev = c("hf", 8, "Never use with an ACE inhibitor or after angioedema");
  const s8watch = c("hf", 8, "Watch blood pressure, potassium and renal function");
  const s8n = c(
    "hf",
    8,
    "The 36-hour gap is there because neprilysin and ACE both break down bradykinin. Together they raise the risk of angioedema.",
  );
  const s9start = c(
    "hf",
    9,
    "Start only if potassium is below 5.0 mEq/L and eGFR is above 30 mL/min/1.73 m2",
  );
  const s9re = c(
    "hf",
    9,
    "Recheck potassium and renal function within about 1 week, then regularly",
  );
  const s9gyn = c("hf", 9, "Spironolactone can cause gynaecomastia; eplerenone rarely does");
  const s9k = c(
    "hf",
    9,
    "Avoid potassium supplements and salt substitutes unless potassium is low",
  );
  const s10loop = c("hf", 10, "Loop diuretics for congestion: furosemide, bumetanide, torsemide");
  const s10eq = c(
    "hf",
    10,
    "furosemide 40 mg PO, furosemide 20 mg IV, bumetanide 1 mg, torsemide 20 mg",
  );
  const s10hisdn = c(
    "hf",
    10,
    "Hydralazine with isosorbide dinitrate: self-identified Black patients with NYHA III to IV on optimal therapy",
  );
  const s10iva = c(
    "hf",
    10,
    "Ivabradine: sinus rhythm with resting heart rate of 70 or more on a maximally tolerated beta blocker",
  );
  const s10dig = c("hf", 10, "Digoxin: fewer hospitalisations, no survival benefit");
  const s11nsaid = c("hf", 11, "NSAIDs: salt and water retention, worse renal function");
  const s11ccb = c(
    "hf",
    11,
    "Non-dihydropyridine calcium channel blockers (diltiazem, verapamil): negative inotropes",
  );
  const s11tzd = c("hf", 11, "Thiazolidinediones (pioglitazone): fluid retention");
  const s11aa = c("hf", 11, "Most antiarrhythmics, except amiodarone and dofetilide");
  const s12 = c("hf", 12, "Start low, titrate every 2 weeks, check potassium and renal function");

  return [
    h(2, "Classify first"),
    table(
      [
        ["Type", "LVEF"],
        ["HFrEF (reduced)", "40% or less"],
        ["HFmrEF (mildly reduced)", "41% to 49%"],
        ["HFpEF (preserved)", "50% or more"],
        ["HFimpEF (improved)", "Was 40% or less, now above 40%"],
      ],
      [s3r, s3m, s3p, s3i],
    ),
    compare(
      "Stage vs NYHA class",
      ["ACC/AHA stage", "NYHA class"],
      [
        ["Describes", "How far the disease has gone", "How limited the patient is today"],
        ["Can it improve?", "No: stages only move forward", "Yes, with treatment"],
        ["Worst", "D: advanced, symptoms despite therapy", cited("IV: symptoms at rest", [s4iv])],
      ],
      [s4, s4n],
    ),
    callout("tip", "One line to remember", "Stages only move forward; NYHA class can get better.", [
      s4n,
    ]),
    h(2, "Why these drugs work"),
    p(
      [
        { text: "A failing heart switches on the " },
        { text: "renin-angiotensin-aldosterone system", bold: true },
        { text: " and the " },
        { text: "sympathetic nervous system", bold: true },
        {
          text: ". In the short term that props up blood pressure; in the long term it causes vasoconstriction, salt and water retention and remodelling. Blocking the two systems slows remodelling and improves survival.",
        },
      ],
      [s5, s5res, s5blk],
    ),
    callout(
      "important",
      "Diuretics are for symptoms",
      "Loop diuretics relieve congestion but do not make patients live longer.",
      [s5diu],
    ),
    divider(),
    h(2, "The four pillars"),
    table(
      [
        ["Pillar", "Examples", "Benefit"],
        [
          "ARNI (or ACE inhibitor or ARB)",
          "Sacubitril/valsartan",
          "Lower mortality, fewer HF admissions",
        ],
        ["Beta blocker", "Bisoprolol, carvedilol, metoprolol succinate", "Lower mortality"],
        ["MRA", "Spironolactone, eplerenone", "Lower mortality"],
        ["SGLT2 inhibitor", "Dapagliflozin, empagliflozin", "Fewer HF admissions and CV deaths"],
      ],
      [s6arni, s6bb, s6mra, s6sglt],
    ),
    mnemonic(
      "A, B, M, S",
      "The four pillars of HFrEF therapy",
      [
        ["A", "ARNI (sacubitril/valsartan), or an ACE inhibitor or ARB"],
        ["B", "Beta blocker: bisoprolol, carvedilol or metoprolol succinate"],
        ["M", "MRA: spironolactone or eplerenone"],
        ["S", "SGLT2 inhibitor: dapagliflozin or empagliflozin"],
      ],
      undefined,
      { citations: [s6arni, s6bb, s6mra, s6sglt] },
    ),
    callout(
      "exam_tip",
      "All four, early, low",
      "Start all four soon and at low doses, instead of pushing one drug to its target before adding the next.",
      [s6n],
    ),
    h(3, "Starting and target doses"),
    table(
      [
        ["Drug", "Start", "Target"],
        ["Sacubitril/valsartan", "49/51 mg twice daily", "97/103 mg twice daily"],
        ["Lisinopril", "2.5 to 5 mg daily", "20 to 40 mg daily"],
        ["Carvedilol", "3.125 mg twice daily", "25 mg twice daily (50 mg if over 85 kg)"],
        ["Metoprolol succinate", "12.5 to 25 mg daily", "200 mg daily"],
        ["Bisoprolol", "1.25 mg daily", "10 mg daily"],
        ["Spironolactone", "12.5 to 25 mg daily", "25 to 50 mg daily"],
        ["Dapagliflozin, empagliflozin", "10 mg daily", "10 mg daily"],
      ],
      [s7sv, s7lis, s7car, s7met, s7bis, s7spi, s7sg],
      {
        flags: [
          { kind: "decimal", quote: "3.125 mg twice daily", note: "Check the decimal." },
          { kind: "decimal", quote: "1.25 mg daily", note: "Check the decimal." },
        ],
      },
    ),
    ol(
      [
        "Start low.",
        "Double a beta blocker no more often than every 2 weeks.",
        "Check potassium and renal function as you go.",
      ],
      [s7n, s12],
    ),
    divider(),
    h(2, "ARNI"),
    drugCard(
      {
        name: "sacubitril/valsartan",
        concept: concept("drug", "sacubitril/valsartan"),
        brandNames: ["Entresto"],
        drugClass: "Angiotensin receptor-neprilysin inhibitor (ARNI)",
        mechanism: cited(
          "Sacubitril blocks neprilysin, so natriuretic peptides last longer; valsartan blocks AT1 receptors",
          [s8nep],
        ),
        indications: [cited("HFrEF", [s6arni])],
        adverseEffects: [gk("Hypotension"), gk("Hyperkalaemia"), cited("Angioedema", [s8n])],
        contraindications: [
          cited("Within 36 hours of an ACE inhibitor", [s8gap]),
          cited("History of angioedema", [s8nev]),
        ],
        monitoring: [cited("Blood pressure, potassium, renal function", [s8watch])],
        dosingNotes: [
          cited(
            "49/51 mg twice daily, target 97/103 mg twice daily",
            [s7sv],
            [{ kind: "dose", quote: "49/51 mg", note: "Combination strength." }],
          ),
        ],
      },
      [s8nep],
      { style: { color: "purple" } },
    ),
    callout(
      "warning",
      "The 36-hour gap",
      "Neprilysin and ACE both break down bradykinin. Blocking both at once raises the risk of angioedema, so stop the ACE inhibitor at least 36 hours before the first ARNI dose.",
      [s8gap, s8n],
    ),
    h(2, "MRA safety"),
    ul(
      [
        "Start only if potassium is below 5.0 mEq/L and eGFR is above 30.",
        "Recheck potassium and renal function within about 1 week, then regularly.",
        "No potassium supplements or salt substitutes unless potassium is low.",
        "Spironolactone can cause gynaecomastia; eplerenone rarely does.",
      ],
      [s9start, s9re, s9k, s9gyn],
      { flags: [{ kind: "unit", quote: "5.0 mEq/L", note: "Check the decimal and the unit." }] },
    ),
    drugCard(
      {
        name: "spironolactone",
        concept: concept("drug", "spironolactone"),
        brandNames: ["Aldactone"],
        drugClass: cited("Mineralocorticoid receptor antagonist", [s6mra]),
        indications: [cited("HFrEF", [s6mra])],
        adverseEffects: [gk("Hyperkalaemia"), cited("Gynaecomastia", [s9gyn])],
        contraindications: [cited("Potassium 5.0 mEq/L or more, or eGFR 30 or less", [s9start])],
        monitoring: [cited("Potassium and renal function within about 1 week", [s9re])],
        dosingNotes: [cited("12.5 to 25 mg once daily; target 25 to 50 mg", [s7spi])],
      },
      [s6mra],
    ),
    drugCard(
      {
        name: "dapagliflozin",
        concept: concept("drug", "dapagliflozin"),
        brandNames: ["Farxiga"],
        drugClass: cited("SGLT2 inhibitor", [s6sglt]),
        indications: [cited("HFrEF, with or without diabetes", [s6sglt])],
        adverseEffects: [gk("Genital fungal infections"), gk("Volume depletion")],
        counselling: [gk("Keep the genital area clean and dry; drink enough fluid")],
        dosingNotes: [cited("10 mg once daily (no titration)", [s7sg])],
      },
      [s6sglt],
      { style: { color: "orange" } },
    ),
    divider(),
    h(2, "Symptoms and add-ons"),
    table(
      [
        ["Loop diuretic", "Roughly equal dose"],
        ["Furosemide PO", "40 mg"],
        ["Furosemide IV", "20 mg"],
        ["Bumetanide", "1 mg"],
        ["Torsemide", "20 mg"],
      ],
      [s10loop, s10eq],
      { flags: [{ kind: "dose", quote: "40 mg", note: "Equivalence is approximate." }] },
    ),
    ul(
      [
        "Hydralazine with isosorbide dinitrate: self-identified Black patients, NYHA III to IV, already on optimal therapy.",
        "Ivabradine: sinus rhythm, resting heart rate 70 or more on the highest tolerated beta blocker.",
        "Digoxin: fewer hospitalisations, no survival benefit.",
      ],
      [s10hisdn, s10iva, s10dig],
    ),
    callout(
      "warning",
      "Drugs that make HFrEF worse",
      "NSAIDs (salt and water retention), diltiazem and verapamil (negative inotropes), pioglitazone (fluid retention), and most antiarrhythmics except amiodarone and dofetilide.",
      [s11nsaid, s11ccb, s11tzd, s11aa],
    ),
    mindMap(
      node("HFrEF regimen", [
        node(
          "Survival",
          [node("ARNI"), node("Beta blocker"), node("MRA"), node("SGLT2 inhibitor")],
          "green",
        ),
        node("Symptoms", [node("Loop diuretic")], "blue"),
        node(
          "Selected patients",
          [node("Hydralazine + ISDN"), node("Ivabradine"), node("Digoxin")],
          "purple",
        ),
        node("Avoid", [node("NSAIDs"), node("Diltiazem, verapamil"), node("Pioglitazone")], "red"),
      ]),
      [s6arni, s10loop, s10iva, s11nsaid],
    ),
    quote(
      "Start all four as soon as possible, at low doses, rather than maximising one drug before adding the next.",
      "Lecture 9, speaker notes",
      [s6n],
    ),
    question(q("hf-case")),
    checklist([
      "Write the four pillars with one drug and one starting dose each",
      { text: "Explain the 36-hour ARNI gap", checked: true },
      "List four drugs to avoid in HFrEF",
    ]),
  ];
}
