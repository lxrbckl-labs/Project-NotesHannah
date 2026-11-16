// Study guides for the Pharmacology II lectures: adrenergic agonists and beta blockers.
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

export function adrenergicGuide({ c, concept, q }) {
  const s3cat = c(
    "adr",
    3,
    "Catecholamines: epinephrine, norepinephrine, dopamine, dobutamine, isoproterenol",
  );
  const s3comt = c("adr", 3, "Broken down by MAO and COMT: short acting, not given orally");
  const s3non = c("adr", 3, "Not COMT substrates: longer acting, several are oral");
  const s4epi = c(
    "adr",
    4,
    "Epinephrine | alpha-1, alpha-2, beta-1, beta-2 | Raises heart rate and contractility; bronchodilates; vasoconstricts at high doses",
  );
  const s4ne = c(
    "adr",
    4,
    "Norepinephrine | alpha-1, alpha-2, beta-1 (little beta-2) | Strong vasoconstriction; reflex slowing of heart rate is possible",
  );
  const s4dob = c("adr", 4, "Dobutamine | Mainly beta-1 | Inotrope: raises contractility");
  const s4phe = c("adr", 4, "Phenylephrine | alpha-1 | Vasoconstriction; reflex bradycardia");
  const s4alb = c("adr", 4, "Albuterol | beta-2 | Bronchodilation");
  const s4clo = c("adr", 4, "Clonidine | alpha-2 (central) | Lowers sympathetic outflow");
  const s5 = c("adr", 5, "High dose: alpha-1, vasoconstriction");
  const s5low = c("adr", 5, "Low dose: D1 receptors, renal and mesenteric vasodilation");
  const s5mid = c("adr", 5, "Intermediate dose: beta-1, more contractility and heart rate");
  const s5renal = c("adr", 5, "So-called renal-dose dopamine does not protect the kidneys");
  const s5n = c("adr", 5, "below about 3, about 3 to 10, and above 10 mcg/kg/min");
  const s6sep = c("adr", 6, "Septic shock: norepinephrine is the first-choice vasopressor");
  const s6ana = c(
    "adr",
    6,
    "Anaphylaxis: epinephrine IM into the anterolateral thigh, first and without delay",
  );
  const s6add = c(
    "adr",
    6,
    "Antihistamines and corticosteroids are add-ons, never a substitute for epinephrine",
  );
  const s6card = c("adr", 6, "Cardiogenic shock with low output: dobutamine adds contractility");
  const s7alb = c(
    "adr",
    7,
    "Albuterol (SABA) | Onset within minutes, lasts 4 to 6 hours | Reliever (rescue) inhaler",
  );
  const s7sal = c(
    "adr",
    7,
    "Salmeterol (LABA) | Lasts about 12 hours, slower onset | Maintenance; never alone in asthma",
  );
  const s7for = c(
    "adr",
    7,
    "Formoterol (LABA) | Fast onset, lasts about 12 hours | Maintenance; with budesonide as reliever too",
  );
  const s7ae = c(
    "adr",
    7,
    "Adverse effects of beta-2 agonists: tremor, tachycardia, hypokalaemia and hyperglycaemia.",
  );
  const s7ics = c("adr", 7, "In asthma a LABA is always paired with an inhaled corticosteroid.");
  const s8phe = c(
    "adr",
    8,
    "Phenylephrine (alpha-1): nasal decongestant, hypotension during anaesthesia, mydriasis",
  );
  const s8pse = c(
    "adr",
    8,
    "Pseudoephedrine: oral decongestant, sold behind the counter; can raise blood pressure",
  );
  const s8oxy = c(
    "adr",
    8,
    "Oxymetazoline: topical decongestant; rebound congestion if used more than 3 days",
  );
  const s8mid = c(
    "adr",
    8,
    "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
  );
  const s8clo = c(
    "adr",
    8,
    "Clonidine (alpha-2): hypertension, ADHD, withdrawal symptoms; rebound hypertension if stopped suddenly",
  );
  const s8md = c("adr", 8, "Methyldopa (alpha-2): hypertension in pregnancy");
  const s9 = c("adr", 9, "Ephedrine: direct agonist and releaser (mixed acting)");
  const s9amp = c("adr", 9, "Amphetamine: releases stored NE and dopamine");
  const s9coc = c("adr", 9, "Cocaine: blocks NE reuptake (NET)");
  const s10ana = c(
    "adr",
    10,
    "0.3 to 0.5 mg IM (1 mg/mL) in the thigh; repeat every 5 to 15 minutes if needed",
  );
  const s10arr = c("adr", 10, "1 mg IV or IO every 3 to 5 minutes");
  const s10alb = c("adr", 10, "1 to 2 puffs (90 mcg per puff) every 4 to 6 hours as needed");
  const s10clo = c("adr", 10, "0.1 mg PO twice daily to start");
  const s10mid = c(
    "adr",
    10,
    "2.5 to 10 mg PO three times daily while upright; last dose at least 4 hours before bedtime",
  );
  const s10n = c("adr", 10, "The 1 mg/mL strength is for IM use only, never IV push.");

  return [
    h(2, "Start from the receptor"),
    p(
      "Every adrenergic agonist is easiest to learn as a list of receptors. Once you know which receptors a drug hits, its effects and side effects follow from the receptor table of lecture 7.",
      [s4epi],
    ),
    compare(
      "Receptor profile of the main agonists",
      ["Receptors", "What you see"],
      [
        [
          "Epinephrine",
          "alpha-1, alpha-2, beta-1, beta-2",
          "Faster, stronger heart; bronchodilation; vasoconstriction at high dose",
        ],
        [
          "Norepinephrine",
          "alpha-1, alpha-2, beta-1",
          cited("Strong vasoconstriction; reflex slowing of the heart", [s4ne]),
        ],
        ["Dobutamine", "Mainly beta-1", "Stronger contraction (inotrope)"],
        ["Phenylephrine", "alpha-1", cited("Vasoconstriction; reflex bradycardia", [s4phe])],
        ["Albuterol", "beta-2", "Bronchodilation"],
        ["Clonidine", "alpha-2, central", cited("Less sympathetic outflow", [s4clo])],
      ],
      [s4epi, s4ne, s4dob, s4alb],
    ),
    callout(
      "exam_tip",
      "Reflex bradycardia",
      "A pure alpha-1 agonist (phenylephrine) raises blood pressure with nothing to push the heart rate up, so the baroreceptor reflex slows the heart. Norepinephrine can do the same, because its beta-1 effect is modest next to the rise in pressure.",
      [s4phe, s4ne],
    ),
    h(2, "Catecholamines vs non-catecholamines"),
    compare(
      undefined,
      ["Examples", "Broken down by", "By mouth?"],
      [
        [
          "Catecholamines",
          "Epinephrine, norepinephrine, dopamine, dobutamine",
          "MAO and COMT",
          "No: IV, IM, inhaled",
        ],
        [
          "Non-catecholamines",
          "Phenylephrine, pseudoephedrine, albuterol",
          "Not COMT",
          "Several are oral",
        ],
      ],
      [s3cat, s3comt, s3non],
    ),
    h(2, "Dopamine depends on the dose"),
    ol(
      [
        "Low dose: D1, renal and mesenteric vasodilation",
        "Intermediate: beta-1, more contractility and heart rate",
        "High: alpha-1, vasoconstriction",
      ],
      [s5low, s5mid, s5],
      {
        flags: [
          {
            kind: "uncertain",
            quote: "Low dose",
            note: "The slide gives the cut-offs only in the speaker notes and says they vary.",
          },
        ],
      },
    ),
    callout(
      "warning",
      "Renal-dose dopamine",
      "It does not protect the kidneys. The teaching bands in the notes are below about 3, about 3 to 10 and above 10 mcg/kg/min, and they vary between references.",
      [s5renal, s5n],
      {
        flags: [
          { kind: "dose", quote: "above 10 mcg/kg/min", note: "Bands differ between references." },
        ],
      },
    ),
    divider(),
    h(2, "Shock and anaphylaxis"),
    table(
      [
        ["Situation", "Agent", "Why"],
        ["Septic shock", "Norepinephrine", "First-choice vasopressor"],
        ["Cardiogenic shock, low output", "Dobutamine", "Adds contractility"],
        [
          "Anaphylaxis",
          "Epinephrine IM, thigh",
          "Treats every part of the reaction; first, without delay",
        ],
      ],
      [s6sep, s6card, s6ana],
    ),
    drugCard(
      {
        name: "epinephrine",
        concept: concept("drug", "epinephrine"),
        brandNames: ["EpiPen"],
        drugClass: "Catecholamine; alpha and beta agonist",
        mechanism: cited("Agonist at alpha-1, alpha-2, beta-1 and beta-2 receptors", [s4epi]),
        indications: [
          cited("Anaphylaxis (first line)", [s6ana]),
          cited("Cardiac arrest", [s10arr]),
        ],
        adverseEffects: [
          gk("Tachycardia, palpitations"),
          gk("Anxiety, tremor"),
          gk("Hypertension"),
        ],
        counselling: [
          gk(
            "Auto-injector: outer thigh, through clothing if needed, then call emergency services",
          ),
        ],
        dosingNotes: [
          cited(
            "Anaphylaxis: 0.3 to 0.5 mg IM of the 1 mg/mL strength, repeat every 5 to 15 minutes if needed",
            [s10ana],
            [
              {
                kind: "dose",
                quote: "0.3 to 0.5 mg IM",
                note: "Check concentration: 1 mg/mL for IM.",
              },
            ],
          ),
          cited("Cardiac arrest: 1 mg IV or IO every 3 to 5 minutes", [s10arr]),
          cited("1 mg/mL is never pushed IV", [s10n]),
        ],
      },
      [s4epi],
      { style: { color: "red" } },
    ),
    callout(
      "important",
      "Epinephrine first",
      "Antihistamines and corticosteroids are add-ons. They never replace or delay IM epinephrine.",
      [s6add],
    ),
    divider(),
    h(2, "Beta-2 agonists"),
    table(
      [
        ["Drug", "Profile", "Role"],
        ["Albuterol (SABA)", "Works in minutes, lasts 4 to 6 h", "Reliever"],
        ["Salmeterol (LABA)", "About 12 h, slower onset", "Maintenance, never alone in asthma"],
        [
          "Formoterol (LABA)",
          "Fast onset, about 12 h",
          "Maintenance; with budesonide also as reliever",
        ],
      ],
      [s7alb, s7sal, s7for],
    ),
    ul(["Tremor", "Tachycardia", "Hypokalaemia", "Hyperglycaemia"], [s7ae]),
    callout(
      "important",
      "LABA in asthma",
      "Always with an inhaled corticosteroid, never on its own.",
      [s7ics],
    ),
    h(2, "Alpha agonists"),
    compare(
      undefined,
      ["Receptor", "Use", "Watch for"],
      [
        [
          "Phenylephrine",
          "alpha-1",
          "Decongestant, hypotension in anaesthesia, mydriasis",
          "Reflex bradycardia",
        ],
        [
          "Pseudoephedrine",
          "Mostly indirect",
          "Oral decongestant (behind the counter)",
          "Raised blood pressure",
        ],
        [
          "Oxymetazoline",
          "alpha-1 and alpha-2",
          "Nasal spray",
          cited("Rebound congestion after 3 days", [s8oxy]),
        ],
        [
          "Midodrine",
          "alpha-1 (prodrug)",
          "Orthostatic hypotension",
          cited("Supine hypertension", [s8mid]),
        ],
        [
          "Clonidine",
          "alpha-2, central",
          "Hypertension, ADHD, withdrawal",
          cited("Rebound hypertension if stopped suddenly", [s8clo]),
        ],
        ["Methyldopa", "alpha-2, central", cited("Hypertension in pregnancy", [s8md]), "Sedation"],
      ],
      [s8phe, s8pse],
    ),
    p(
      [
        { text: "Indirect agents change how much NE reaches the receptor: " },
        { text: "amphetamine", bold: true },
        { text: " releases it, " },
        { text: "cocaine", bold: true },
        { text: " blocks its reuptake, and " },
        { text: "ephedrine", bold: true },
        { text: " does both jobs at once (mixed acting)." },
      ],
      [s9amp, s9coc, s9],
    ),
    h(2, "Doses at a glance"),
    table(
      [
        ["Drug", "Setting", "Dose"],
        ["Epinephrine", "Anaphylaxis", "0.3 to 0.5 mg IM (1 mg/mL), repeat every 5 to 15 min"],
        ["Epinephrine", "Cardiac arrest", "1 mg IV or IO every 3 to 5 min"],
        ["Albuterol inhaler", "Symptoms", "1 to 2 puffs (90 mcg each) every 4 to 6 h as needed"],
        ["Clonidine", "Hypertension", "0.1 mg PO twice daily to start"],
        ["Midodrine", "Orthostatic hypotension", "2.5 to 10 mg PO three times daily, upright"],
      ],
      [s10ana, s10arr, s10alb, s10clo, s10mid],
      {
        flags: [
          { kind: "decimal", quote: "0.1 mg PO twice daily", note: "Check the decimal." },
          { kind: "dose", quote: "0.3 to 0.5 mg IM (1 mg/mL)", note: "IM strength only." },
        ],
      },
    ),
    mindMap(
      node("Adrenergic agonists", [
        node(
          "Mixed alpha and beta",
          [node("epinephrine"), node("norepinephrine"), node("dopamine")],
          "red",
        ),
        node(
          "beta selective",
          [node("dobutamine (beta-1)"), node("albuterol (beta-2)"), node("salmeterol (beta-2)")],
          "blue",
        ),
        node("alpha-1", [node("phenylephrine"), node("midodrine")], "orange"),
        node("alpha-2", [node("clonidine"), node("methyldopa")], "purple"),
        node("Indirect", [node("amphetamine"), node("cocaine"), node("ephedrine (mixed)")], "gray"),
      ]),
      [s4epi, s8phe, s8clo, s9],
    ),
    question(q("adr-shock")),
    checklist([
      "Write the receptor profile of the six main agonists from memory",
      "Know the anaphylaxis dose and route cold",
      { text: "Review beta-2 agonist adverse effects", checked: true },
    ]),
  ];
}

