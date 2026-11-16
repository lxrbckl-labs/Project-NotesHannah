// Practice questions, as an agent writes them: cited, tagged and filed under the lecture they test.
// `home` names where a question is filed (a lecture key, "calc" for the calculations folder or "top"
// for the Pharmacology II practice section). `key` lets guides, requests and the history refer to it.
// `solve` reads the numbers of a variant out of the prompt she is shown (expression questions only),
// so the seeder can answer it the way she would.

const mc = (prompt, options, explanation, extra = {}) => ({
  type: "multiple_choice",
  prompt,
  options: options.map(([text, correct, rationale]) => ({
    text,
    correct: Boolean(correct),
    ...(rationale ? { rationale } : {}),
  })),
  explanation,
  ...extra,
});
const sa = (prompt, options, explanation, extra = {}) => ({
  ...mc(prompt, options, explanation, extra),
  type: "select_all",
});
const match = (prompt, pairs, explanation, extra = {}) => ({
  type: "matching",
  prompt,
  pairs: pairs.map(([left, right]) => ({ left, right })),
  explanation,
  ...extra,
});
const blank = (text, blanks, explanation, extra = {}) => ({
  type: "fill_blank",
  text,
  blanks: blanks.map((answers) => ({ answers, allowTypos: answers.some((a) => a.length >= 6) })),
  explanation,
  ...extra,
});
const card = (front, back, extra = {}) => ({ type: "flashcard", front, back, ...extra });
const calc = (prompt, value, units, explanation, extra = {}) => ({
  type: "calculation",
  prompt,
  answer: { kind: "fixed", value },
  units,
  explanation,
  ...extra,
});
const free = (prompt, modelAnswer, rubric, explanation, extra = {}) => ({
  type: "free_response",
  prompt,
  modelAnswer,
  rubric: rubric.map(([point, points]) => ({ point, points })),
  explanation,
  ...extra,
});
const num = (text, pattern) => Number(pattern.exec(text)?.[1]);

