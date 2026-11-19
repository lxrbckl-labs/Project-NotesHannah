// The concept map an agent builds from the lectures: drugs (with brand names), classes, mechanisms,
// targets, indications, adverse effects, contraindications, monitoring, counselling points and a few
// others, with relations. A fact on a slide cites it; anything else is marked general knowledge.

export function conceptSet({ c }) {
  const concepts = [];
  const relations = [];
  const cite = (src) => (src ? { citations: [src] } : { generalKnowledge: true });
  const add = (type, name, src, summary, extra = {}) =>
    concepts.push({ type, name, ...(summary ? { summary } : {}), ...cite(src), ...extra });
  const drug = (name, brands, src, summary, extra = {}) =>
    add("drug", name, src, summary, { drug: { brandNames: brands }, ...extra });
  const rel = (from, type, to, src, extra = {}) =>
    relations.push({
      from: { type: from[0], name: from[1] },
      to: { type: to[0], name: to[1] },
      type,
      ...cite(src),
      ...extra,
    });

  // ---- sources used more than once ---------------------------------------------------------------
  const top = (row) => c("top", 1, row);
  const topA = (row) => c("top", 2, row);
  const bClass = c(
    "beta",
    4,
    "Beta-1 selective (cardioselective) | Atenolol, metoprolol, bisoprolol, esmolol | Selectivity is lost at high doses",
  );
  const bNon = c(
    "beta",
    4,
    "Non-selective (beta-1 and beta-2) | Propranolol, nadolol, timolol | Avoid in asthma",
  );
  const bMix = c(
    "beta",
    4,
    "Mixed alpha-1 and beta | Carvedilol, labetalol | Extra vasodilation from alpha-1 blockade",
  );
  const bHf = c("beta", 6, "HFrEF: only bisoprolol, carvedilol and metoprolol succinate");
  const bBrady = c("beta", 7, "Bradycardia, AV block, hypotension");
  const bBronch = c("beta", 7, "Bronchospasm in asthma, especially with non-selective agents");
  const bHypo = c(
    "beta",
    7,
    "Masks warning signs of hypoglycaemia (tremor, palpitations); sweating still occurs",
  );
  const bTaper = c("beta", 11, "Do not stop suddenly: taper over 1 to 2 weeks");
  const hFirst = c("htn", 7, "Thiazide-type diuretics (chlorthalidone preferred)");
  const hAce = c(
    "htn",
    9,
    "ACE inhibitor | Lisinopril, enalapril | Dry cough, high potassium, angioedema, rise in creatinine",
  );
  const hArb = c(
    "htn",
    9,
    "ARB | Losartan, valsartan | High potassium, rise in creatinine; no cough",
  );
  const hThz = c(
    "htn",
    9,
    "Thiazide | Chlorthalidone, hydrochlorothiazide | Low potassium and sodium, high uric acid (gout), high glucose",
  );
  const hDhp = c(
    "htn",
    9,
    "Dihydropyridine CCB | Amlodipine, nifedipine ER | Ankle edema, headache, flushing",
  );
  const hNon = c(
    "htn",
    9,
    "Non-dihydropyridine CCB | Diltiazem, verapamil | Bradycardia, constipation (verapamil)",
  );
  const hPreg = c(
    "htn",
    11,
    "ACE inhibitors, ARBs and aliskiren are fetotoxic: avoid in pregnancy and counsel on contraception",
  );
  const hNever = c("htn", 7, "Never combine an ACE inhibitor with an ARB");
  const fArni = c(
    "hf",
    6,
    "ARNI (or ACE inhibitor or ARB) | Sacubitril/valsartan | Lower mortality and fewer HF hospitalisations",
  );
  const fMra = c(
    "hf",
    6,
    "Mineralocorticoid receptor antagonist (MRA) | Spironolactone, eplerenone | Lower mortality",
  );
  const fSglt = c(
    "hf",
    6,
    "SGLT2 inhibitor | Dapagliflozin, empagliflozin | Fewer HF hospitalisations and cardiovascular deaths",
  );
  const fLoop = c("hf", 10, "Loop diuretics for congestion: furosemide, bumetanide, torsemide");
  const fGyn = c("hf", 9, "Spironolactone can cause gynaecomastia; eplerenone rarely does");
  const fK = c("hf", 9, "Recheck potassium and renal function within about 1 week, then regularly");
  const fNep = c("hf", 8, "Sacubitril blocks neprilysin, so natriuretic peptides last longer");
  const fGap = c("hf", 8, "Stop an ACE inhibitor at least 36 hours before the first dose");
  const cMus = c(
    "chol",
    7,
    "Atropine | Non-selective, tertiary | Symptomatic bradycardia; organophosphate poisoning",
  );
  const cChE = c(
    "chol",
    5,
    "Neostigmine | Reversible; quaternary, no CNS entry | Reversal of nondepolarising blockade; myasthenia gravis",
  );
  const cOx = c(
    "chol",
    7,
    "Oxybutynin, tolterodine | Bladder antimuscarinics | Overactive bladder",
  );
  const cTox = c(
    "chol",
    8,
    "Toxicity: hot, dry, flushed skin, dilated pupils, delirium, urinary retention",
  );
  const cDel = c("chol", 8, "Confusion and delirium, especially in older adults");
  const cGlau = c("chol", 8, "Blurred vision; can precipitate acute angle-closure glaucoma");
  const aSep = c("adr", 6, "Septic shock: norepinephrine is the first-choice vasopressor");
  const aAna = c(
    "adr",
    6,
    "Anaphylaxis: epinephrine IM into the anterolateral thigh, first and without delay",
  );
  const aB2 = c(
    "adr",
    7,
    "Adverse effects of beta-2 agonists: tremor, tachycardia, hypokalaemia and hyperglycaemia.",
  );
  const aClo = c(
    "adr",
    8,
    "Clonidine (alpha-2): hypertension, ADHD, withdrawal symptoms; rebound hypertension if stopped suddenly",
  );

  // ---- drug classes ----------------------------------------------------------------------------------
  add(
    "drug_class",
    "beta blockers",
    c("beta", 3, "Competitive antagonists at beta receptors"),
    "Competitive antagonists at beta receptors: lower heart rate, contractility and renin release.",
    { aliases: ["beta-adrenergic blockers", "beta antagonists"] },
  );
  add(
    "drug_class",
    "cardioselective beta blockers",
    bClass,
    "Beta-1 selective blockers; selectivity is lost at high doses.",
    { aliases: ["beta-1 selective blockers"] },
  );
  add(
    "drug_class",
    "non-selective beta blockers",
    bNon,
    "Block beta-1 and beta-2; avoid in asthma.",
  );
  add(
    "drug_class",
    "mixed alpha and beta blockers",
    bMix,
    "Block alpha-1 as well as beta receptors, adding vasodilation.",
  );
  add(
    "drug_class",
    "ACE inhibitors",
    hAce,
    "Block angiotensin-converting enzyme; first line in hypertension.",
    { aliases: ["ACEi", "-pril drugs"] },
  );
  add(
    "drug_class",
    "angiotensin receptor blockers",
    hArb,
    "Block the AT1 receptor; like ACE inhibitors without the cough.",
    { aliases: ["ARBs", "-sartan drugs"] },
  );
  add(
    "drug_class",
    "thiazide diuretics",
    hFirst,
    "First-line antihypertensives; chlorthalidone is preferred.",
    { aliases: ["thiazide-type diuretics"] },
  );
  add(
    "drug_class",
    "dihydropyridine calcium channel blockers",
    hDhp,
    "Vasoselective calcium channel blockers; first line in hypertension.",
    { aliases: ["DHP CCBs"] },
  );
  add(
    "drug_class",
    "non-dihydropyridine calcium channel blockers",
    hNon,
    "Slow the heart and AV node; avoid in HFrEF.",
    { aliases: ["non-DHP CCBs"] },
  );
  add(
    "drug_class",
    "loop diuretics",
    fLoop,
    "Relieve congestion in heart failure; no survival benefit.",
  );
  add(
    "drug_class",
    "mineralocorticoid receptor antagonists",
    fMra,
    "One of the four pillars of HFrEF therapy.",
    { aliases: ["MRAs", "aldosterone antagonists"] },
  );
  add(
    "drug_class",
    "SGLT2 inhibitors",
    fSglt,
    "Reduce heart failure hospitalisations and cardiovascular deaths in HFrEF.",
    { aliases: ["gliflozins"] },
  );
  add(
    "drug_class",
    "angiotensin receptor-neprilysin inhibitors",
    fArni,
    "ARNI: sacubitril/valsartan, a pillar of HFrEF therapy.",
    { aliases: ["ARNI"] },
  );
  add("drug_class", "muscarinic antagonists", cMus, "Block ACh at muscarinic receptors.", {
    aliases: ["antimuscarinics", "anticholinergics"],
  });
  add(
    "drug_class",
    "cholinesterase inhibitors",
    cChE,
    "Stop acetylcholinesterase from breaking down ACh.",
    { aliases: ["anticholinesterases"] },
  );
  add(
    "drug_class",
    "muscarinic agonists",
    c(
      "chol",
      3,
      "Bethanechol | Muscarinic selective; not broken down by acetylcholinesterase | Non-obstructive urinary retention",
    ),
    "Direct-acting cholinomimetics.",
  );
  add(
    "drug_class",
    "beta-2 agonists",
    c(
      "adr",
      7,
      "Albuterol (SABA) | Onset within minutes, lasts 4 to 6 hours | Reliever (rescue) inhaler",
    ),
    "Bronchodilators: SABAs for relief, LABAs for maintenance.",
    { aliases: ["SABA", "LABA"] },
  );
  add("drug_class", "alpha-2 agonists", aClo, "Lower sympathetic outflow from the brain.");
  add(
    "drug_class",
    "catecholamines",
    c("adr", 3, "Catecholamines: epinephrine, norepinephrine, dopamine, dobutamine, isoproterenol"),
    "Broken down by MAO and COMT; short acting, not oral.",
  );

  // ---- drugs -------------------------------------------------------------------------------------------
  drug(
    "metoprolol succinate",
    ["Toprol-XL"],
    top("metoprolol succinate | Toprol-XL | Beta-1 selective blocker"),
    "Extended-release cardioselective beta blocker; one of the three proven in HFrEF.",
  );
  drug(
    "metoprolol tartrate",
    ["Lopressor"],
    top("metoprolol tartrate | Lopressor | Beta-1 selective blocker"),
    "Immediate-release cardioselective beta blocker given twice daily; not an HFrEF beta blocker.",
  );
  drug(
    "atenolol",
    ["Tenormin"],
    top("atenolol | Tenormin | Beta-1 selective blocker"),
    "Cardioselective, renally cleared beta blocker.",
  );
  drug("bisoprolol", [], bHf, "Cardioselective beta blocker proven in HFrEF.");
  drug(
    "carvedilol",
    ["Coreg"],
    top("carvedilol | Coreg | Alpha-1 and beta blocker"),
    "Mixed alpha-1 and beta blocker; take with food; proven in HFrEF.",
  );
  drug(
    "propranolol",
    ["Inderal LA"],
    top("propranolol | Inderal LA | Non-selective beta blocker"),
    "Lipophilic non-selective beta blocker with a large first-pass effect.",
  );
  drug(
    "nadolol",
    [],
    c("beta", 5, "Nadolol | Low | Renal | 20 to 24 h"),
    "Non-selective, renally cleared, long half-life.",
  );
  drug(
    "nebivolol",
    ["Bystolic"],
    top("nebivolol | Bystolic | Beta-1 selective blocker, vasodilating"),
    "Beta-1 selective with nitric oxide-mediated vasodilation.",
  );
  drug(
    "labetalol",
    ["Trandate"],
    top("labetalol | Trandate | Alpha-1 and beta blocker"),
    "Mixed alpha-1 and beta blocker; preferred in pregnancy.",
  );
  drug(
    "esmolol",
    ["Brevibloc"],
    c("beta", 5, "Esmolol | Low | Red blood cell esterases | About 9 minutes"),
    "Ultra-short-acting IV beta-1 blocker.",
  );
  drug(
    "lisinopril",
    ["Zestril", "Prinivil"],
    top("lisinopril | Zestril, Prinivil | ACE inhibitor"),
    "ACE inhibitor; usual start 10 mg once daily for hypertension.",
  );
  drug("enalapril", ["Vasotec"], top("enalapril | Vasotec | ACE inhibitor"));
  drug(
    "losartan",
    ["Cozaar"],
    top("losartan | Cozaar | Angiotensin receptor blocker"),
    "ARB; usual start 50 mg once daily.",
  );
  drug("valsartan", ["Diovan"], top("valsartan | Diovan | Angiotensin receptor blocker"));
  drug(
    "amlodipine",
    ["Norvasc"],
    top("amlodipine | Norvasc | Dihydropyridine CCB"),
    "Dihydropyridine CCB; ankle edema is the classic adverse effect.",
  );
  drug(
    "nifedipine",
    ["Procardia XL"],
    top("nifedipine ER | Procardia XL | Dihydropyridine CCB"),
    "Dihydropyridine CCB; extended release is used in hypertension and pregnancy.",
  );
  drug("diltiazem", ["Cardizem"], top("diltiazem | Cardizem | Non-dihydropyridine CCB"));
  drug(
    "verapamil",
    ["Calan"],
    top("verapamil | Calan | Non-dihydropyridine CCB"),
    "Non-dihydropyridine CCB; constipation; adds AV block to beta blockers.",
  );
  drug(
    "chlorthalidone",
    ["Thalitone"],
    top("chlorthalidone | Thalitone | Thiazide-type diuretic"),
    "Preferred thiazide-type diuretic.",
  );
  drug(
    "hydrochlorothiazide",
    ["Microzide"],
    top("hydrochlorothiazide | Microzide | Thiazide diuretic"),
    undefined,
    { aliases: ["HCTZ"] },
  );
  drug(
    "furosemide",
    ["Lasix"],
    top("furosemide | Lasix | Loop diuretic"),
    "Loop diuretic; 40 mg PO is about 20 mg IV.",
  );
  drug("bumetanide", ["Bumex"], top("bumetanide | Bumex | Loop diuretic"));
  drug("torsemide", [], fLoop);
  drug(
    "spironolactone",
    ["Aldactone"],
    top("spironolactone | Aldactone | Mineralocorticoid receptor antagonist"),
    "MRA; hyperkalaemia and gynaecomastia.",
  );
  drug(
    "eplerenone",
    ["Inspra"],
    top("eplerenone | Inspra | Mineralocorticoid receptor antagonist"),
    "MRA that rarely causes gynaecomastia.",
  );
  drug(
    "sacubitril/valsartan",
    ["Entresto"],
    top("sacubitril/valsartan | Entresto | ARNI"),
    "ARNI for HFrEF; 36 hours away from any ACE inhibitor.",
  );
  drug(
    "dapagliflozin",
    ["Farxiga"],
    top("dapagliflozin | Farxiga | SGLT2 inhibitor"),
    "SGLT2 inhibitor, 10 mg once daily in HFrEF.",
  );
  drug("empagliflozin", ["Jardiance"], top("empagliflozin | Jardiance | SGLT2 inhibitor"));
  drug(
    "digoxin",
    ["Lanoxin"],
    top("digoxin | Lanoxin | Cardiac glycoside"),
    "Fewer hospitalisations in HFrEF, no survival benefit.",
  );
  drug("ivabradine", ["Corlanor"], top("ivabradine | Corlanor | Funny current (If) inhibitor"));
  drug(
    "hydralazine/isosorbide dinitrate",
    ["BiDil"],
    top("hydralazine/isosorbide dinitrate | BiDil | Vasodilator combination"),
  );
  drug(
    "clonidine",
    ["Catapres"],
    top("clonidine | Catapres | Central alpha-2 agonist"),
    "Central alpha-2 agonist; never stop suddenly.",
  );
  drug("atropine", [], cMus, "Non-selective muscarinic antagonist.");
  drug(
    "bethanechol",
    ["Urecholine"],
    topA("bethanechol | Urecholine | Muscarinic agonist"),
    "Muscarinic agonist for non-obstructive urinary retention.",
  );
  drug("pilocarpine", ["Salagen"], topA("pilocarpine | Salagen | Muscarinic agonist"));
  drug("cevimeline", ["Evoxac"], topA("cevimeline | Evoxac | Muscarinic agonist"));
  drug(
    "neostigmine",
    ["Bloxiverz"],
    cChE,
    "Quaternary cholinesterase inhibitor; reverses nondepolarising block.",
  );
  drug(
    "pyridostigmine",
    ["Mestinon"],
    topA("pyridostigmine | Mestinon | Cholinesterase inhibitor"),
  );
  drug(
    "physostigmine",
    [],
    c(
      "chol",
      5,
      "Physostigmine | Reversible; tertiary, enters the CNS | Severe anticholinergic toxicity",
    ),
  );
  drug("donepezil", ["Aricept"], topA("donepezil | Aricept | Cholinesterase inhibitor"));
  drug("rivastigmine", ["Exelon"], topA("rivastigmine | Exelon | Cholinesterase inhibitor"));
  drug("galantamine", ["Razadyne"], topA("galantamine | Razadyne | Cholinesterase inhibitor"));
  drug(
    "pralidoxime",
    ["Protopam"],
    c("chol", 6, "Pralidoxime regenerates acetylcholinesterase if given before the enzyme ages"),
  );
  drug("oxybutynin", ["Ditropan XL"], topA("oxybutynin | Ditropan XL | Antimuscarinic (bladder)"));
  drug("tolterodine", ["Detrol"], topA("tolterodine | Detrol | Antimuscarinic (bladder)"));
  drug("tiotropium", ["Spiriva"], topA("tiotropium | Spiriva | Long-acting muscarinic antagonist"));
  drug(
    "ipratropium",
    ["Atrovent HFA"],
    topA("ipratropium | Atrovent HFA | Short-acting muscarinic antagonist"),
  );
  drug(
    "scopolamine",
    ["Transderm Scop"],
    topA("scopolamine patch | Transderm Scop | Antimuscarinic"),
  );
  drug("glycopyrrolate", ["Robinul"], topA("glycopyrrolate | Robinul | Antimuscarinic"));
  drug("sugammadex", ["Bridion"], topA("sugammadex | Bridion | Neuromuscular blockade reversal"));
  drug("rocuronium", [], c("chol", 9, "Rocuronium | Nondepolarising | Reversed by sugammadex"));
  drug(
    "succinylcholine",
    [],
    c(
      "chol",
      9,
      "Succinylcholine | Depolarising | Hyperkalaemia; trigger for malignant hyperthermia",
    ),
  );
  drug(
    "epinephrine",
    ["EpiPen"],
    topA("epinephrine auto-injector | EpiPen | Adrenergic agonist"),
    "First-line treatment of anaphylaxis, IM into the thigh.",
    { aliases: ["adrenaline"] },
  );
  drug("norepinephrine", ["Levophed"], aSep, "First-choice vasopressor in septic shock.", {
    aliases: ["noradrenaline"],
  });
  drug(
    "dobutamine",
    [],
    c("adr", 4, "Dobutamine | Mainly beta-1 | Inotrope: raises contractility"),
  );
  drug("dopamine", [], c("adr", 5, "Intermediate dose: beta-1, more contractility and heart rate"));
  drug(
    "phenylephrine",
    [],
    c("adr", 4, "Phenylephrine | alpha-1 | Vasoconstriction; reflex bradycardia"),
  );
  drug(
    "albuterol",
    ["Ventolin HFA"],
    topA("albuterol | Ventolin HFA | Short-acting beta-2 agonist"),
    undefined,
    { aliases: ["salbutamol"] },
  );
  drug("salmeterol", ["Serevent"], topA("salmeterol | Serevent | Long-acting beta-2 agonist"));
  drug(
    "pseudoephedrine",
    ["Sudafed"],
    topA("pseudoephedrine | Sudafed | Sympathomimetic decongestant"),
  );
  drug(
    "oxymetazoline",
    ["Afrin"],
    topA("oxymetazoline | Afrin | Alpha agonist (topical decongestant)"),
  );
  drug(
    "midodrine",
    [],
    c(
      "adr",
      8,
      "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
    ),
  );

  // ---- mechanisms, targets ----------------------------------------------------------------------------
  add(
    "mechanism",
    "beta-1 receptor blockade",
    c("beta", 3, "Beta-1 blockade: lower heart rate, contractility and AV conduction"),
  );
  add("mechanism", "alpha-1 receptor blockade", bMix);
  add("mechanism", "muscarinic receptor blockade", cMus);
  add("mechanism", "acetylcholinesterase inhibition", cChE);
  add("mechanism", "beta-2 receptor agonism", c("adr", 4, "Albuterol | beta-2 | Bronchodilation"));
  add(
    "mechanism",
    "alpha-1 receptor agonism",
    c("adr", 4, "Phenylephrine | alpha-1 | Vasoconstriction; reflex bradycardia"),
  );
  add(
    "mechanism",
    "central alpha-2 agonism",
    c("adr", 4, "Clonidine | alpha-2 (central) | Lowers sympathetic outflow"),
  );
  add("mechanism", "neprilysin inhibition", fNep);
  add("mechanism", "ACE inhibition", null, "Less angiotensin II and more bradykinin.");
  add("mechanism", "AT1 receptor blockade", null, "Blocks angiotensin II at its type 1 receptor.");
  add("mechanism", "aldosterone receptor blockade", null);
  add("mechanism", "SGLT2 inhibition", null);
  add("mechanism", "L-type calcium channel blockade", null);
  add(
    "target",
    "beta-1 adrenergic receptor",
    c(
      "ans",
      7,
      "beta-1 | Gs | Heart, juxtaglomerular cells of the kidney | Higher heart rate and contractility; renin release",
    ),
  );
  add(
    "target",
    "beta-2 adrenergic receptor",
    c("ans", 7, "beta-2 | Gs | Bronchial and vascular smooth muscle, liver, uterus"),
  );
  add(
    "target",
    "alpha-1 adrenergic receptor",
    c("ans", 7, "alpha-1 | Gq | Vascular smooth muscle, iris dilator muscle, bladder sphincter"),
  );
  add(
    "target",
    "alpha-2 adrenergic receptor",
    c(
      "ans",
      7,
      "alpha-2 | Gi | Presynaptic nerve terminals, CNS | Less NE release; lower sympathetic outflow",
    ),
  );
  add(
    "target",
    "M2 muscarinic receptor",
    c("ans", 6, "M2 | Gi-coupled | Heart (SA and AV nodes) | Slower heart rate and AV conduction"),
  );
  add(
    "target",
    "M3 muscarinic receptor",
    c("ans", 6, "M3 | Gq-coupled | Smooth muscle, exocrine glands, vascular endothelium"),
  );
  add(
    "target",
    "acetylcholinesterase",
    c("ans", 9, "Acetylcholinesterase splits ACh into choline and acetate in the synaptic cleft"),
    undefined,
    { aliases: ["AChE"] },
  );

  // ---- indications ------------------------------------------------------------------------------------
  add(
    "indication",
    "hypertension",
    c("htn", 3, "Stage 1 hypertension | 130 to 139 | or | 80 to 89"),
    undefined,
    { aliases: ["HTN", "high blood pressure"] },
  );
  add(
    "indication",
    "HFrEF",
    c("hf", 3, "HFrEF (reduced) | 40% or less"),
    "Heart failure with an LVEF of 40% or less.",
    { aliases: ["heart failure with reduced ejection fraction"] },
  );
  add("indication", "angina", c("beta", 6, "Angina and after myocardial infarction"));
  add(
    "indication",
    "atrial fibrillation rate control",
    c("beta", 6, "Rate control in atrial fibrillation"),
  );
  add("indication", "anaphylaxis", aAna);
  add("indication", "septic shock", aSep);
  add(
    "indication",
    "asthma",
    c("adr", 7, "In asthma a LABA is always paired with an inhaled corticosteroid."),
  );
  add("indication", "COPD", c("chol", 7, "Tiotropium | Inhaled, long acting | COPD maintenance"));
  add("indication", "overactive bladder", cOx);
  add(
    "indication",
    "myasthenia gravis",
    c("chol", 5, "Pyridostigmine | Reversible; quaternary | Myasthenia gravis (oral maintenance)"),
  );
  add(
    "indication",
    "organophosphate poisoning",
    c("chol", 6, "Atropine: repeat and titrate until bronchial secretions are dry"),
  );
  add("indication", "urinary retention", c("chol", 3, "Non-obstructive urinary retention"));
  add(
    "indication",
    "Alzheimer disease",
    c(
      "chol",
      5,
      "Donepezil, rivastigmine, galantamine | Reversible; act in the CNS | Alzheimer disease",
    ),
  );
  add(
    "indication",
    "symptomatic bradycardia",
    c("chol", 7, "Symptomatic bradycardia; organophosphate poisoning"),
  );
  add(
    "indication",
    "orthostatic hypotension",
    c(
      "adr",
      8,
      "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
    ),
  );
  add(
    "indication",
    "motion sickness",
    c("chol", 7, "Scopolamine | Marked CNS effect | Motion sickness (transdermal patch)"),
  );
  add(
    "indication",
    "migraine prevention",
    c("beta", 6, "Propranolol: migraine prevention, essential tremor, symptoms of hyperthyroidism"),
  );

  // ---- adverse effects, contraindications, monitoring, counselling ------------------------------------
  add("adverse_effect", "bradycardia", bBrady);
  add("adverse_effect", "bronchospasm", bBronch);
  add(
    "adverse_effect",
    "masked hypoglycaemia",
    bHypo,
    "Tremor and palpitations are blunted; sweating still occurs.",
  );
  add("adverse_effect", "dry cough", hAce);
  add("adverse_effect", "angioedema", hAce);
  add("adverse_effect", "hyperkalaemia", hArb, undefined, { aliases: ["high potassium"] });
  add("adverse_effect", "hypokalaemia", hThz, undefined, { aliases: ["low potassium"] });
  add("adverse_effect", "hyperuricaemia", hThz, "High uric acid; can trigger gout.");
  add("adverse_effect", "peripheral edema", hDhp, undefined, { aliases: ["ankle edema"] });
  add("adverse_effect", "constipation", hNon);
  add("adverse_effect", "gynaecomastia", fGyn);
  add("adverse_effect", "rebound hypertension", aClo);
  add(
    "adverse_effect",
    "rebound tachycardia",
    c("beta", 7, "Abrupt withdrawal: rebound tachycardia, angina, even myocardial infarction"),
  );
  add("adverse_effect", "tremor", aB2);
  add("adverse_effect", "urinary retention", cTox);
  add("adverse_effect", "delirium", cDel);
  add("adverse_effect", "dry mouth", c("chol", 8, "Dry mouth, constipation, urinary retention"));
  add(
    "adverse_effect",
    "supine hypertension",
    c(
      "adr",
      8,
      "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
    ),
  );
  add(
    "adverse_effect",
    "malignant hyperthermia",
    c(
      "chol",
      9,
      "Succinylcholine | Depolarising | Hyperkalaemia; trigger for malignant hyperthermia",
    ),
  );
  add("contraindication", "pregnancy", hPreg);
  add(
    "contraindication",
    "second- or third-degree heart block",
    c("beta", 8, "Severe bradycardia or second- or third-degree heart block without a pacemaker"),
  );
  add(
    "contraindication",
    "history of ACE inhibitor angioedema",
    c("htn", 11, "History of angioedema with an ACE inhibitor: do not use an ACE inhibitor again"),
  );
  add(
    "contraindication",
    "bilateral renal artery stenosis",
    c(
      "htn",
      11,
      "Bilateral renal artery stenosis: ACE inhibitors and ARBs can cause acute kidney injury",
    ),
  );
  add("contraindication", "angle-closure glaucoma", cGlau);
  add(
    "contraindication",
    "mechanical bladder or bowel obstruction",
    c(
      "chol",
      3,
      "Bethanechol must never be used when the bladder or bowel is mechanically obstructed.",
    ),
  );
  add(
    "contraindication",
    "HFrEF",
    c(
      "hf",
      11,
      "Non-dihydropyridine calcium channel blockers (diltiazem, verapamil): negative inotropes",
    ),
  );
  add(
    "monitoring_parameter",
    "heart rate",
    c("beta", 11, "Check your pulse; report a heart rate that stays below 50"),
  );
  add(
    "monitoring_parameter",
    "blood pressure",
    c("htn", 12, "Recheck monthly until at goal, then every 3 to 6 months"),
  );
  add("monitoring_parameter", "serum potassium", fK, undefined, { aliases: ["potassium", "K"] });
  add(
    "monitoring_parameter",
    "serum creatinine",
    c(
      "htn",
      11,
      "A rise in serum creatinine of up to 30% after starting an ACE inhibitor or ARB is expected",
    ),
    undefined,
    { aliases: ["SCr"] },
  );
  add("monitoring_parameter", "uric acid", hThz);
  add(
    "counselling_point",
    "do not stop abruptly",
    bTaper,
    "Taper beta blockers over 1 to 2 weeks; never stop clonidine suddenly.",
  );
  add(
    "counselling_point",
    "take carvedilol with food",
    c("beta", 11, "Take carvedilol with food to reduce dizziness"),
  );
  add(
    "counselling_point",
    "rise slowly from sitting or lying",
    c("beta", 11, "Rise slowly from sitting or lying"),
  );
  add(
    "counselling_point",
    "apply the scopolamine patch 4 hours before travel",
    c("chol", 11, "Scopolamine patch: apply behind the ear at least 4 hours before travel"),
  );
  add("counselling_point", "use reliable contraception", hPreg);
  add(
    "interaction",
    "CYP2D6 inhibition",
    c("beta", 9, "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels"),
  );
  add(
    "other",
    "first-pass metabolism",
    c("beta", 5, "Propranolol | High | Hepatic, large first-pass effect | 3 to 6 h"),
  );
  add(
    "other",
    "Hofmann elimination",
    c(
      "chol",
      9,
      "Cisatracurium | Nondepolarising | Hofmann elimination: useful in renal or hepatic failure",
    ),
  );
  add(
    "other",
    "prescribing cascade",
    c("chol", 11, "Donepezil plus oxybutynin: opposing effects, and a classic prescribing cascade"),
  );

  // ---- relations --------------------------------------------------------------------------------------
  const D = (n) => ["drug", n];
  const C = (n) => ["drug_class", n];
  const classOf = [
    ["metoprolol succinate", "cardioselective beta blockers", bClass],
    ["metoprolol tartrate", "cardioselective beta blockers", bClass],
    ["atenolol", "cardioselective beta blockers", bClass],
    ["bisoprolol", "cardioselective beta blockers", bClass],
    ["esmolol", "cardioselective beta blockers", bClass],
    [
      "nebivolol",
      "cardioselective beta blockers",
      c("beta", 4, "Beta-1 selective with vasodilation | Nebivolol"),
    ],
    ["propranolol", "non-selective beta blockers", bNon],
    ["nadolol", "non-selective beta blockers", bNon],
    ["carvedilol", "mixed alpha and beta blockers", bMix],
    ["labetalol", "mixed alpha and beta blockers", bMix],
    ["lisinopril", "ACE inhibitors", hAce],
    ["enalapril", "ACE inhibitors", hAce],
    ["losartan", "angiotensin receptor blockers", hArb],
    ["valsartan", "angiotensin receptor blockers", hArb],
    ["amlodipine", "dihydropyridine calcium channel blockers", hDhp],
    ["nifedipine", "dihydropyridine calcium channel blockers", hDhp],
    ["diltiazem", "non-dihydropyridine calcium channel blockers", hNon],
    ["verapamil", "non-dihydropyridine calcium channel blockers", hNon],
    ["chlorthalidone", "thiazide diuretics", hThz],
    ["hydrochlorothiazide", "thiazide diuretics", hThz],
    ["furosemide", "loop diuretics", fLoop],
    ["bumetanide", "loop diuretics", fLoop],
    ["torsemide", "loop diuretics", fLoop],
    ["spironolactone", "mineralocorticoid receptor antagonists", fMra],
    ["eplerenone", "mineralocorticoid receptor antagonists", fMra],
    ["dapagliflozin", "SGLT2 inhibitors", fSglt],
    ["empagliflozin", "SGLT2 inhibitors", fSglt],
    ["sacubitril/valsartan", "angiotensin receptor-neprilysin inhibitors", fArni],
    ["atropine", "muscarinic antagonists", cMus],
    ["oxybutynin", "muscarinic antagonists", cOx],
    ["tolterodine", "muscarinic antagonists", cOx],
    ["tiotropium", "muscarinic antagonists", null],
    ["ipratropium", "muscarinic antagonists", null],
    ["scopolamine", "muscarinic antagonists", null],
    ["glycopyrrolate", "muscarinic antagonists", null],
    ["neostigmine", "cholinesterase inhibitors", cChE],
    ["pyridostigmine", "cholinesterase inhibitors", null],
    ["physostigmine", "cholinesterase inhibitors", null],
    ["donepezil", "cholinesterase inhibitors", null],
    ["rivastigmine", "cholinesterase inhibitors", null],
    ["galantamine", "cholinesterase inhibitors", null],
    ["bethanechol", "muscarinic agonists", null],
    ["pilocarpine", "muscarinic agonists", null],
    ["cevimeline", "muscarinic agonists", null],
    ["albuterol", "beta-2 agonists", null],
    ["salmeterol", "beta-2 agonists", null],
    ["clonidine", "alpha-2 agonists", aClo],
    ["epinephrine", "catecholamines", null],
    ["norepinephrine", "catecholamines", null],
    ["dopamine", "catecholamines", null],
    ["dobutamine", "catecholamines", null],
  ];
  for (const [d, k, src] of classOf) rel(D(d), "belongs_to_class", C(k), src);
  for (const k of [
    "cardioselective beta blockers",
    "non-selective beta blockers",
    "mixed alpha and beta blockers",
  ])
    rel(C(k), "belongs_to_class", C("beta blockers"), c("beta", 4, "Group | Examples | Key point"));

  const M = (n) => ["mechanism", n];
  rel(
    C("beta blockers"),
    "has_mechanism",
    M("beta-1 receptor blockade"),
    c("beta", 3, "Beta-1 blockade: lower heart rate, contractility and AV conduction"),
  );
  rel(C("mixed alpha and beta blockers"), "has_mechanism", M("alpha-1 receptor blockade"), bMix);
  rel(C("muscarinic antagonists"), "has_mechanism", M("muscarinic receptor blockade"), cMus);
  rel(C("cholinesterase inhibitors"), "has_mechanism", M("acetylcholinesterase inhibition"), cChE);
  rel(C("beta-2 agonists"), "has_mechanism", M("beta-2 receptor agonism"), null);
  rel(D("phenylephrine"), "has_mechanism", M("alpha-1 receptor agonism"), null);
  rel(D("midodrine"), "has_mechanism", M("alpha-1 receptor agonism"), null);
  rel(C("alpha-2 agonists"), "has_mechanism", M("central alpha-2 agonism"), null);
  rel(D("sacubitril/valsartan"), "has_mechanism", M("neprilysin inhibition"), fNep);
  rel(D("sacubitril/valsartan"), "has_mechanism", M("AT1 receptor blockade"), null);
  rel(C("ACE inhibitors"), "has_mechanism", M("ACE inhibition"), null);
  rel(C("angiotensin receptor blockers"), "has_mechanism", M("AT1 receptor blockade"), null);
  rel(
    C("mineralocorticoid receptor antagonists"),
    "has_mechanism",
    M("aldosterone receptor blockade"),
    null,
  );
  rel(C("SGLT2 inhibitors"), "has_mechanism", M("SGLT2 inhibition"), null);
  rel(
    C("dihydropyridine calcium channel blockers"),
    "has_mechanism",
    M("L-type calcium channel blockade"),
    null,
  );
  rel(
    C("non-dihydropyridine calcium channel blockers"),
    "has_mechanism",
    M("L-type calcium channel blockade"),
    null,
  );
  const T = (n) => ["target", n];
  rel(M("beta-1 receptor blockade"), "acts_on", T("beta-1 adrenergic receptor"), null);
  rel(M("beta-2 receptor agonism"), "acts_on", T("beta-2 adrenergic receptor"), null);
  rel(M("alpha-1 receptor agonism"), "acts_on", T("alpha-1 adrenergic receptor"), null);
  rel(M("alpha-1 receptor blockade"), "acts_on", T("alpha-1 adrenergic receptor"), null);
  rel(M("central alpha-2 agonism"), "acts_on", T("alpha-2 adrenergic receptor"), null);
  rel(M("acetylcholinesterase inhibition"), "acts_on", T("acetylcholinesterase"), null);
  rel(
    D("atropine"),
    "acts_on",
    T("M2 muscarinic receptor"),
    c("chol", 7, "Atropine | Non-selective, tertiary"),
  );
  rel(D("oxybutynin"), "acts_on", T("M3 muscarinic receptor"), null);
  rel(
    D("cevimeline"),
    "acts_on",
    T("M3 muscarinic receptor"),
    c("chol", 3, "Cevimeline | M3 agonist"),
  );
  rel(
    D("dobutamine"),
    "acts_on",
    T("beta-1 adrenergic receptor"),
    c("adr", 4, "Dobutamine | Mainly beta-1"),
  );
  rel(
    D("albuterol"),
    "acts_on",
    T("beta-2 adrenergic receptor"),
    c("adr", 4, "Albuterol | beta-2 | Bronchodilation"),
  );

  const I = (n) => ["indication", n];
  const treats = [
    [C("ACE inhibitors"), "hypertension", c("htn", 7, "ACE inhibitors")],
    [
      C("angiotensin receptor blockers"),
      "hypertension",
      c("htn", 7, "Angiotensin receptor blockers (ARBs)"),
    ],
    [C("thiazide diuretics"), "hypertension", hFirst],
    [
      C("dihydropyridine calcium channel blockers"),
      "hypertension",
      c("htn", 7, "Dihydropyridine calcium channel blockers"),
    ],
    [D("labetalol"), "hypertension", c("htn", 8, "Pregnancy | Labetalol or nifedipine")],
    [D("clonidine"), "hypertension", aClo],
    [C("angiotensin receptor-neprilysin inhibitors"), "HFrEF", fArni],
    [C("mineralocorticoid receptor antagonists"), "HFrEF", fMra],
    [C("SGLT2 inhibitors"), "HFrEF", fSglt],
    [D("metoprolol succinate"), "HFrEF", bHf],
    [D("carvedilol"), "HFrEF", bHf],
    [D("bisoprolol"), "HFrEF", bHf],
    [D("digoxin"), "HFrEF", c("hf", 10, "Digoxin: fewer hospitalisations, no survival benefit")],
    [
      D("ivabradine"),
      "HFrEF",
      c(
        "hf",
        10,
        "Ivabradine: sinus rhythm with resting heart rate of 70 or more on a maximally tolerated beta blocker",
      ),
    ],
    [
      D("hydralazine/isosorbide dinitrate"),
      "HFrEF",
      c(
        "hf",
        10,
        "Hydralazine with isosorbide dinitrate: self-identified Black patients with NYHA III to IV on optimal therapy",
      ),
    ],
    [C("beta blockers"), "angina", c("beta", 6, "Angina and after myocardial infarction")],
    [
      C("beta blockers"),
      "atrial fibrillation rate control",
      c("beta", 6, "Rate control in atrial fibrillation"),
    ],
    [
      D("propranolol"),
      "migraine prevention",
      c(
        "beta",
        6,
        "Propranolol: migraine prevention, essential tremor, symptoms of hyperthyroidism",
      ),
    ],
    [D("epinephrine"), "anaphylaxis", aAna],
    [D("norepinephrine"), "septic shock", aSep],
    [
      D("albuterol"),
      "asthma",
      c(
        "adr",
        7,
        "Albuterol (SABA) | Onset within minutes, lasts 4 to 6 hours | Reliever (rescue) inhaler",
      ),
    ],
    [D("tiotropium"), "COPD", c("chol", 7, "Tiotropium | Inhaled, long acting | COPD maintenance")],
    [
      D("ipratropium"),
      "COPD",
      c(
        "chol",
        7,
        "Ipratropium | Inhaled, quaternary, short acting | COPD; added to albuterol in acute asthma",
      ),
    ],
    [D("oxybutynin"), "overactive bladder", cOx],
    [D("tolterodine"), "overactive bladder", cOx],
    [
      D("pyridostigmine"),
      "myasthenia gravis",
      c(
        "chol",
        5,
        "Pyridostigmine | Reversible; quaternary | Myasthenia gravis (oral maintenance)",
      ),
    ],
    [
      D("atropine"),
      "organophosphate poisoning",
      c("chol", 6, "Atropine: repeat and titrate until bronchial secretions are dry"),
    ],
    [
      D("pralidoxime"),
      "organophosphate poisoning",
      c("chol", 6, "Pralidoxime regenerates acetylcholinesterase if given before the enzyme ages"),
    ],
    [D("atropine"), "symptomatic bradycardia", cMus],
    [D("bethanechol"), "urinary retention", c("chol", 3, "Non-obstructive urinary retention")],
    [
      D("donepezil"),
      "Alzheimer disease",
      c(
        "chol",
        5,
        "Donepezil, rivastigmine, galantamine | Reversible; act in the CNS | Alzheimer disease",
      ),
    ],
    [
      D("midodrine"),
      "orthostatic hypotension",
      c("adr", 8, "Midodrine (alpha-1 prodrug): orthostatic hypotension"),
    ],
    [
      D("scopolamine"),
      "motion sickness",
      c("chol", 7, "Scopolamine | Marked CNS effect | Motion sickness (transdermal patch)"),
    ],
  ];
  for (const [from, to, src] of treats) rel(from, "treats", I(to), src);

  const A = (n) => ["adverse_effect", n];
  const causes = [
    [C("beta blockers"), "bradycardia", bBrady],
    [C("non-selective beta blockers"), "bronchospasm", bBronch],
    [C("beta blockers"), "masked hypoglycaemia", bHypo],
    [
      C("beta blockers"),
      "rebound tachycardia",
      c("beta", 7, "Abrupt withdrawal: rebound tachycardia, angina, even myocardial infarction"),
    ],
    [C("ACE inhibitors"), "dry cough", hAce],
    [C("ACE inhibitors"), "angioedema", hAce],
    [C("ACE inhibitors"), "hyperkalaemia", hAce],
    [C("angiotensin receptor blockers"), "hyperkalaemia", hArb],
    [C("thiazide diuretics"), "hypokalaemia", hThz],
    [C("thiazide diuretics"), "hyperuricaemia", hThz],
    [C("dihydropyridine calcium channel blockers"), "peripheral edema", hDhp],
    [D("verapamil"), "constipation", hNon],
    [C("non-dihydropyridine calcium channel blockers"), "bradycardia", hNon],
    [C("mineralocorticoid receptor antagonists"), "hyperkalaemia", null],
    [D("spironolactone"), "gynaecomastia", fGyn],
    [
      D("sacubitril/valsartan"),
      "angioedema",
      c("hf", 8, "Never use with an ACE inhibitor or after angioedema"),
    ],
    [D("clonidine"), "rebound hypertension", aClo],
    [C("beta-2 agonists"), "tremor", aB2],
    [
      C("muscarinic antagonists"),
      "dry mouth",
      c("chol", 8, "Dry mouth, constipation, urinary retention"),
    ],
    [C("muscarinic antagonists"), "urinary retention", cTox],
    [C("muscarinic antagonists"), "delirium", cDel],
    [
      D("midodrine"),
      "supine hypertension",
      c(
        "adr",
        8,
        "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
      ),
    ],
    [
      D("succinylcholine"),
      "malignant hyperthermia",
      c(
        "chol",
        9,
        "Succinylcholine | Depolarising | Hyperkalaemia; trigger for malignant hyperthermia",
      ),
    ],
    [
      D("succinylcholine"),
      "hyperkalaemia",
      c(
        "chol",
        9,
        "Succinylcholine | Depolarising | Hyperkalaemia; trigger for malignant hyperthermia",
      ),
    ],
  ];
  for (const [from, to, src] of causes) rel(from, "causes_adverse_effect", A(to), src);

  const X = (n) => ["contraindication", n];
  rel(C("ACE inhibitors"), "contraindicated_in", X("pregnancy"), hPreg);
  rel(C("angiotensin receptor blockers"), "contraindicated_in", X("pregnancy"), hPreg);
  rel(
    C("ACE inhibitors"),
    "contraindicated_in",
    X("history of ACE inhibitor angioedema"),
    c("htn", 11, "History of angioedema with an ACE inhibitor: do not use an ACE inhibitor again"),
  );
  rel(
    D("sacubitril/valsartan"),
    "contraindicated_in",
    X("history of ACE inhibitor angioedema"),
    c("hf", 8, "Never use with an ACE inhibitor or after angioedema"),
  );
  rel(
    C("ACE inhibitors"),
    "contraindicated_in",
    X("bilateral renal artery stenosis"),
    c(
      "htn",
      11,
      "Bilateral renal artery stenosis: ACE inhibitors and ARBs can cause acute kidney injury",
    ),
  );
  rel(
    C("beta blockers"),
    "contraindicated_in",
    X("second- or third-degree heart block"),
    c("beta", 8, "Severe bradycardia or second- or third-degree heart block without a pacemaker"),
  );
  rel(C("muscarinic antagonists"), "contraindicated_in", X("angle-closure glaucoma"), cGlau);
  rel(
    D("bethanechol"),
    "contraindicated_in",
    X("mechanical bladder or bowel obstruction"),
    c(
      "chol",
      3,
      "Bethanechol must never be used when the bladder or bowel is mechanically obstructed.",
    ),
  );
  rel(
    C("non-dihydropyridine calcium channel blockers"),
    "contraindicated_in",
    X("HFrEF"),
    c("htn", 9, "Heart rate; avoid in HFrEF"),
  );

  const P = (n) => ["monitoring_parameter", n];
  rel(
    C("beta blockers"),
    "monitored_by",
    P("heart rate"),
    c("beta", 11, "Check your pulse; report a heart rate that stays below 50"),
  );
  rel(C("beta blockers"), "monitored_by", P("blood pressure"), null);
  rel(C("ACE inhibitors"), "monitored_by", P("serum potassium"), hAce);
  rel(C("ACE inhibitors"), "monitored_by", P("serum creatinine"), hAce);
  rel(C("angiotensin receptor blockers"), "monitored_by", P("serum potassium"), hArb);
  rel(C("angiotensin receptor blockers"), "monitored_by", P("serum creatinine"), hArb);
  rel(
    C("thiazide diuretics"),
    "monitored_by",
    P("uric acid"),
    c("htn", 9, "Electrolytes, uric acid"),
  );
  rel(
    C("thiazide diuretics"),
    "monitored_by",
    P("serum potassium"),
    c("htn", 9, "Electrolytes, uric acid"),
  );
  rel(C("mineralocorticoid receptor antagonists"), "monitored_by", P("serum potassium"), fK);
  rel(
    D("sacubitril/valsartan"),
    "monitored_by",
    P("blood pressure"),
    c("hf", 8, "Watch blood pressure, potassium and renal function"),
  );

  const R = (n) => ["counselling_point", n];
  rel(C("beta blockers"), "related_to", R("do not stop abruptly"), bTaper);
  rel(D("clonidine"), "related_to", R("do not stop abruptly"), aClo);
  rel(
    D("carvedilol"),
    "related_to",
    R("take carvedilol with food"),
    c("beta", 11, "Take carvedilol with food to reduce dizziness"),
  );
  rel(
    C("beta blockers"),
    "related_to",
    R("rise slowly from sitting or lying"),
    c("beta", 11, "Rise slowly from sitting or lying"),
  );
  rel(
    D("scopolamine"),
    "related_to",
    R("apply the scopolamine patch 4 hours before travel"),
    c("chol", 11, "Scopolamine patch: apply behind the ear at least 4 hours before travel"),
  );
  rel(C("ACE inhibitors"), "related_to", R("use reliable contraception"), hPreg);
  rel(
    D("propranolol"),
    "related_to",
    ["other", "first-pass metabolism"],
    c("beta", 5, "Propranolol | High | Hepatic, large first-pass effect | 3 to 6 h"),
  );
  rel(
    D("rocuronium"),
    "related_to",
    D("sugammadex"),
    c("chol", 9, "Rocuronium | Nondepolarising | Reversed by sugammadex"),
  );
  rel(
    D("donepezil"),
    "related_to",
    ["other", "prescribing cascade"],
    c("chol", 11, "Donepezil plus oxybutynin: opposing effects, and a classic prescribing cascade"),
  );

  const ix = (a, b, severity, effect, src) =>
    rel(a, "interacts_with", b, src, { interaction: { severity, effect } });
  ix(
    C("beta blockers"),
    C("non-dihydropyridine calcium channel blockers"),
    "major",
    "Additive bradycardia and AV block",
    c("beta", 9, "Verapamil or diltiazem: additive bradycardia and AV block"),
  );
  ix(
    D("metoprolol succinate"),
    ["interaction", "CYP2D6 inhibition"],
    "moderate",
    "Higher metoprolol levels",
    c("beta", 9, "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels"),
  );
  ix(
    D("metoprolol tartrate"),
    ["interaction", "CYP2D6 inhibition"],
    "moderate",
    "Higher metoprolol levels",
    c("beta", 9, "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels"),
  );
  ix(
    C("ACE inhibitors"),
    C("angiotensin receptor blockers"),
    "major",
    "Hyperkalaemia and kidney injury without added benefit",
    hNever,
  );
  ix(
    C("ACE inhibitors"),
    D("sacubitril/valsartan"),
    "contraindicated",
    "Angioedema: leave 36 hours after the last ACE inhibitor dose",
    fGap,
  );
  ix(
    D("donepezil"),
    D("oxybutynin"),
    "moderate",
    "Opposing effects on acetylcholine",
    c("chol", 11, "Donepezil plus oxybutynin: opposing effects, and a classic prescribing cascade"),
  );
  ix(
    C("beta blockers"),
    D("clonidine"),
    "major",
    "Rebound hypertension when clonidine is withdrawn first",
    c("beta", 9, "Clonidine: stop the beta blocker first when withdrawing both"),
  );
  ix(
    D("spironolactone"),
    C("ACE inhibitors"),
    "moderate",
    "Additive hyperkalaemia: monitor potassium",
    null,
  );

  return { concepts, relations };
}