export function betaGuide({ c, concept, page, q }) {
  const s3 = c("beta", 3, "Competitive antagonists at beta receptors");
  const s3b1 = c("beta", 3, "Beta-1 blockade: lower heart rate, contractility and AV conduction");
  const s3ren = c("beta", 3, "Less renin release from the kidney");
  const s3net = c(
    "beta",
    3,
    "Net effect: lower cardiac output, blood pressure and myocardial oxygen demand",
  );
  const s4ns = c(
    "beta",
    4,
    "Non-selective (beta-1 and beta-2) | Propranolol, nadolol, timolol | Avoid in asthma",
  );
  const s4cs = c(
    "beta",
    4,
    "Beta-1 selective (cardioselective) | Atenolol, metoprolol, bisoprolol, esmolol | Selectivity is lost at high doses",
  );
  const s4neb = c(
    "beta",
    4,
    "Beta-1 selective with vasodilation | Nebivolol | Nitric oxide-mediated vasodilation",
  );
  const s4mix = c(
    "beta",
    4,
    "Mixed alpha-1 and beta | Carvedilol, labetalol | Extra vasodilation from alpha-1 blockade",
  );
  const s4isa = c(
    "beta",
    4,
    "Intrinsic sympathomimetic activity | Pindolol, acebutolol | Less slowing of the resting heart rate",
  );
  const s4n = c("beta", 4, "Cardioselective does not mean cardiac-only.");
  const s5pro = c("beta", 5, "Propranolol | High | Hepatic, large first-pass effect | 3 to 6 h");
  const s5met = c("beta", 5, "Metoprolol | Moderate | Hepatic (CYP2D6) | 3 to 7 h");
  const s5ate = c("beta", 5, "Atenolol | Low | Renal | 6 to 7 h");
  const s5nad = c("beta", 5, "Nadolol | Low | Renal | 20 to 24 h");
  const s5esm = c("beta", 5, "Esmolol | Low | Red blood cell esterases | About 9 minutes");
  const s5car = c("beta", 5, "Carvedilol | High | Hepatic (CYP2D6, CYP2C9) | 7 to 10 h");
  const s5n = c(
    "beta",
    5,
    "Lipophilic agents reach the brain: vivid dreams and sleep disturbance are more common with propranolol.",
  );
  const s5ren = c("beta", 5, "Renally cleared atenolol and nadolol accumulate in kidney disease.");
  const s6hf = c("beta", 6, "HFrEF: only bisoprolol, carvedilol and metoprolol succinate");
  const s6 = c("beta", 6, "Rate control in atrial fibrillation");
  const s6ang = c("beta", 6, "Angina and after myocardial infarction");
  const s6htn = c("beta", 6, "Hypertension, mainly when there is a compelling indication");
  const s6pro = c(
    "beta",
    6,
    "Propranolol: migraine prevention, essential tremor, symptoms of hyperthyroidism",
  );
  const s6tim = c("beta", 6, "Timolol eye drops for glaucoma");
  const s7brady = c("beta", 7, "Bradycardia, AV block, hypotension");
  const s7bronch = c("beta", 7, "Bronchospasm in asthma, especially with non-selective agents");
  const s7hypo = c(
    "beta",
    7,
    "Masks warning signs of hypoglycaemia (tremor, palpitations); sweating still occurs",
  );
  const s7wd = c(
    "beta",
    7,
    "Abrupt withdrawal: rebound tachycardia, angina, even myocardial infarction",
  );
  const s7fat = c("beta", 7, "Fatigue and reduced exercise tolerance");
  const s8hb = c(
    "beta",
    8,
    "Severe bradycardia or second- or third-degree heart block without a pacemaker",
  );
  const s8shock = c("beta", 8, "Cardiogenic shock and acutely decompensated heart failure");
  const s8asth = c(
    "beta",
    8,
    "Asthma: avoid non-selective agents; a cardioselective agent at low dose if one is needed",
  );
  const s9ver = c("beta", 9, "Verapamil or diltiazem: additive bradycardia and AV block");
  const s9clo = c("beta", 9, "Clonidine: stop the beta blocker first when withdrawing both");
  const s9cyp = c("beta", 9, "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels");
  const s9nsaid = c("beta", 9, "NSAIDs blunt the blood pressure effect");
  const s10tart = c("beta", 10, "Metoprolol tartrate | 25 to 50 mg | Twice daily");
  const s10succ = c("beta", 10, "Metoprolol succinate ER | 25 to 100 mg | Once daily");
  const s10ate = c("beta", 10, "Atenolol | 25 to 50 mg | Once daily");
  const s10car = c("beta", 10, "Carvedilol | 6.25 mg | Twice daily with food");
  const s10bis = c("beta", 10, "Bisoprolol | 2.5 to 5 mg | Once daily");
  const s10pro = c("beta", 10, "Propranolol | 40 mg | Twice daily");
  const s10neb = c("beta", 10, "Nebivolol | 5 mg | Once daily");
  const s11taper = c("beta", 11, "Do not stop suddenly: taper over 1 to 2 weeks");
  const s11food = c("beta", 11, "Take carvedilol with food to reduce dizziness");
  const s11pulse = c("beta", 11, "Check your pulse; report a heart rate that stays below 50");
  const n1 = c("hand", 1, "* only 3 for HFrEF: carvedilol,");
  const n3 = c("hand", 3, "Q for office hrs: why is carvedilol target");

  const metoprolol = concept("drug", "metoprolol succinate");
  const carvedilol = concept("drug", "carvedilol");
  return [
    h(2, "How they work"),
    p(
      [
        { text: "Beta blockers are " },
        { text: "competitive antagonists", bold: true },
        {
          text: " at beta receptors. Blocking beta-1 slows the heart, weakens contraction and slows AV conduction; blocking renin release lowers blood pressure further.",
        },
        { cite: 1 },
      ],
      [s3, s3b1, s3ren],
    ),
    callout(
      "info",
      "Net effect",
      "Lower cardiac output, lower blood pressure and lower myocardial oxygen demand: the reason they help in angina and after a heart attack.",
      [s3net],
    ),
    h(2, "Classification"),
    table(
      [
        ["Group", "Examples", "Point to remember"],
        ["Non-selective", "Propranolol, nadolol, timolol", "Avoid in asthma"],
        [
          "Beta-1 selective",
          "Atenolol, metoprolol, bisoprolol, esmolol",
          "Selectivity fades at high doses",
        ],
        ["Beta-1 selective + NO", "Nebivolol", "Vasodilates"],
        ["Mixed alpha-1 and beta", "Carvedilol, labetalol", "Extra vasodilation"],
        ["ISA", "Pindolol, acebutolol", "Less resting bradycardia"],
      ],
      [s4ns, s4cs, s4neb, s4mix, s4isa],
    ),
    mnemonic(
      "A to M, then N to Z",
      "Which beta blockers are cardioselective",
      [
        [
          "A to M",
          "Mostly beta-1 selective: atenolol, bisoprolol, esmolol, metoprolol (acebutolol too)",
        ],
        ["N to Z", "Mostly non-selective: nadolol, pindolol, propranolol, timolol"],
        [
          "Exceptions",
          "Carvedilol and labetalol block alpha-1 and beta; nebivolol is beta-1 selective",
        ],
      ],
      "A rough rule only; it fails for the mixed agents.",
      { generalKnowledge: true },
    ),
    callout(
      "warning",
      "Cardioselective is not cardiac-only",
      "At higher doses beta-1 selective drugs block beta-2 as well.",
      [s4n, s4cs],
    ),
    image(
      page("hand", 1),
      "Handwritten notes on beta blocker classes and the three proven in HFrEF",
      "My notes from lecture 10, page 1",
    ),
    h(2, "Pharmacokinetics that matter"),
    compare(
      undefined,
      ["Lipid solubility", "Cleared by", "Half-life"],
      [
        ["Propranolol", "High", "Liver, big first pass", "3 to 6 h"],
        ["Metoprolol", "Moderate", "Liver (CYP2D6)", "3 to 7 h"],
        ["Atenolol", "Low", cited("Kidney", [s5ate]), "6 to 7 h"],
        ["Nadolol", "Low", cited("Kidney", [s5nad]), "20 to 24 h"],
        ["Esmolol", "Low", "Red cell esterases", cited("About 9 minutes", [s5esm])],
        ["Carvedilol", "High", "Liver (CYP2D6, CYP2C9)", "7 to 10 h"],
      ],
      [s5pro, s5met, s5car],
    ),
    ul(
      [
        "Lipophilic (propranolol): vivid dreams, sleep disturbance.",
        "Renally cleared (atenolol, nadolol): accumulate in kidney disease.",
        "Esmolol: minutes-long half-life, so it is an IV drip that can be switched off.",
      ],
      [s5n, s5ren, s5esm],
    ),
    divider(),
    h(2, "Uses"),
    ul(
      [
        "Angina and after myocardial infarction",
        { text: "HFrEF: only bisoprolol, carvedilol, metoprolol succinate", indent: 0 },
        "Rate control in atrial fibrillation",
        "Hypertension, mainly with a compelling indication",
        "Propranolol: migraine prevention, essential tremor, hyperthyroid symptoms",
        "Timolol drops: glaucoma",
      ],
      [s6ang, s6hf, s6, s6htn, s6pro, s6tim],
    ),
    callout(
      "exam_tip",
      "The HFrEF three",
      [
        { text: "Only " },
        { text: "bisoprolol", bold: true },
        { text: ", " },
        { concept: carvedilol, text: "carvedilol" },
        { text: " and " },
        { concept: metoprolol, text: "metoprolol succinate" },
        { text: " have survival data in HFrEF. Metoprolol tartrate is not one of them." },
      ],
      [s6hf, n1],
    ),
    drugCard(
      {
        name: "metoprolol succinate",
        concept: metoprolol,
        brandNames: ["Toprol-XL"],
        drugClass: cited("Beta-1 selective (cardioselective) blocker", [s4cs]),
        mechanism: cited("Competitive beta-1 antagonist", [s3]),
        indications: [
          "Hypertension",
          cited("HFrEF", [s6hf]),
          "Angina",
          cited("Rate control in atrial fibrillation", [s6]),
        ],
        adverseEffects: [cited("Bradycardia, AV block", [s7brady]), cited("Fatigue", [s7fat])],
        contraindications: [
          cited("Second- or third-degree heart block without a pacemaker", [s8hb]),
        ],
        interactions: [
          cited("CYP2D6 inhibitors raise levels", [s9cyp]),
          cited("Verapamil, diltiazem: AV block", [s9ver]),
        ],
        monitoring: ["Heart rate", "Blood pressure"],
        counselling: [cited("Do not stop suddenly", [s11taper])],
        dosingNotes: [
          cited(
            "Hypertension: 25 to 100 mg once daily",
            [s10succ],
            [{ kind: "dose", quote: "25 to 100 mg once daily", note: "Check against the slide." }],
          ),
        ],
      },
      [s4cs],
      { style: { color: "blue" } },
    ),
    drugCard(
      {
        name: "carvedilol",
        concept: carvedilol,
        brandNames: ["Coreg"],
        drugClass: cited("Mixed alpha-1 and beta blocker", [s4mix]),
        mechanism: "Blocks beta-1, beta-2 and alpha-1 receptors",
        indications: ["Hypertension", cited("HFrEF", [s6hf])],
        adverseEffects: ["Dizziness and orthostatic hypotension", cited("Bradycardia", [s7brady])],
        counselling: [
          cited("Take with food", [s11food]),
          cited("Taper; never stop suddenly", [s11taper]),
        ],
        dosingNotes: [
          cited(
            "Hypertension: 6.25 mg twice daily with food to start",
            [s10car],
            [{ kind: "decimal", quote: "6.25 mg", note: "Check the decimal." }],
          ),
          gk("Heart failure starts lower; see the Pharmacotherapy I guide"),
        ],
      },
      [s4mix],
      { style: { color: "purple" } },
    ),
    h(2, "Adverse effects"),
    ul(
      [
        "Bradycardia, AV block, low blood pressure",
        "Fatigue and less exercise tolerance",
        "Bronchospasm, mainly with non-selective drugs",
        {
          text: "Masks the tremor and palpitations of hypoglycaemia; sweating still happens",
          indent: 0,
        },
        "Cold hands and feet, sexual dysfunction",
        "Sudden withdrawal: rebound tachycardia, angina, even MI",
      ],
      [s7brady, s7fat, s7bronch, s7hypo, s7wd],
    ),
    callout(
      "important",
      "Contraindications",
      "Severe bradycardia or second- or third-degree heart block without a pacemaker; cardiogenic shock; acutely decompensated heart failure. In asthma avoid non-selective agents.",
      [s8hb, s8shock, s8asth],
    ),
    mnemonic(
      "BAD",
      "Beta blocker cautions",
      [
        ["B", "Bradycardia and heart block"],
        ["A", "Asthma (non-selective agents)"],
        ["D", "Diabetes on insulin: masked hypoglycaemia"],
      ],
      undefined,
      { generalKnowledge: true },
    ),
    h(3, "Interactions"),
    table(
      [
        ["With", "What happens"],
        ["Verapamil, diltiazem", "Additive bradycardia and AV block"],
        ["Clonidine", "Stop the beta blocker first when withdrawing both"],
        ["Fluoxetine, paroxetine", "CYP2D6 inhibition: more metoprolol"],
        ["NSAIDs", "Less blood pressure lowering"],
      ],
      [s9ver, s9clo, s9cyp, s9nsaid],
    ),
    divider(),
    h(2, "Starting doses for hypertension"),
    table(
      [
        ["Drug", "Start", "How often"],
        ["Metoprolol tartrate", "25 to 50 mg", "Twice daily"],
        ["Metoprolol succinate ER", "25 to 100 mg", "Once daily"],
        ["Atenolol", "25 to 50 mg", "Once daily"],
        ["Bisoprolol", "2.5 to 5 mg", "Once daily"],
        ["Carvedilol", "6.25 mg", "Twice daily with food"],
        ["Propranolol", "40 mg", "Twice daily"],
        ["Nebivolol", "5 mg", "Once daily"],
      ],
      [s10tart, s10succ, s10ate, s10bis, s10car, s10pro, s10neb],
      { flags: [{ kind: "decimal", quote: "6.25 mg", note: "Check the decimal." }] },
    ),
    quote("Do not stop suddenly: taper over 1 to 2 weeks", "Lecture 10, counselling slide", [
      s11taper,
    ]),
    ol(
      [
        "Never stop suddenly; taper over 1 to 2 weeks.",
        "Take carvedilol with food.",
        "Get up slowly from sitting or lying.",
        "Check your pulse and report one that stays below 50.",
      ],
      [s11taper, s11food, s11pulse],
    ),
    callout(
      "tip",
      "My office-hours question",
      "Why is the carvedilol target 50 mg twice daily above 85 kg? The heart failure lecture lists the same cut-off as part of the target dose. Still worth asking where it comes from.",
      [n3, c("hf", 7, "25 mg twice daily (50 mg twice daily if over 85 kg)")],
    ),
    question(q("beta-hfref")),
    checklist([
      { text: "Classify 12 beta blockers by selectivity", checked: true },
      "Explain masked hypoglycaemia to a classmate",
      "Memorise the HFrEF three and their target doses",
    ]),
  ];
}
