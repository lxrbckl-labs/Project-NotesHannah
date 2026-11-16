// Study guides for the Pharmacology II lectures: autonomic overview and cholinergic drugs.
import {
  callout,
  checklist,
  cited,
  compare,
  divider,
  drugCard,
  h,
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

export function autonomicGuide({ c, page, hot, q }) {
  const s3 = c("ans", 3, "Overall role | Fight or flight | Rest and digest");
  const s3o = c("ans", 3, "Thoracolumbar (T1 to L2)");
  const s3p = c("ans", 3, "Craniosacral (cranial nerves III, VII, IX, X; S2 to S4)");
  const s4 = c("ans", 4, "Every ganglion uses acetylcholine at nicotinic NN receptors.");
  const s5 = c(
    "ans",
    5,
    "All preganglionic neurons release acetylcholine (ACh) onto nicotinic NN receptors",
  );
  const s5sweat = c(
    "ans",
    5,
    "Exception: sympathetic fibres to sweat glands release ACh onto muscarinic receptors",
  );
  const s5adr = c(
    "ans",
    5,
    "Adrenal medulla: acts like a ganglion and releases epinephrine (about 80%) and NE into the blood",
  );
  const s6 = c(
    "ans",
    6,
    "M2 | Gi-coupled | Heart (SA and AV nodes) | Slower heart rate and AV conduction",
  );
  const s6m3 = c(
    "ans",
    6,
    "M3 | Gq-coupled | Smooth muscle, exocrine glands, vascular endothelium | Contraction, secretion, NO-mediated vasodilation",
  );
  const s7 = c("ans", 7, "beta-2 | Gs | Bronchial and vascular smooth muscle, liver, uterus");
  const s7a1 = c(
    "ans",
    7,
    "alpha-1 | Gq | Vascular smooth muscle, iris dilator muscle, bladder sphincter | Vasoconstriction, mydriasis, urinary retention",
  );
  const s7hook = c(
    "ans",
    7,
    "Memory hook: Gq contracts (alpha-1, M3), Gs relaxes or stimulates via cAMP (all beta), Gi inhibits (alpha-2, M2).",
  );
  const s8 = c("ans", 8, "Pupil | Dilate: mydriasis (alpha-1) | Constrict: miosis (M3)");
  const s8n = c(
    "ans",
    8,
    "Most organs get both divisions and the parasympathetic tone usually dominates at rest. Blood vessels are mainly sympathetic.",
  );
  const s9 = c(
    "ans",
    9,
    "Acetylcholinesterase splits ACh into choline and acetate in the synaptic cleft",
  );
  const s9bot = c("ans", 9, "Calcium entry triggers release; botulinum toxin prevents it");
  const s10 = c(
    "ans",
    10,
    "Action ends mainly by reuptake through NET (uptake 1), blocked by cocaine and tricyclic antidepressants",
  );
  const s10th = c(
    "ans",
    10,
    "Tyrosine to DOPA by tyrosine hydroxylase, the rate-limiting step (blocked by metyrosine)",
  );
  const s11 = c(
    "ans",
    11,
    "Direct-acting drugs bind the receptor; indirect-acting drugs change the amount of transmitter",
  );
  const s12 = c("ans", 12, "Receptor subtype predicts the response: learn the receptor tables");
  const pts = hot("ans");
  const diagram = page("ans", 4);

  return [
    h(2, "The big picture"),
    p(
      [
        { text: "Two divisions that usually pull in opposite directions: the " },
        { text: "sympathetic", bold: true },
        { text: " division gets the body ready for fight or flight, the " },
        { text: "parasympathetic", bold: true },
        { text: " division for rest and digest." },
        { cite: 1 },
      ],
      [s3],
    ),
    compare(
      "Sympathetic vs parasympathetic",
      ["Leaves the CNS from", "Ganglia sit", "Preganglionic fibre", "Postganglionic fibre"],
      [
        [
          "Sympathetic",
          cited("Thoracolumbar, T1 to L2", [s3o]),
          "Close to the spinal cord (chain)",
          "Short",
          "Long",
        ],
        [
          "Parasympathetic",
          cited("Craniosacral: CN III, VII, IX, X and S2 to S4", [s3p]),
          "Close to or in the organ",
          "Long",
          "Short",
        ],
      ],
      [s3],
    ),
    callout(
      "info",
      "Why this lecture matters",
      "Almost every drug in the autonomic block copies or blocks one transmitter at one receptor subtype. Learn the receptor tables and you can predict most effects and side effects.",
      [s12],
    ),
    h(2, "Who releases what"),
    labelledImage(
      diagram,
      "Five autonomic and somatic pathways from the CNS to their targets, with the transmitter on each fibre",
      [
        {
          ...pts.ganglion0,
          label: "Ganglion: NN",
          detail: "Every autonomic ganglion: ACh acting on nicotinic NN receptors.",
        },
        {
          ...pts.target0,
          label: "Parasympathetic target",
          detail: "ACh at muscarinic receptors (M2 heart, M3 smooth muscle and glands).",
        },
        {
          ...pts.target1,
          label: "Sympathetic target",
          detail: "NE at alpha and beta receptors.",
        },
        {
          ...pts.target2,
          label: "Sweat glands",
          detail: "Sympathetic fibres, but ACh at muscarinic M3 receptors.",
        },
        {
          ...pts.adrenal,
          label: "Adrenal medulla",
          detail: "Behaves like a ganglion; releases mostly epinephrine into the blood.",
        },
        {
          ...pts.target4,
          label: "Neuromuscular junction",
          detail: "Somatic: ACh at NM receptors, no ganglion.",
        },
      ],
      [s4],
    ),
    ul(
      [
        { text: "Every preganglionic neuron releases ACh onto nicotinic NN receptors." },
        "Parasympathetic postganglionic: ACh onto muscarinic receptors.",
        "Most sympathetic postganglionic: NE onto adrenergic receptors.",
        { text: "Exception: sweat glands get ACh at muscarinic receptors.", indent: 1 },
        "Somatic motor neurons: ACh at NM receptors on skeletal muscle, with no ganglion.",
      ],
      [s5, s5sweat],
    ),
    callout(
      "exam_tip",
      "Sweat glands",
      "The classic trick question: the fibres are sympathetic, but the transmitter is ACh at muscarinic receptors. That is why antimuscarinic drugs stop sweating and can cause overheating.",
      [s5sweat],
    ),
    p(
      "The adrenal medulla works like a sympathetic ganglion that releases straight into the blood: about 80% epinephrine, the rest NE. A sympathetic surge therefore raises circulating epinephrine.",
      [s5adr],
      {
        flags: [
          { kind: "uncertain", quote: "about 80%", note: "Approximate share quoted on the slide." },
        ],
      },
    ),
    divider(),
    h(2, "Receptors"),
    h(3, "Cholinergic"),
    table(
      [
        ["Receptor", "Coupling", "Where", "What it does"],
        ["NN", "Ion channel", "Ganglia, adrenal medulla", "Fires the postganglionic neuron"],
        ["NM", "Ion channel", "Neuromuscular junction", "Skeletal muscle contraction"],
        ["M1", "Gq", "CNS, enteric neurons, gastric glands", "Excitation, acid secretion"],
        ["M2", "Gi", "SA and AV nodes", "Slows heart rate and AV conduction"],
        ["M3", "Gq", "Smooth muscle, glands, endothelium", "Contraction, secretion, NO release"],
      ],
      [s6, s6m3],
    ),
    h(3, "Adrenergic"),
    table(
      [
        ["Receptor", "Coupling", "Where", "What it does"],
        [
          "alpha-1",
          "Gq",
          "Vessels, iris dilator, bladder sphincter",
          "Vasoconstriction, mydriasis",
        ],
        ["alpha-2", "Gi", "Presynaptic terminals, CNS", "Less NE release"],
        ["beta-1", "Gs", "Heart, juxtaglomerular cells", "Faster, stronger heart; renin"],
        ["beta-2", "Gs", "Bronchi, vessels, liver, uterus", "Bronchodilation, vasodilation"],
        ["beta-3", "Gs", "Fat, bladder detrusor", "Lipolysis, detrusor relaxation"],
      ],
      [s7, s7a1],
    ),
    mnemonic(
      "QISS QIQ",
      "G proteins of the alpha, beta and muscarinic receptors",
      [
        ["Q", "alpha-1: Gq"],
        ["I", "alpha-2: Gi"],
        ["S", "beta-1: Gs"],
        ["S", "beta-2: Gs"],
        ["Q", "M1: Gq"],
        ["I", "M2: Gi"],
        ["Q", "M3: Gq"],
      ],
      "The slide's version: Gq contracts, Gs relaxes or stimulates through cAMP, Gi inhibits.",
      { citations: [s7hook] },
    ),
    h(3, "Organ responses"),
    compare(
      "What each division does",
      ["Sympathetic", "Parasympathetic"],
      [
        ["Heart rate", "Up (beta-1)", "Down (M2)"],
        ["Bronchi", "Dilate (beta-2)", "Constrict, secrete (M3)"],
        ["Pupil", "Mydriasis (alpha-1)", "Miosis (M3)"],
        ["GI motility", "Down", "Up"],
        [
          "Bladder",
          "Detrusor relaxes (beta-3), sphincter contracts (alpha-1)",
          "Detrusor contracts (M3)",
        ],
        ["Sweat glands", "Secretion (muscarinic)", "None"],
      ],
      [s8],
    ),
    callout(
      "tip",
      "Predicting drug effects",
      "Block a receptor and you get the opposite of its row. Block M3 and the pupil dilates, the bladder retains, the mouth dries. Stimulate alpha-1 and the pupil dilates too, by a different muscle.",
      [s8, s7a1],
    ),
    p(
      "Most organs get both divisions and parasympathetic tone usually wins at rest. Blood vessels are the exception: they are controlled mainly by the sympathetic side.",
      [s8n],
    ),
    divider(),
    h(2, "Making and ending the transmitters"),
    h(3, "Acetylcholine"),
    ol(
      [
        "Choline is taken up by a sodium-dependent transporter (hemicholinium blocks it).",
        "Choline acetyltransferase makes ACh from choline and acetyl-CoA.",
        "VAChT loads vesicles (vesamicol blocks it).",
        "Calcium entry releases ACh; botulinum toxin stops release.",
        "Acetylcholinesterase splits ACh into choline and acetate.",
      ],
      [s9, s9bot],
    ),
    h(3, "Norepinephrine"),
    ol(
      [
        "Tyrosine to DOPA: tyrosine hydroxylase, the rate-limiting step (metyrosine blocks it).",
        "DOPA to dopamine; VMAT loads dopamine into vesicles (reserpine blocks it).",
        "Dopamine beta-hydroxylase makes NE inside the vesicle.",
        "Calcium-triggered release; alpha-2 autoreceptors turn it down.",
        "Mostly taken back up by NET; the rest broken down by MAO and COMT.",
      ],
      [s10th, s10],
    ),
    compare(
      "ACh and NE side by side",
      ["Signal ends by", "Blocked by"],
      [
        [
          "Acetylcholine",
          cited("Breakdown by acetylcholinesterase", [s9]),
          "Cholinesterase inhibitors (neostigmine, organophosphates)",
        ],
        [
          "Norepinephrine",
          cited("Reuptake through NET", [s10]),
          "Cocaine, tricyclic antidepressants",
        ],
      ],
      [s9, s10],
    ),
    callout(
      "important",
      "Opposite ways to change a synapse",
      "Botulinum toxin stops ACh from being released at all, while cocaine and tricyclics leave more NE in the cleft. Both are indirect effects: neither drug touches the receptor.",
      [s9bot, s10, s11],
    ),
    mindMap(
      node("Autonomic drugs", [
        node(
          "Cholinergic side",
          [
            node("Muscarinic agonists", [node("bethanechol"), node("pilocarpine")]),
            node("Cholinesterase inhibitors", [node("neostigmine"), node("donepezil")]),
            node("Antimuscarinics", [node("atropine"), node("oxybutynin"), node("tiotropium")]),
          ],
          "teal",
        ),
        node(
          "Adrenergic side",
          [
            node("Agonists", [node("epinephrine"), node("albuterol"), node("clonidine")]),
            node("Beta blockers", [node("metoprolol"), node("propranolol"), node("carvedilol")]),
          ],
          "orange",
        ),
      ]),
      [],
      { generalKnowledge: true },
    ),
    h(2, "Words to know"),
    ul(
      [
        [{ text: "Sympathomimetic", bold: true }, { text: ": acts like sympathetic stimulation." }],
        [{ text: "Sympatholytic", bold: true }, { text: ": blocks sympathetic effects." }],
        [
          { text: "Cholinomimetic", bold: true },
          { text: " (parasympathomimetic): acts like ACh at muscarinic receptors." },
        ],
        [{ text: "Antimuscarinic", bold: true }, { text: " (parasympatholytic): blocks them." }],
        [
          { text: "Direct vs indirect", bold: true },
          { text: ": binds the receptor, or changes how much transmitter there is." },
        ],
      ].map((text) => ({ text, indent: 0 })),
      [s11],
    ),
    quote(
      "Receptor subtype predicts the response: learn the receptor tables",
      "Lecture 7, summary slide",
      [s12],
    ),
    checklist([
      { text: "Draw the five pathways from memory", checked: true },
      "Fill in a blank receptor table (location and response)",
      "Explain the sweat gland exception out loud",
      "Do the lecture 7 practice questions",
    ]),
    question(q("ans-sweat")),
  ];
}

export function cholinergicGuide({ c, concept, q }) {
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
  const s3n = c(
    "chol",
    3,
    "Bethanechol must never be used when the bladder or bowel is mechanically obstructed.",
  );
  const s4 = c("chol", 4, "Emesis, lacrimation, salivation, sweating");
  const s4b = c("chol", 4, "Bronchospasm and bronchorrhoea, bradycardia");
  const s4ci = c(
    "chol",
    4,
    "Avoid muscarinic agonists in asthma, peptic ulcer, bradycardia and urinary or GI obstruction",
  );
  const s5neo = c(
    "chol",
    5,
    "Neostigmine | Reversible; quaternary, no CNS entry | Reversal of nondepolarising blockade; myasthenia gravis",
  );
  const s5phy = c(
    "chol",
    5,
    "Physostigmine | Reversible; tertiary, enters the CNS | Severe anticholinergic toxicity",
  );
  const s5don = c(
    "chol",
    5,
    "Donepezil, rivastigmine, galantamine | Reversible; act in the CNS | Alzheimer disease",
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
  const s6nic = c("chol", 6, "Nicotinic signs: fasciculations, then weakness and paralysis");
  const s6n = c("chol", 6, "Pupil size is a poor end point for atropine.");
  const s7atr = c(
    "chol",
    7,
    "Atropine | Non-selective, tertiary | Symptomatic bradycardia; organophosphate poisoning",
  );
  const s7tio = c("chol", 7, "Tiotropium | Inhaled, long acting | COPD maintenance");
  const s7ipr = c(
    "chol",
    7,
    "Ipratropium | Inhaled, quaternary, short acting | COPD; added to albuterol in acute asthma",
  );
  const s7oxy = c(
    "chol",
    7,
    "Oxybutynin, tolterodine | Bladder antimuscarinics | Overactive bladder",
  );
  const s7scop = c(
    "chol",
    7,
    "Scopolamine | Marked CNS effect | Motion sickness (transdermal patch)",
  );
  const s8 = c("chol", 8, "Confusion and delirium, especially in older adults");
  const s8tox = c(
    "chol",
    8,
    "Toxicity: hot, dry, flushed skin, dilated pupils, delirium, urinary retention",
  );
  const s8glau = c("chol", 8, "Blurred vision; can precipitate acute angle-closure glaucoma");
  const s8beers = c(
    "chol",
    8,
    "Strongly anticholinergic drugs are on the Beers list of drugs to avoid in older adults.",
  );
  const s9sux = c(
    "chol",
    9,
    "Succinylcholine | Depolarising | Hyperkalaemia; trigger for malignant hyperthermia",
  );
  const s9roc = c("chol", 9, "Rocuronium | Nondepolarising | Reversed by sugammadex");
  const s9cis = c(
    "chol",
    9,
    "Cisatracurium | Nondepolarising | Hofmann elimination: useful in renal or hepatic failure",
  );
  const s9n = c(
    "chol",
    9,
    "Neostigmine reverses nondepolarising block and is given with glycopyrrolate to block its muscarinic effects.",
  );
  const s10beth = c("chol", 10, "Bethanechol | 10 to 50 mg PO three or four times daily");
  const s10atr = c("chol", 10, "1 mg IV every 3 to 5 minutes, maximum 3 mg");
  const s10oxy = c("chol", 10, "Oxybutynin IR | 5 mg PO two or three times daily");
  const s10tio = c("chol", 10, "18 mcg inhaled once daily");
  const s11 = c(
    "chol",
    11,
    "Donepezil plus oxybutynin: opposing effects, and a classic prescribing cascade",
  );
  const s11q = c(
    "chol",
    11,
    "Quaternary amines (neostigmine, glycopyrrolate, ipratropium) do not cross the blood-brain barrier",
  );
  const s11scop = c(
    "chol",
    11,
    "Scopolamine patch: apply behind the ear at least 4 hours before travel",
  );

  return [
    h(2, "Three groups to keep apart"),
    ul(
      [
        [
          { text: "Direct muscarinic agonists", bold: true },
          { text: " act like ACh at muscarinic receptors." },
        ],
        [
          { text: "Cholinesterase inhibitors", bold: true },
          { text: " stop ACh being broken down, so ACh rises at muscarinic and nicotinic sites." },
        ],
        [
          { text: "Muscarinic antagonists", bold: true },
          { text: " block ACh at muscarinic receptors." },
        ],
      ].map((text) => ({ text, indent: 0 })),
      [s3beth, s5neo, s7atr],
    ),
    h(2, "Direct-acting agonists"),
    table(
      [
        ["Drug", "Why it is different", "Use"],
        [
          "Bethanechol",
          "Not broken down by acetylcholinesterase",
          "Non-obstructive urinary retention",
        ],
        ["Pilocarpine", "Tertiary amine, also an eye drop", "Dry mouth (Sjogren), glaucoma"],
        ["Cevimeline", "M3 agonist", "Dry mouth (Sjogren)"],
        ["Methacholine", "Inhaled", "Bronchial challenge test"],
      ],
      [s3beth, s3pilo, s3meth],
    ),
    callout(
      "warning",
      "Never with an obstruction",
      "Bethanechol squeezes the bladder and bowel. If the outflow is mechanically blocked, it pushes against the blockage instead of relieving it.",
      [s3n],
    ),
    h(3, "Muscarinic excess"),
    mnemonic(
      "DUMBBELSS",
      "Muscarinic excess",
      [
        ["D", "Diarrhoea"],
        ["U", "Urination"],
        ["M", "Miosis"],
        ["B", "Bronchospasm and bronchorrhoea"],
        ["B", "Bradycardia"],
        ["E", "Emesis"],
        ["L", "Lacrimation"],
        ["S", "Salivation"],
        ["S", "Sweating"],
      ],
      "SLUDGE (salivation, lacrimation, urination, defecation, GI upset, emesis) covers the same ground; the slide notes mention both.",
      { citations: [s4, s4b] },
    ),
    callout(
      "important",
      "Avoid muscarinic agonists in",
      "Asthma, peptic ulcer, bradycardia, and urinary or GI obstruction.",
      [s4ci],
    ),
    divider(),
    h(2, "Cholinesterase inhibitors"),
    compare(
      "Reversible inhibitors",
      ["Gets into the CNS?", "Main use"],
      [
        ["Neostigmine", "No (quaternary)", "Reverses nondepolarising block; myasthenia gravis"],
        ["Pyridostigmine", "No (quaternary)", "Myasthenia gravis, oral maintenance"],
        ["Physostigmine", cited("Yes (tertiary)", [s5phy]), "Severe anticholinergic toxicity"],
        ["Donepezil", "Yes", cited("Alzheimer disease", [s5don])],
      ],
      [s5neo, s5phy],
    ),
    callout(
      "definition",
      "Quaternary vs tertiary",
      "A quaternary amine carries a permanent charge, so it stays out of the brain (neostigmine, glycopyrrolate, ipratropium). A tertiary amine can cross membranes (physostigmine, atropine).",
      [s11q, s5phy],
    ),
    h(3, "Organophosphate poisoning"),
    p(
      "Organophosphates bind acetylcholinesterase irreversibly. The patient shows muscarinic excess plus nicotinic signs: fasciculations, then weakness and paralysis.",
      [s5op, s6nic],
    ),
    ol(
      [
        [
          { text: "Atropine", bold: true },
          { text: " first, repeated until bronchial secretions are dry." },
        ],
        [
          { text: "Pralidoxime", bold: true },
          { text: " to regenerate the enzyme, before it ages." },
        ],
        "Benzodiazepines for seizures.",
      ].map((text) => ({ text, indent: 0 })),
      [s6atr, s6pam],
    ),
    callout(
      "exam_tip",
      "End point for atropine",
      "Dry bronchial secretions and adequate oxygenation, not pupil size.",
      [s6n],
    ),
    divider(),
    h(2, "Muscarinic antagonists"),
    table(
      [
        ["Drug", "Feature", "Use"],
        ["Atropine", "Non-selective, tertiary", "Symptomatic bradycardia; organophosphates"],
        ["Scopolamine", "Strong CNS effect", "Motion sickness (patch)"],
        ["Ipratropium", "Inhaled, short acting", "COPD; acute asthma with albuterol"],
        ["Tiotropium", "Inhaled, long acting", "COPD maintenance"],
        ["Oxybutynin, tolterodine", "Bladder", "Overactive bladder"],
        ["Glycopyrrolate", "Quaternary", "Dries secretions around surgery"],
      ],
      [s7atr, s7scop, s7ipr, s7tio, s7oxy],
    ),
    drugCard(
      {
        name: "atropine",
        concept: concept("drug", "atropine"),
        drugClass: "Muscarinic antagonist (non-selective)",
        mechanism: "Competitive block of ACh at muscarinic receptors",
        indications: [
          cited("Symptomatic bradycardia", [s7atr]),
          cited("Organophosphate poisoning", [s6atr]),
        ],
        adverseEffects: [
          "Dry mouth",
          "Tachycardia",
          "Urinary retention",
          "Delirium in older adults",
        ],
        contraindications: [cited("Angle-closure glaucoma", [s8glau])],
        dosingNotes: [
          cited(
            "Bradycardia: 1 mg IV every 3 to 5 minutes, maximum 3 mg",
            [s10atr],
            [
              {
                kind: "dose",
                quote: "1 mg IV every 3 to 5 minutes, maximum 3 mg",
                note: "Check against the current resuscitation guideline.",
              },
            ],
          ),
          cited("Organophosphates: repeat until secretions are dry", [s6atr]),
        ],
      },
      [s7atr],
      { style: { color: "teal" } },
    ),
    h(3, "Anticholinergic adverse effects"),
    ul(
      [
        "Dry mouth, constipation, urinary retention",
        "Blurred vision; can trigger angle-closure glaucoma",
        "Fast heart rate; less sweating, so overheating",
        "Confusion and delirium, worst in older adults",
      ],
      [s8, s8glau],
    ),
    mnemonic(
      "Hot, dry, red, blind, mad, full",
      "Anticholinergic toxicity",
      [
        ["Hot", "Hyperthermia: no sweating"],
        ["Dry", "Dry skin and mouth"],
        ["Red", "Flushed skin"],
        ["Blind", "Dilated pupils, blurred vision"],
        ["Mad", "Delirium"],
        ["Full", "Urinary retention"],
      ],
      undefined,
      { citations: [s8tox] },
    ),
    callout(
      "warning",
      "Older adults",
      "Strongly anticholinergic drugs are on the Beers list. Add up the burden: several mildly anticholinergic drugs together can cause delirium.",
      [s8beers],
    ),
    callout(
      "tip",
      "Prescribing cascade",
      "Donepezil raises ACh in the brain; oxybutynin blocks it. Starting oxybutynin for incontinence caused by donepezil works against both drugs.",
      [s11],
    ),
    h(2, "Neuromuscular blockers"),
    compare(
      undefined,
      ["Type", "Know this"],
      [
        [
          "Succinylcholine",
          "Depolarising",
          cited("Hyperkalaemia; malignant hyperthermia", [s9sux]),
        ],
        ["Rocuronium", "Nondepolarising", cited("Reversed by sugammadex", [s9roc])],
        ["Cisatracurium", "Nondepolarising", cited("Hofmann elimination", [s9cis])],
      ],
      [s9sux, s9roc, s9cis],
    ),
    p(
      "Neostigmine reverses a nondepolarising block, and glycopyrrolate is given with it to block the muscarinic effects of the extra ACh.",
      [s9n],
    ),
    h(2, "Doses to know"),
    table(
      [
        ["Drug", "Usual adult dose"],
        ["Bethanechol", "10 to 50 mg PO three or four times daily"],
        ["Oxybutynin IR", "5 mg PO two or three times daily"],
        ["Atropine (bradycardia)", "1 mg IV every 3 to 5 minutes, max 3 mg"],
        ["Tiotropium capsule", "18 mcg inhaled once daily"],
      ],
      [s10beth, s10oxy, s10atr, s10tio],
      {
        flags: [
          {
            kind: "dose",
            quote: "1 mg IV every 3 to 5 minutes, max 3 mg",
            note: "Dose changed in recent guidelines; check.",
          },
          {
            kind: "dose",
            quote: "18 mcg inhaled once daily",
            note: "Strength depends on the device.",
          },
        ],
      },
    ),
    callout("info", "Scopolamine patch", "Behind the ear at least 4 hours before travel.", [
      s11scop,
    ]),
    question(q("chol-op-case")),
    checklist([
      "Sort 12 drugs into agonist, cholinesterase inhibitor, antagonist",
      { text: "Learn DUMBBELSS and the anticholinergic rhyme", checked: true },
      "Explain why neostigmine is given with glycopyrrolate",
    ]),
  ];
}