export function questions({ c }) {
  const ans = (n, quote) => c("ans", n, quote);
  const chol = (n, quote) => c("chol", n, quote);
  const adr = (n, quote) => c("adr", n, quote);
  const beta = (n, quote) => c("beta", n, quote);
  const htn = (n, quote) => c("htn", n, quote);
  const hf = (n, quote) => c("hf", n, quote);
  const calcPage = (n, quote) => c("calc", n, quote);

  const out = [];
  const add = (home, q, opts = {}) => out.push({ home, q, ...opts });

  // ---- Lecture 7: autonomic overview ---------------------------------------------------------------
  add(
    "ans",
    mc(
      "Sympathetic fibres to sweat glands release which transmitter, onto which receptor?",
      [
        [
          "Acetylcholine onto muscarinic receptors",
          true,
          "The one sympathetic target that uses ACh.",
        ],
        [
          "Norepinephrine onto alpha-1 receptors",
          false,
          "This is the usual sympathetic target, not sweat glands.",
        ],
        ["Norepinephrine onto beta-2 receptors"],
        [
          "Acetylcholine onto nicotinic NN receptors",
          false,
          "NN receptors are on ganglion cells, not glands.",
        ],
      ],
      "Sweat glands receive sympathetic fibres, but those fibres release **acetylcholine** onto **muscarinic** receptors. That is why antimuscarinic drugs reduce sweating.",
      {
        sources: [
          ans(
            5,
            "Exception: sympathetic fibres to sweat glands release ACh onto muscarinic receptors",
          ),
        ],
        tags: ["autonomic", "receptors"],
        difficulty: 2,
      },
    ),
    { key: "ans-sweat" },
  );
  add(
    "ans",
    mc(
      "Stimulating which receptor slows the heart rate?",
      [["M2", true], ["M3"], ["beta-1", false, "beta-1 speeds the heart up."], ["alpha-1"]],
      "M2 receptors on the SA and AV nodes are Gi-coupled: they slow the heart rate and AV conduction.",
      {
        sources: [
          ans(6, "M2 | Gi-coupled | Heart (SA and AV nodes) | Slower heart rate and AV conduction"),
        ],
        tags: ["autonomic", "receptors"],
        difficulty: 1,
      },
    ),
  );
  add(
    "ans",
    sa(
      "Which receptors are Gq-coupled? Select all that apply.",
      [["alpha-1", true], ["M1", true], ["M3", true], ["alpha-2"], ["beta-2"], ["M2"]],
      "Gq: alpha-1, M1 and M3. Gi: alpha-2 and M2. Gs: every beta receptor.",
      {
        sources: [
          ans(6, "M3 | Gq-coupled | Smooth muscle, exocrine glands, vascular endothelium"),
          ans(
            7,
            "Memory hook: Gq contracts (alpha-1, M3), Gs relaxes or stimulates via cAMP (all beta), Gi inhibits (alpha-2, M2).",
          ),
        ],
        tags: ["autonomic", "receptors"],
        difficulty: 2,
      },
    ),
  );
  add(
    "ans",
    match(
      "Match each receptor with its main response.",
      [
        ["alpha-1", "Vasoconstriction"],
        ["alpha-2", "Less NE release"],
        ["beta-1", "Higher heart rate and contractility"],
        ["beta-2", "Bronchodilation"],
        ["M3", "Glandular secretion"],
        ["NM", "Skeletal muscle contraction"],
      ],
      "These six rows are the core of the receptor tables on slides 6 and 7.",
      {
        distractors: ["Lipolysis"],
        sources: [
          ans(
            7,
            "alpha-2 | Gi | Presynaptic nerve terminals, CNS | Less NE release; lower sympathetic outflow",
          ),
          ans(
            6,
            "NM (nicotinic, muscle) | Ligand-gated ion channel | Neuromuscular junction | Skeletal muscle contraction",
          ),
        ],
        tags: ["autonomic", "receptors"],
      },
    ),
  );
  add(
    "ans",
    blank(
      "The rate-limiting enzyme in norepinephrine synthesis is {{1}} hydroxylase.",
      [["tyrosine"]],
      "Tyrosine hydroxylase turns tyrosine into DOPA; metyrosine blocks it.",
      {
        sources: [
          ans(
            10,
            "Tyrosine to DOPA by tyrosine hydroxylase, the rate-limiting step (blocked by metyrosine)",
          ),
        ],
        tags: ["autonomic"],
        difficulty: 1,
      },
    ),
  );
  add(
    "ans",
    blank(
      "In the synapse, acetylcholine is broken down by {{1}}, while norepinephrine is mostly removed by {{2}}.",
      [
        ["acetylcholinesterase", "AChE", "cholinesterase"],
        ["reuptake", "NET", "uptake 1", "reuptake through NET"],
      ],
      "ACh is destroyed in the cleft; NE is mostly recycled into the nerve terminal through NET.",
      {
        sources: [
          ans(9, "Acetylcholinesterase splits ACh into choline and acetate in the synaptic cleft"),
          ans(
            10,
            "Action ends mainly by reuptake through NET (uptake 1), blocked by cocaine and tricyclic antidepressants",
          ),
        ],
        tags: ["autonomic"],
      },
    ),
  );
  add(
    "ans",
    card("Where do sympathetic fibres leave the CNS?", "Thoracolumbar: T1 to L2.", {
      sources: [ans(3, "Thoracolumbar (T1 to L2)")],
      tags: ["autonomic"],
      difficulty: 1,
    }),
  );
  add(
    "ans",
    card(
      "What does the adrenal medulla release, and roughly in what proportion?",
      "Mostly epinephrine (about 80%), plus norepinephrine, straight into the blood.",
      {
        sources: [
          ans(
            5,
            "Adrenal medulla: acts like a ganglion and releases epinephrine (about 80%) and NE into the blood",
          ),
        ],
        tags: ["autonomic"],
      },
    ),
  );
  add(
    "ans",
    mc(
      "Reserpine depletes norepinephrine stores by blocking which transporter?",
      [
        ["VMAT", true],
        ["NET", false, "NET is blocked by cocaine and tricyclics."],
        ["The choline transporter"],
        ["VAChT", false, "VAChT loads ACh, and is blocked by vesamicol."],
      ],
      "Reserpine blocks VMAT, so dopamine cannot be loaded into vesicles and NE stores run down.",
      {
        sources: [
          ans(10, "DOPA to dopamine; VMAT moves dopamine into vesicles (blocked by reserpine)"),
        ],
        tags: ["autonomic"],
        difficulty: 2,
      },
    ),
  );
  add(
    "ans",
    mc(
      "Stimulating which receptor dilates the pupil?",
      [
        ["alpha-1", true, "alpha-1 contracts the iris dilator muscle."],
        ["M3", false, "M3 causes miosis."],
        ["beta-1"],
        ["alpha-2"],
      ],
      "Mydriasis is an alpha-1 effect; miosis is an M3 effect. Blocking M3 also dilates the pupil.",
      {
        sources: [ans(8, "Pupil | Dilate: mydriasis (alpha-1) | Constrict: miosis (M3)")],
        tags: ["autonomic", "receptors"],
        difficulty: 1,
      },
    ),
  );
  add(
    "ans",
    free(
      "Explain how the action of norepinephrine at the synapse ends, and why cocaine increases sympathetic effects.",
      "Most norepinephrine is taken back into the nerve terminal by the norepinephrine transporter (NET, uptake 1); what is left is broken down by MAO and COMT. Cocaine blocks NET, so NE stays in the synaptic cleft longer and keeps stimulating adrenergic receptors.",
      [
        ["Most NE is taken back up into the nerve terminal by NET (uptake 1)", 2],
        ["The rest is broken down by MAO and COMT", 1],
        ["Cocaine blocks NET, so NE stays in the cleft and keeps acting", 2],
      ],
      "Reuptake, not breakdown, is the main way NE's action ends, which is why reuptake blockers raise synaptic NE.",
      {
        sources: [
          ans(
            10,
            "Action ends mainly by reuptake through NET (uptake 1), blocked by cocaine and tricyclic antidepressants",
          ),
          ans(10, "Broken down by MAO (in the nerve terminal) and COMT"),
        ],
        tags: ["autonomic"],
        difficulty: 3,
      },
    ),
  );

  // ---- Lecture 8: cholinergic drugs ----------------------------------------------------------------
  add(
    "chol",
    mc(
      "Which drug treats non-obstructive urinary retention?",
      [
        ["Bethanechol", true],
        ["Oxybutynin", false, "An antimuscarinic: it causes retention."],
        ["Atropine"],
        ["Tiotropium"],
      ],
      "Bethanechol is a muscarinic agonist that contracts the detrusor; it must not be used if the outflow is obstructed.",
      {
        sources: [
          chol(
            3,
            "Bethanechol | Muscarinic selective; not broken down by acetylcholinesterase | Non-obstructive urinary retention",
          ),
        ],
        tags: ["cholinergic"],
        difficulty: 1,
      },
    ),
  );
  add(
    "chol",
    sa(
      "Which are signs of muscarinic excess? Select all that apply.",
      [
        ["Miosis", true],
        ["Bradycardia", true],
        ["Bronchorrhoea", true],
        ["Salivation", true],
        ["Mydriasis"],
        ["Dry, hot skin"],
      ],
      "Muscarinic excess: diarrhoea, urination, miosis, bronchospasm and bronchorrhoea, bradycardia, emesis, lacrimation, salivation, sweating. Mydriasis and dry skin are anticholinergic signs.",
      {
        sources: [
          chol(4, "Diarrhoea, urination, miosis"),
          chol(4, "Bronchospasm and bronchorrhoea, bradycardia"),
        ],
        tags: ["cholinergic", "toxicology"],
      },
    ),
  );
  add(
    "chol",
    match(
      "Match each drug with its main use.",
      [
        ["Neostigmine", "Reversal of nondepolarising neuromuscular block"],
        ["Pyridostigmine", "Myasthenia gravis, oral maintenance"],
        ["Physostigmine", "Severe anticholinergic toxicity"],
        ["Donepezil", "Alzheimer disease"],
        ["Pralidoxime", "Organophosphate poisoning"],
      ],
      "Physostigmine is the one that enters the CNS, so it can reverse central anticholinergic toxicity.",
      {
        distractors: ["Motion sickness"],
        sources: [
          chol(
            5,
            "Physostigmine | Reversible; tertiary, enters the CNS | Severe anticholinergic toxicity",
          ),
          chol(6, "Pralidoxime regenerates acetylcholinesterase if given before the enzyme ages"),
        ],
        tags: ["cholinergic"],
      },
    ),
  );
  add(
    "chol",
    {
      type: "case",
      vignette:
        "A 38-year-old farm worker is brought in after spraying an insecticide without protection. He is drooling and wheezing with copious bronchial secretions, his pupils are pinpoint, his heart rate is 44 beats per minute, and his arm muscles are twitching.",
      questions: [
        mc(
          "Which drug should be given first?",
          [
            ["Atropine", true],
            [
              "Pralidoxime",
              false,
              "Important, but it does not treat the life-threatening secretions.",
            ],
            ["Physostigmine", false, "A cholinesterase inhibitor: it would make him worse."],
            ["Neostigmine"],
          ],
          "Atropine blocks the muscarinic effects that threaten the airway: secretions, bronchospasm and bradycardia.",
        ),
        mc(
          "What is the best end point for titrating atropine?",
          [
            ["Dry bronchial secretions", true],
            ["Normal pupil size", false, "Pupil size is a poor end point."],
            ["Heart rate above 120"],
            [
              "No more muscle twitching",
              false,
              "Twitching is nicotinic; atropine does not treat it.",
            ],
          ],
          "Repeat atropine until bronchial secretions are dry and oxygenation is adequate.",
        ),
        mc(
          "Why is pralidoxime added?",
          [
            ["It regenerates acetylcholinesterase before the enzyme ages", true],
            ["It blocks nicotinic receptors"],
            ["It blocks muscarinic receptors"],
            ["It speeds renal excretion of the insecticide"],
          ],
          "Pralidoxime pulls the organophosphate off the enzyme, which also helps the nicotinic signs that atropine cannot treat.",
        ),
      ],
      explanation:
        "Organophosphate poisoning: atropine for muscarinic signs, pralidoxime early, benzodiazepines for seizures.",
      sources: [
        chol(6, "Atropine: repeat and titrate until bronchial secretions are dry"),
        chol(6, "Pralidoxime regenerates acetylcholinesterase if given before the enzyme ages"),
        chol(6, "Pupil size is a poor end point for atropine."),
      ],
      tags: ["cholinergic", "toxicology", "case"],
      difficulty: 3,
    },
    { key: "chol-op-case" },
  );
  add(
    "chol",
    mc(
      "Which antimuscarinic is used as a transdermal patch for motion sickness?",
      [["Scopolamine", true], ["Glycopyrrolate"], ["Ipratropium"], ["Benztropine"]],
      "Scopolamine has a marked CNS effect; the patch goes behind the ear at least 4 hours before travel.",
      {
        sources: [chol(7, "Scopolamine | Marked CNS effect | Motion sickness (transdermal patch)")],
        tags: ["cholinergic"],
        difficulty: 1,
      },
    ),
  );
  add(
    "chol",
    blank(
      "Atropine for symptomatic bradycardia: {{1}} mg IV every 3 to 5 minutes, up to a maximum of {{2}} mg.",
      [["1"], ["3"]],
      "1 mg IV every 3 to 5 minutes, maximum 3 mg.",
      {
        sources: [chol(10, "1 mg IV every 3 to 5 minutes, maximum 3 mg")],
        tags: ["cholinergic", "doses"],
      },
    ),
  );
  add(
    "chol",
    card(
      "Why is neostigmine given together with glycopyrrolate?",
      "Neostigmine raises ACh to reverse the neuromuscular block; glycopyrrolate blocks the muscarinic effects of that extra ACh (bradycardia, secretions).",
      {
        sources: [
          chol(
            9,
            "Neostigmine reverses nondepolarising block and is given with glycopyrrolate to block its muscarinic effects.",
          ),
        ],
        tags: ["cholinergic"],
      },
    ),
  );
  add(
    "chol",
    card(
      "Which neuromuscular blocker is cleared by Hofmann elimination?",
      "Cisatracurium: useful in renal or hepatic failure.",
      {
        sources: [
          chol(
            9,
            "Cisatracurium | Nondepolarising | Hofmann elimination: useful in renal or hepatic failure",
          ),
        ],
        tags: ["cholinergic"],
      },
    ),
  );
  add(
    "chol",
    mc(
      "Which neuromuscular blocker is reversed by sugammadex?",
      [
        ["Rocuronium", true],
        ["Succinylcholine"],
        ["Cisatracurium"],
        ["Neostigmine", false, "Neostigmine is a reversal agent itself."],
      ],
      "Sugammadex encapsulates rocuronium and vecuronium.",
      {
        sources: [chol(9, "Rocuronium | Nondepolarising | Reversed by sugammadex")],
        tags: ["cholinergic"],
        difficulty: 1,
      },
    ),
  );
  add(
    "chol",
    sa(
      "Which of these are quaternary amines that stay out of the brain? Select all that apply.",
      [
        ["Neostigmine", true],
        ["Glycopyrrolate", true],
        ["Ipratropium", true],
        ["Physostigmine"],
        ["Atropine"],
        ["Scopolamine"],
      ],
      "Quaternary amines carry a permanent charge and do not cross the blood-brain barrier. Physostigmine, atropine and scopolamine are tertiary.",
      {
        sources: [
          chol(
            11,
            "Quaternary amines (neostigmine, glycopyrrolate, ipratropium) do not cross the blood-brain barrier",
          ),
        ],
        tags: ["cholinergic"],
        difficulty: 2,
      },
    ),
  );
  add(
    "chol",
    mc(
      "An adult has symptomatic bradycardia. What atropine dose does the lecture give?",
      [
        ["1 mg IV every 3 to 5 minutes, maximum 3 mg", true],
        ["0.5 mg IV every 3 to 5 minutes, maximum 3 mg", false, "An older dose, replaced by 1 mg."],
        ["2 mg IV once"],
        ["0.1 mg IV every minute"],
      ],
      "The lecture uses 1 mg IV every 3 to 5 minutes up to 3 mg.",
      {
        sources: [chol(10, "1 mg IV every 3 to 5 minutes, maximum 3 mg")],
        tags: ["cholinergic", "doses"],
        difficulty: 2,
      },
    ),
    { key: "chol-atropine-dose" },
  );

  // ---- Lecture 9: adrenergic agonists --------------------------------------------------------------
  add(
    "adr",
    mc(
      "What is the first-choice vasopressor in septic shock?",
      [
        ["Norepinephrine", true],
        ["Dopamine"],
        ["Phenylephrine"],
        ["Dobutamine", false, "An inotrope, not a vasopressor."],
      ],
      "Norepinephrine is the first-choice vasopressor in septic shock.",
      {
        sources: [adr(6, "Septic shock: norepinephrine is the first-choice vasopressor")],
        tags: ["adrenergic", "shock"],
        difficulty: 1,
      },
    ),
    { key: "adr-shock" },
  );
  add(
    "adr",
    mc(
      "A patient is in anaphylaxis. How should epinephrine be given?",
      [
        ["IM into the anterolateral thigh", true],
        ["IV push of the 1 mg/mL strength", false, "1 mg/mL is never pushed IV."],
        ["Subcutaneously into the arm"],
        ["Inhaled"],
      ],
      "Epinephrine IM into the anterolateral thigh, first and without delay.",
      {
        sources: [
          adr(
            6,
            "Anaphylaxis: epinephrine IM into the anterolateral thigh, first and without delay",
          ),
          adr(10, "The 1 mg/mL strength is for IM use only, never IV push."),
        ],
        tags: ["adrenergic"],
        difficulty: 1,
      },
    ),
  );
  add(
    "adr",
    sa(
      "Which are adverse effects of beta-2 agonists? Select all that apply.",
      [
        ["Tremor", true],
        ["Tachycardia", true],
        ["Hypokalaemia", true],
        ["Hyperglycaemia", true],
        ["Bradycardia"],
        ["Hyperkalaemia"],
      ],
      "Beta-2 agonists drive potassium into cells (hypokalaemia) and raise glucose; tremor and tachycardia are common.",
      {
        sources: [
          adr(
            7,
            "Adverse effects of beta-2 agonists: tremor, tachycardia, hypokalaemia and hyperglycaemia.",
          ),
        ],
        tags: ["adrenergic"],
      },
    ),
  );
  add(
    "adr",
    match(
      "Match each drug with the receptors it mainly acts on.",
      [
        ["Phenylephrine", "alpha-1"],
        ["Clonidine", "alpha-2 (central)"],
        ["Dobutamine", "Mainly beta-1"],
        ["Albuterol", "beta-2"],
        ["Isoproterenol", "beta-1 and beta-2"],
      ],
      "Receptor profile predicts the effect: phenylephrine constricts vessels, dobutamine strengthens contraction, albuterol bronchodilates.",
      {
        distractors: ["D1 only"],
        sources: [
          adr(4, "Phenylephrine | alpha-1 | Vasoconstriction; reflex bradycardia"),
          adr(4, "Isoproterenol | beta-1, beta-2 | Raises heart rate; vasodilates"),
        ],
        tags: ["adrenergic", "receptors"],
      },
    ),
  );
  add(
    "adr",
    calc(
      "Epinephrine 1 mg/mL is used for anaphylaxis. How many mL give a 0.3 mg IM dose?",
      0.3,
      ["mL"],
      "0.3 mg / 1 mg per mL = 0.3 mL.",
      {
        tolerance: { mode: "absolute", amount: 0.01 },
        sources: [
          adr(
            10,
            "0.3 to 0.5 mg IM (1 mg/mL) in the thigh; repeat every 5 to 15 minutes if needed",
          ),
        ],
        tags: ["adrenergic", "calculations"],
        difficulty: 1,
      },
    ),
    { key: "adr-epi-volume" },
  );
  add(
    "adr",
    card(
      "Why can phenylephrine cause reflex bradycardia?",
      "It is a pure alpha-1 agonist: blood pressure rises with no beta-1 push on the heart, so the baroreceptor reflex slows the heart rate.",
      {
        sources: [adr(4, "Phenylephrine | alpha-1 | Vasoconstriction; reflex bradycardia")],
        tags: ["adrenergic"],
      },
    ),
  );
  add(
    "adr",
    blank(
      "In asthma a LABA must always be paired with an inhaled {{1}}.",
      [["corticosteroid", "steroid", "ICS"]],
      "LABA monotherapy is avoided in asthma; it is always given with an inhaled corticosteroid.",
      {
        sources: [adr(7, "In asthma a LABA is always paired with an inhaled corticosteroid.")],
        tags: ["adrenergic", "respiratory"],
        difficulty: 1,
      },
    ),
  );
  add(
    "adr",
    mc(
      "Which drug treats orthostatic hypotension and must be taken while upright, with the last dose at least 4 hours before bedtime?",
      [["Midodrine", true], ["Clonidine"], ["Methyldopa"], ["Oxymetazoline"]],
      "Midodrine is an alpha-1 prodrug; taking it late causes supine hypertension.",
      {
        sources: [
          adr(
            8,
            "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
          ),
        ],
        tags: ["adrenergic"],
      },
    ),
  );
  add(
    "adr",
    card(
      "Dopamine: which receptors at low, intermediate and high doses?",
      "Low: D1. Intermediate: beta-1. High: alpha-1.",
      {
        sources: [
          adr(5, "Low dose: D1 receptors, renal and mesenteric vasodilation"),
          adr(5, "High dose: alpha-1, vasoconstriction"),
        ],
        tags: ["adrenergic"],
      },
    ),
  );
  add(
    "adr",
    free(
      "Why should clonidine not be stopped suddenly, and what is the order when a patient is coming off both clonidine and a beta blocker?",
      "Stopping clonidine suddenly removes its central alpha-2 brake on sympathetic outflow and causes rebound hypertension, so it is tapered. When both drugs are being withdrawn, the beta blocker is stopped first, so that the rebound surge of NE does not act on alpha receptors with the beta receptors blocked.",
      [
        ["Sudden withdrawal causes rebound hypertension", 2],
        ["Clonidine should be tapered", 1],
        ["Stop the beta blocker first when withdrawing both", 2],
      ],
      "Rebound hypertension after clonidine is worse when beta receptors are blocked and alpha receptors are not.",
      {
        sources: [
          adr(
            8,
            "Clonidine (alpha-2): hypertension, ADHD, withdrawal symptoms; rebound hypertension if stopped suddenly",
          ),
          beta(9, "Clonidine: stop the beta blocker first when withdrawing both"),
        ],
        tags: ["adrenergic", "interactions"],
        difficulty: 3,
      },
    ),
  );

  // ---- Lecture 10: beta blockers -------------------------------------------------------------------
  add(
    "beta",
    mc(
      "Which beta blocker has NOT been shown to lower mortality in HFrEF?",
      [
        ["Metoprolol tartrate", true, "Only the succinate salt has HFrEF outcome data."],
        ["Metoprolol succinate"],
        ["Carvedilol"],
        ["Bisoprolol"],
      ],
      "Only bisoprolol, carvedilol and metoprolol succinate are used in HFrEF.",
      {
        sources: [beta(6, "HFrEF: only bisoprolol, carvedilol and metoprolol succinate")],
        tags: ["beta blockers", "heart failure"],
        difficulty: 2,
      },
    ),
    { key: "beta-hfref" },
  );
  add(
    "beta",
    sa(
      "Which are beta-1 selective (cardioselective)? Select all that apply.",
      [
        ["Atenolol", true],
        ["Metoprolol", true],
        ["Bisoprolol", true],
        ["Esmolol", true],
        ["Propranolol"],
        ["Nadolol"],
        ["Carvedilol", false, "Mixed alpha-1 and beta."],
      ],
      "Cardioselective: atenolol, metoprolol, bisoprolol, esmolol (and nebivolol). Selectivity is lost at high doses.",
      {
        sources: [
          beta(
            4,
            "Beta-1 selective (cardioselective) | Atenolol, metoprolol, bisoprolol, esmolol | Selectivity is lost at high doses",
          ),
        ],
        tags: ["beta blockers"],
      },
    ),
  );
  add(
    "beta",
    match(
      "Match each beta blocker with the property that sets it apart.",
      [
        ["Esmolol", "Half-life of about 9 minutes"],
        ["Nadolol", "Renal elimination, half-life about a day"],
        ["Propranolol", "Lipophilic, large first-pass effect"],
        ["Carvedilol", "Blocks alpha-1 as well as beta"],
        ["Nebivolol", "Beta-1 selective with nitric oxide vasodilation"],
        ["Pindolol", "Intrinsic sympathomimetic activity"],
      ],
      "These properties decide when each drug is chosen: esmolol for an IV drip that can be switched off, propranolol for migraine and tremor, carvedilol for extra vasodilation.",
      {
        sources: [
          beta(5, "Esmolol | Low | Red blood cell esterases | About 9 minutes"),
          beta(
            4,
            "Intrinsic sympathomimetic activity | Pindolol, acebutolol | Less slowing of the resting heart rate",
          ),
        ],
        tags: ["beta blockers"],
        difficulty: 2,
      },
    ),
  );
  add(
    "beta",
    mc(
      "A patient on insulin starts propranolol. Which warning sign of hypoglycaemia still occurs?",
      [
        ["Sweating", true, "Sweat glands are cholinergic, so beta blockade does not stop it."],
        ["Tremor"],
        ["Palpitations"],
        ["Tachycardia"],
      ],
      "Beta blockers mask tremor and palpitations; sweating still happens because sweat glands use ACh.",
      {
        sources: [
          beta(
            7,
            "Masks warning signs of hypoglycaemia (tremor, palpitations); sweating still occurs",
          ),
        ],
        tags: ["beta blockers", "diabetes"],
      },
    ),
  );
  add(
    "beta",
    blank(
      "When stopping a beta blocker, taper over {{1}} to {{2}} weeks.",
      [
        ["1", "one"],
        ["2", "two"],
      ],
      "Abrupt withdrawal can cause rebound tachycardia, angina or even MI.",
      {
        sources: [beta(11, "Do not stop suddenly: taper over 1 to 2 weeks")],
        tags: ["beta blockers", "counselling"],
        difficulty: 1,
      },
    ),
  );
  add(
    "beta",
    card(
      "Which two beta blockers are renally cleared and build up in kidney disease?",
      "Atenolol and nadolol.",
      {
        sources: [beta(5, "Renally cleared atenolol and nadolol accumulate in kidney disease.")],
        tags: ["beta blockers", "renal"],
      },
    ),
  );
  add(
    "beta",
    mc(
      "Which combination risks additive bradycardia and AV block?",
      [
        ["Metoprolol with diltiazem", true],
        [
          "Metoprolol with amlodipine",
          false,
          "Amlodipine is a dihydropyridine: little effect on the AV node.",
        ],
        ["Carvedilol with lisinopril"],
        ["Atenolol with chlorthalidone"],
      ],
      "Verapamil and diltiazem slow the AV node, adding to beta blockade.",
      {
        sources: [beta(9, "Verapamil or diltiazem: additive bradycardia and AV block")],
        tags: ["beta blockers", "interactions"],
      },
    ),
  );
  add(
    "beta",
    free(
      "A patient with asthma needs a beta blocker after a myocardial infarction. Explain the risk and how you would choose the drug.",
      "Non-selective beta blockers also block beta-2 receptors in the airways and can cause bronchospasm, so they are avoided. If a beta blocker is needed, choose a cardioselective (beta-1 selective) agent such as bisoprolol or metoprolol, start at a low dose because selectivity is lost at higher doses, and watch for wheeze.",
      [
        ["Non-selective agents block beta-2 and can cause bronchospasm", 2],
        ["Choose a cardioselective agent (bisoprolol, metoprolol, atenolol)", 2],
        ["Use a low dose because selectivity fades at high doses", 1],
      ],
      "Cardioselective does not mean cardiac-only.",
      {
        sources: [
          beta(
            8,
            "Asthma: avoid non-selective agents; a cardioselective agent at low dose if one is needed",
          ),
          beta(4, "Cardioselective does not mean cardiac-only."),
        ],
        tags: ["beta blockers", "respiratory"],
        difficulty: 3,
      },
    ),
  );
  add(
    "beta",
    card("Starting dose of carvedilol for hypertension?", "6.25 mg twice daily, with food.", {
      sources: [beta(10, "Carvedilol | 6.25 mg | Twice daily with food")],
      tags: ["beta blockers", "doses"],
    }),
  );
  add(
    "beta",
    mc(
      "Which drug raises metoprolol levels by inhibiting CYP2D6?",
      [["Paroxetine", true], ["Amlodipine"], ["Lisinopril"], ["Furosemide"]],
      "Fluoxetine and paroxetine inhibit CYP2D6, the main route for metoprolol.",
      {
        sources: [beta(9, "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels")],
        tags: ["beta blockers", "interactions"],
      },
    ),
  );

  // ---- Pharmacotherapy I, lecture 8: hypertension --------------------------------------------------
  add(
    "htn",
    {
      type: "case",
      vignette:
        "A 54-year-old Black man has blood pressures of 152/96 and 148/94 mm Hg at two clinic visits, confirmed with home readings. He has no diabetes, chronic kidney disease or heart failure, and his labs are normal.",
      questions: [
        mc(
          "How is his blood pressure classified?",
          [
            ["Stage 2 hypertension", true],
            ["Stage 1 hypertension"],
            ["Elevated"],
            ["Hypertensive crisis"],
          ],
          "Systolic 140 or higher (or diastolic 90 or higher) is stage 2.",
        ),
        mc(
          "Which starting regimen fits the 2017 guideline?",
          [
            [
              "Chlorthalidone plus amlodipine",
              true,
              "Two first-line drugs of different classes; thiazide or CCB first in a Black adult.",
            ],
            ["Lisinopril plus losartan", false, "ACE inhibitor plus ARB is never combined."],
            ["Metoprolol alone", false, "Beta blockers are not first line here."],
            ["Lifestyle changes alone for 6 months"],
          ],
          "He is more than 20/10 mm Hg above goal, so start two first-line drugs of different classes.",
        ),
        blank(
          "His blood pressure goal is below {{1}}/80 mm Hg.",
          [["130"]],
          "Below 130/80 mm Hg for most adults.",
        ),
      ],
      explanation:
        "Stage 2, well above goal, no compelling indication: two first-line drugs, starting with a thiazide or CCB.",
      sources: [
        htn(3, "Stage 2 hypertension | 140 or higher | or | 90 or higher"),
        htn(
          5,
          "Start two first-line drugs of different classes if BP is more than 20/10 mm Hg above goal",
        ),
        htn(
          7,
          "Black adults without heart failure or CKD: start with a thiazide or a calcium channel blocker",
        ),
        htn(5, "Goal for most adults: below 130/80 mm Hg"),
      ],
      tags: ["hypertension", "case"],
      difficulty: 3,
    },
    { key: "htn-case" },
  );
  add(
    "htn",
    mc(
      "A blood pressure of 128/84 mm Hg is classified as:",
      [
        [
          "Stage 1 hypertension",
          true,
          "The diastolic is in the stage 1 range, and the higher category wins.",
        ],
        ["Elevated"],
        ["Normal"],
        ["Stage 2 hypertension"],
      ],
      "Use the higher category when systolic and diastolic disagree: a diastolic of 84 is stage 1.",
      {
        sources: [
          htn(3, "Stage 1 hypertension | 130 to 139 | or | 80 to 89"),
          htn(
            3,
            "When systolic and diastolic fall in different categories, use the higher category.",
          ),
        ],
        tags: ["hypertension"],
      },
    ),
  );
  add(
    "htn",
    sa(
      "Which are first-line drug classes for hypertension? Select all that apply.",
      [
        ["Thiazide-type diuretic", true],
        ["ACE inhibitor", true],
        ["ARB", true],
        ["Dihydropyridine CCB", true],
        ["Beta blocker"],
        ["Alpha-1 blocker"],
        ["Loop diuretic"],
      ],
      "Thiazides, ACE inhibitors, ARBs and dihydropyridine CCBs. Beta blockers need a compelling reason.",
      {
        sources: [
          htn(7, "Thiazide-type diuretics (chlorthalidone preferred)"),
          htn(7, "Dihydropyridine calcium channel blockers"),
        ],
        tags: ["hypertension"],
        difficulty: 1,
      },
    ),
  );
  add(
    "htn",
    match(
      "Match each class with a typical adverse effect.",
      [
        ["ACE inhibitor", "Dry cough"],
        ["Thiazide", "Gout from high uric acid"],
        ["Dihydropyridine CCB", "Ankle oedema"],
        ["Verapamil", "Constipation"],
        ["ARB", "High potassium without cough"],
      ],
      "Each first-line class has a signature adverse effect worth knowing for counselling.",
      {
        sources: [
          htn(
            9,
            "ACE inhibitor | Lisinopril, enalapril | Dry cough, high potassium, angioedema, rise in creatinine",
          ),
          htn(
            9,
            "Dihydropyridine CCB | Amlodipine, nifedipine ER | Ankle oedema, headache, flushing",
          ),
        ],
        tags: ["hypertension", "adverse effects"],
      },
    ),
  );
  add(
    "htn",
    mc(
      "Which drug is preferred for hypertension in pregnancy?",
      [
        ["Labetalol", true],
        ["Lisinopril", false, "Fetotoxic."],
        ["Losartan", false, "Fetotoxic."],
        ["Aliskiren", false, "Fetotoxic."],
      ],
      "Labetalol or nifedipine; ACE inhibitors, ARBs and aliskiren are avoided.",
      {
        sources: [
          htn(8, "Pregnancy | Labetalol or nifedipine; avoid ACE inhibitors, ARBs and aliskiren"),
        ],
        tags: ["hypertension", "pregnancy"],
        difficulty: 1,
      },
    ),
  );
  add(
    "htn",
    blank(
      "The usual starting dose of lisinopril for hypertension is {{1}} mg once daily.",
      [["10"]],
      "10 mg once daily; start at 5 mg in older adults or when already on a diuretic.",
      {
        sources: [htn(10, "Lisinopril | Zestril, Prinivil | 10 mg once daily | 10 to 40 mg")],
        tags: ["hypertension", "doses"],
      },
    ),
  );
  add(
    "htn",
    card(
      "About how much does the DASH eating pattern lower systolic blood pressure?",
      "About 11 mm Hg.",
      {
        sources: [htn(6, "DASH eating pattern | About 11 mm Hg")],
        tags: ["hypertension", "lifestyle"],
      },
    ),
  );
  add(
    "htn",
    card(
      "What rise in serum creatinine is expected after starting an ACE inhibitor or ARB?",
      "Up to 30%.",
      {
        sources: [
          htn(
            11,
            "A rise in serum creatinine of up to 30% after starting an ACE inhibitor or ARB is expected",
          ),
        ],
        tags: ["hypertension", "renal"],
      },
    ),
  );
  add(
    "htn",
    mc(
      "Which pair should never be combined?",
      [
        ["ACE inhibitor and ARB", true],
        ["ACE inhibitor and thiazide"],
        ["ARB and amlodipine"],
        ["Thiazide and amlodipine"],
      ],
      "Combining an ACE inhibitor with an ARB adds hyperkalaemia and kidney injury without benefit.",
      {
        sources: [htn(7, "Never combine an ACE inhibitor with an ARB")],
        tags: ["hypertension"],
        difficulty: 1,
      },
    ),
  );
  add(
    "htn",
    free(
      "A 30-year-old woman taking lisinopril says she is planning a pregnancy. What do you advise?",
      "Lisinopril, like every ACE inhibitor, ARB and aliskiren, is fetotoxic. She should switch before trying to conceive, to labetalol or nifedipine, and use reliable contraception while she is still on lisinopril.",
      [
        ["ACE inhibitors are fetotoxic and must be stopped before pregnancy", 2],
        ["Switch to labetalol or nifedipine", 2],
        ["Counsel on contraception while on an ACE inhibitor", 1],
      ],
      "Planning ahead avoids exposure in the first weeks, before a pregnancy is recognised.",
      {
        sources: [
          htn(
            11,
            "ACE inhibitors, ARBs and aliskiren are fetotoxic: avoid in pregnancy and counsel on contraception",
          ),
          htn(8, "Pregnancy | Labetalol or nifedipine; avoid ACE inhibitors, ARBs and aliskiren"),
        ],
        tags: ["hypertension", "pregnancy", "counselling"],
        difficulty: 2,
      },
    ),
  );

  // ---- Pharmacotherapy I, lecture 9: heart failure -------------------------------------------------
  add(
    "hf",
    {
      type: "case",
      vignette:
        "A 66-year-old woman with HFrEF (LVEF 30%, NYHA class II) takes lisinopril 10 mg daily, furosemide 40 mg daily and metoprolol tartrate 25 mg twice daily. Potassium is 4.4 mEq/L, eGFR 55 mL/min/1.73 m2, blood pressure 118/72 mm Hg and heart rate 74.",
      questions: [
        sa(
          "Which changes bring her closer to guideline-directed therapy? Select all that apply.",
          [
            ["Switch metoprolol tartrate to metoprolol succinate", true],
            ["Add dapagliflozin 10 mg daily", true],
            ["Add spironolactone", true, "Potassium below 5.0 and eGFR above 30: she qualifies."],
            ["Add diltiazem to slow her heart rate", false, "A negative inotrope: avoid in HFrEF."],
            ["Add ibuprofen for her knee pain", false, "NSAIDs worsen heart failure."],
          ],
          "She has one pillar (an ACE inhibitor) and the wrong beta blocker salt. Add the missing pillars.",
        ),
        mc(
          "She will switch from lisinopril to sacubitril/valsartan. When can the first dose be given?",
          [
            ["At least 36 hours after the last lisinopril dose", true],
            ["With her next lisinopril dose"],
            ["12 hours after the last lisinopril dose"],
            ["24 hours after the last lisinopril dose"],
          ],
          "A 36-hour washout lowers the risk of angioedema.",
        ),
        blank(
          "After starting spironolactone, recheck potassium and renal function within about {{1}} week.",
          [["1", "one"]],
          "Within about 1 week, then regularly.",
        ),
      ],
      explanation:
        "Build toward all four pillars, at low doses, and check potassium and renal function along the way.",
      sources: [
        hf(
          6,
          "Evidence-based beta blocker | Bisoprolol, carvedilol, metoprolol succinate | Lower mortality",
        ),
        hf(8, "Stop an ACE inhibitor at least 36 hours before the first dose"),
        hf(9, "Recheck potassium and renal function within about 1 week, then regularly"),
        hf(9, "Start only if potassium is below 5.0 mEq/L and eGFR is above 30 mL/min/1.73 m2"),
      ],
      tags: ["heart failure", "case"],
      difficulty: 3,
    },
    { key: "hf-case" },
  );
  add(
    "hf",
    mc(
      "A patient's LVEF is 45%. How is the heart failure classified?",
      [
        ["HFmrEF (mildly reduced)", true],
        ["HFrEF (reduced)"],
        ["HFpEF (preserved)"],
        ["HFimpEF (improved)", false, "Needs a previous LVEF of 40% or less."],
      ],
      "41% to 49% is mildly reduced.",
      {
        sources: [hf(3, "HFmrEF (mildly reduced) | 41% to 49%")],
        tags: ["heart failure"],
        difficulty: 1,
      },
    ),
  );
  add(
    "hf",
    match(
      "Match each pillar of HFrEF therapy with an example.",
      [
        ["ARNI", "Sacubitril/valsartan"],
        ["MRA", "Eplerenone"],
        ["SGLT2 inhibitor", "Empagliflozin"],
        ["Evidence-based beta blocker", "Bisoprolol"],
      ],
      "Four pillars: ARNI (or ACE inhibitor or ARB), beta blocker, MRA, SGLT2 inhibitor.",
      {
        distractors: ["Diltiazem", "Digoxin"],
        sources: [
          hf(
            6,
            "Mineralocorticoid receptor antagonist (MRA) | Spironolactone, eplerenone | Lower mortality",
          ),
          hf(6, "SGLT2 inhibitor | Dapagliflozin, empagliflozin"),
        ],
        tags: ["heart failure"],
      },
    ),
  );
  add(
    "hf",
    calc(
      "A 92 kg patient with HFrEF is titrated to the target dose of carvedilol. What is the total daily dose?",
      100,
      ["mg"],
      "Above 85 kg the target is 50 mg twice daily: 50 x 2 = 100 mg a day.",
      {
        tolerance: { mode: "absolute", amount: 0.5 },
        sources: [hf(7, "25 mg twice daily (50 mg twice daily if over 85 kg)")],
        tags: ["heart failure", "doses"],
      },
    ),
  );
  add(
    "hf",
    sa(
      "Which drugs can make HFrEF worse? Select all that apply.",
      [
        ["Ibuprofen", true],
        ["Diltiazem", true],
        ["Pioglitazone", true],
        ["Verapamil", true],
        ["Amiodarone", false, "One of the antiarrhythmics that is acceptable."],
        ["Dapagliflozin"],
        ["Furosemide"],
      ],
      "NSAIDs, non-dihydropyridine CCBs, thiazolidinediones and most antiarrhythmics worsen HFrEF.",
      {
        sources: [
          hf(11, "NSAIDs: salt and water retention, worse renal function"),
          hf(11, "Thiazolidinediones (pioglitazone): fluid retention"),
        ],
        tags: ["heart failure"],
      },
    ),
  );
  add(
    "hf",
    blank(
      "Furosemide 40 mg by mouth is roughly equal to bumetanide {{1}} mg or torsemide {{2}} mg.",
      [
        ["1", "one"],
        ["20", "twenty"],
      ],
      "Furosemide 40 mg PO = furosemide 20 mg IV = bumetanide 1 mg = torsemide 20 mg (approximately).",
      {
        sources: [
          hf(10, "furosemide 40 mg PO, furosemide 20 mg IV, bumetanide 1 mg, torsemide 20 mg"),
        ],
        tags: ["heart failure", "doses"],
      },
    ),
  );
  add(
    "hf",
    card(
      "Why is there a 36-hour gap between an ACE inhibitor and sacubitril/valsartan?",
      "ACE and neprilysin both break down bradykinin. Blocking both at once raises the risk of angioedema.",
      {
        sources: [
          hf(
            8,
            "The 36-hour gap is there because neprilysin and ACE both break down bradykinin. Together they raise the risk of angioedema.",
          ),
        ],
        tags: ["heart failure"],
      },
    ),
  );
  add(
    "hf",
    card(
      "Which HFrEF add-on needs sinus rhythm and a resting heart rate of 70 or more?",
      "Ivabradine, on top of the highest tolerated beta blocker dose.",
      {
        sources: [
          hf(
            10,
            "Ivabradine: sinus rhythm with resting heart rate of 70 or more on a maximally tolerated beta blocker",
          ),
        ],
        tags: ["heart failure"],
      },
    ),
  );
  add(
    "hf",
    mc(
      "Which statement about loop diuretics in HFrEF is true?",
      [
        ["They relieve congestion but do not improve survival", true],
        ["They are one of the four pillars"],
        ["They lower mortality as much as an MRA"],
        ["They should be avoided when the patient is congested"],
      ],
      "Loop diuretics are for symptoms; the four pillars are for survival.",
      {
        sources: [hf(5, "Diuretics relieve congestion but do not improve survival")],
        tags: ["heart failure"],
        difficulty: 1,
      },
    ),
  );
  add(
    "hf",
    free(
      "Explain why the four pillars are started early at low doses, rather than pushing one drug to its target before adding the next.",
      "Each pillar lowers mortality or hospitalisation through a different pathway, so the benefits add up. Low doses of several drugs are better tolerated (blood pressure, potassium, renal function) than a high dose of one, and each can then be titrated, for example doubling the beta blocker no more often than every 2 weeks.",
      [
        ["Each pillar adds its own benefit through a different pathway", 2],
        ["Low starting doses are better tolerated", 2],
        ["Titrate afterwards, for example the beta blocker every 2 weeks", 1],
      ],
      "Getting all four on board quickly matters more than reaching one target dose early.",
      {
        sources: [
          hf(
            6,
            "Start all four as soon as possible, at low doses, rather than maximising one drug before adding the next.",
          ),
          hf(7, "Beta blocker doses are doubled no more often than every 2 weeks."),
        ],
        tags: ["heart failure"],
        difficulty: 3,
      },
    ),
  );

  // ---- Calculations (the calculations folder) ------------------------------------------------------
  const cg = calcPage(1, "CrCl (mL/min) = [(140 - age) x weight (kg)] / (72 x SCr (mg/dL))");
  const female = calcPage(1, "Multiply by 0.85 for female patients.");
  const ibwM = calcPage(1, "IBW (male) = 50 kg + 2.3 kg for each inch over 5 feet");
  const ibwF = calcPage(1, "IBW (female) = 45.5 kg + 2.3 kg for each inch over 5 feet");
  const adj = calcPage(1, "Adjusted body weight = IBW + 0.4 x (actual weight - IBW)");
  const conv = calcPage(
    1,
    "Course convention for the weight: use ideal body weight (IBW), or actual weight if it is lower.",
  );
  add(
    "calc",
    calc(
      "A 72-year-old woman is 5 ft 6 in tall, weighs 58 kg and has a serum creatinine of 1.3 mg/dL. Estimate her creatinine clearance with Cockcroft-Gault, using the course weight convention.",
      35.8,
      ["mL/min"],
      "IBW = 45.5 + 2.3 x 6 = 59.3 kg. Her actual weight (58 kg) is lower, so use 58 kg.\nCrCl = (140 - 72) x 58 / (72 x 1.3) x 0.85 = 3944 / 93.6 x 0.85 = 35.8 mL/min.",
      {
        tolerance: { mode: "absolute", amount: 1 },
        sources: [cg, female, ibwF, conv],
        tags: ["calculations", "renal"],
        difficulty: 3,
      },
    ),
    { key: "calc-crcl" },
  );
  add(
    "calc",
    {
      type: "calculation",
      prompt:
        "A {age}-year-old man weighs {wt} kg, which is below his ideal body weight, so use his actual weight. His serum creatinine is {scr} mg/dL. Estimate his creatinine clearance with Cockcroft-Gault.",
      answer: {
        kind: "expression",
        expression: "(140 - age) * wt / (72 * scr)",
        variables: {
          age: { kind: "range", min: 40, max: 85, step: 5 },
          wt: { kind: "list", values: [55, 60, 65] },
          scr: { kind: "list", values: [0.8, 1, 1.2, 1.5, 2] },
        },
      },
      units: ["mL/min"],
      tolerance: { mode: "relative", percent: 2 },
      explanation:
        "CrCl = (140 - {age}) x {wt} / (72 x {scr}) = {answer}. No 0.85 factor for a man.",
      sources: [cg, conv],
      tags: ["calculations", "renal"],
      difficulty: 2,
    },
    {
      key: "calc-crcl-var",
      solve: (t) =>
        ((140 - num(t, /A (\d+)-year-old/)) * num(t, /weighs (\d+) kg/)) /
        (72 * num(t, /creatinine is ([\d.]+) mg/)),
    },
  );
  add(
    "calc",
    calc(
      "A man is 6 ft 0 in tall and weighs 110 kg. Which dosing weight do you use for Cockcroft-Gault under the course convention? Give it in kg.",
      90.56,
      ["kg"],
      "IBW = 50 + 2.3 x 12 = 77.6 kg. 110 kg is 142% of IBW (above 120%), so use adjusted weight: 77.6 + 0.4 x (110 - 77.6) = 90.6 kg.",
      {
        tolerance: { mode: "absolute", amount: 0.5 },
        sources: [
          ibwM,
          adj,
          calcPage(1, "If actual weight is more than 120% of IBW, use adjusted body weight."),
        ],
        tags: ["calculations"],
        difficulty: 3,
      },
    ),
  );
  add(
    "calc",
    calc(
      "What is the ideal body weight of a woman who is 5 ft 2 in tall?",
      50.1,
      ["kg"],
      "45.5 + 2.3 x 2 = 50.1 kg.",
      {
        tolerance: { mode: "absolute", amount: 0.2 },
        sources: [ibwF],
        tags: ["calculations"],
        difficulty: 1,
      },
    ),
  );
  add(
    "calc",
    {
      type: "calculation",
      prompt:
        "Enoxaparin 1 mg/kg SC every 12 hours is ordered for a patient who weighs {lb} lb. How many mg is each dose?",
      answer: {
        kind: "expression",
        expression: "lb / 2.2",
        variables: { lb: { kind: "list", values: [132, 154, 176, 198, 220] } },
      },
      units: ["mg"],
      tolerance: { mode: "relative", percent: 1 },
      explanation: "{lb} lb / 2.2 = weight in kg; x 1 mg/kg = {answer}.",
      sources: [
        calcPage(
          2,
          "Example 4. Enoxaparin 1 mg/kg SC every 12 hours for a 176 lb patient: 176 / 2.2 = 80 kg, so 80 mg every 12 hours.",
        ),
      ],
      tags: ["calculations", "weight-based"],
      difficulty: 1,
    },
    { key: "calc-enox", solve: (t) => num(t, /weighs (\d+) lb/) / 2.2 },
  );
  add(
    "calc",
    {
      type: "calculation",
      prompt:
        "Heparin 25,000 units in 250 mL is ordered at 18 units/kg/hr for a {wt} kg patient. At what rate should the pump run?",
      answer: {
        kind: "expression",
        expression: "18 * wt / 100",
        variables: { wt: { kind: "range", min: 60, max: 100, step: 2 } },
      },
      units: ["mL/hr"],
      tolerance: { mode: "relative", percent: 2 },
      explanation:
        "Concentration = 25,000 / 250 = 100 units/mL. Dose = 18 x {wt} units/hr. Rate = dose / 100 = {answer}.",
      sources: [
        calcPage(
          2,
          "Example 5. Heparin 25,000 units in 250 mL (100 units/mL). Order: 18 units/kg/hr for an 80 kg patient. 18 x 80 = 1440 units/hr; 1440 / 100 = 14.4 mL/hr.",
        ),
      ],
      tags: ["calculations", "infusions"],
      difficulty: 2,
    },
    { key: "calc-heparin", solve: (t) => (18 * num(t, /for a (\d+) kg/)) / 100 },
  );
  add(
    "calc",
    calc(
      "Dopamine 400 mg in 250 mL is ordered at 5 mcg/kg/min for an 80 kg patient. What is the rate in mL/hr?",
      15,
      ["mL/hr"],
      "Concentration 1600 mcg/mL. 5 x 80 = 400 mcg/min; x 60 = 24,000 mcg/hr; / 1600 = 15 mL/hr.",
      {
        sources: [calcPage(2, "Example 6. Dopamine 400 mg in 250 mL (1600 mcg/mL).")],
        tags: ["calculations", "infusions"],
        difficulty: 2,
      },
    ),
  );
  add(
    "calc",
    calc(
      "Dobutamine 250 mg in 250 mL is started at 2.5 mcg/kg/min for a 64 kg patient. What is the rate in mL/hr?",
      9.6,
      ["mL/hr"],
      "Concentration 1 mg/mL = 1000 mcg/mL. 2.5 x 64 = 160 mcg/min; x 60 = 9600 mcg/hr; / 1000 = 9.6 mL/hr.",
      {
        sources: [calcPage(2, "Rate (mL/hr) = dose per hour / concentration")],
        tags: ["calculations", "infusions"],
        difficulty: 2,
      },
    ),
  );
  add(
    "calc",
    calc(
      "How many mEq of potassium are in 1.5 g of potassium chloride (MW 74.5)?",
      20.13,
      ["mEq"],
      "1500 mg x 1 / 74.5 = 20.1 mEq.",
      {
        tolerance: { mode: "relative", percent: 2 },
        sources: [
          calcPage(3, "mEq = mg x valence / molecular weight"),
          calcPage(3, "Potassium chloride (KCl, MW 74.5, valence 1)"),
        ],
        tags: ["calculations", "electrolytes"],
      },
    ),
  );
  add(
    "calc",
    calc(
      "An order is for 20 mEq of potassium chloride (MW 74.5). How many mg of KCl is that?",
      1490,
      ["mg"],
      "mg = mEq x MW / valence = 20 x 74.5 / 1 = 1490 mg (1.49 g).",
      {
        sources: [calcPage(3, "mEq = mg x valence / molecular weight")],
        tags: ["calculations", "electrolytes"],
      },
    ),
    { key: "calc-kcl-mg" },
  );
  add(
    "calc",
    calc(
      "How many mEq of sodium are in 500 mL of 0.9% sodium chloride (MW 58.5)?",
      76.9,
      ["mEq"],
      "0.9% = 9 g per litre = 4.5 g in 500 mL. 4500 / 58.5 = 76.9 mEq.",
      {
        tolerance: { mode: "relative", percent: 2 },
        sources: [
          calcPage(
            3,
            "Example 9. Sodium chloride 0.9% contains 9 g per litre (MW 58.5): 9000 / 58.5 = 154 mEq of sodium per litre.",
          ),
        ],
        tags: ["calculations", "electrolytes"],
      },
    ),
  );
  add(
    "calc",
    calc(
      "500 mL is to run over 4 hours through a set that delivers 20 gtt/mL. What is the drip rate?",
      41.67,
      ["gtt/min"],
      "500 x 20 / 240 min = 41.7 gtt/min (about 42).",
      {
        tolerance: { mode: "absolute", amount: 1 },
        sources: [
          calcPage(2, "Drops per minute = volume (mL) x drop factor (gtt/mL) / time (min)"),
        ],
        tags: ["calculations", "infusions"],
        difficulty: 1,
      },
    ),
  );
  add(
    "calc",
    calc(
      "A drug has a volume of distribution of 0.7 L/kg. What IV loading dose gives a concentration of 8 mg/L in a 70 kg patient?",
      392,
      ["mg"],
      "Loading dose = Vd x target = 0.7 x 70 x 8 = 392 mg.",
      {
        sources: [
          calcPage(3, "Loading dose = Vd x target concentration (divide by F for an oral dose)"),
        ],
        tags: ["calculations", "pharmacokinetics"],
        difficulty: 2,
      },
    ),
  );
  add(
    "calc",
    calc(
      "A drug's elimination rate constant is 0.231 per hour. What is its half-life?",
      3,
      ["hr"],
      "t1/2 = 0.693 / 0.231 = 3 hours.",
      {
        tolerance: { mode: "absolute", amount: 0.05 },
        sources: [calcPage(3, "t1/2 = 0.693 / k")],
        tags: ["calculations", "pharmacokinetics"],
        difficulty: 1,
      },
    ),
  );

  // ---- Brand and generic (Pharmacology II practice section) ----------------------------------------
  add(
    "top",
    match(
      "Match each brand name with its generic name.",
      [
        ["Toprol-XL", "metoprolol succinate"],
        ["Coreg", "carvedilol"],
        ["Zestril", "lisinopril"],
        ["Cozaar", "losartan"],
        ["Norvasc", "amlodipine"],
        ["Entresto", "sacubitril/valsartan"],
        ["Farxiga", "dapagliflozin"],
        ["Aldactone", "spironolactone"],
      ],
      "From the top drugs sheet, page 1.",
      {
        distractors: ["metoprolol tartrate", "valsartan"],
        sources: [
          c("top", 1, "metoprolol succinate | Toprol-XL | Beta-1 selective blocker"),
          c("top", 1, "sacubitril/valsartan | Entresto | ARNI"),
        ],
        tags: ["top drugs", "brand names"],
        difficulty: 1,
      },
    ),
  );
  return out;
}
