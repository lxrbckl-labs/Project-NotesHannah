"""The six lecture decks of the pharmacy demo set: original sample material, written for this app.

Each slide is a dict:
  title    the slide title
  lines    plain lines under the title (title slides only, no bullet)
  bullets  strings, or (text, 1) for a sub-bullet
  table    rows of cells, the first row a header
  image    the name of a picture drawn by make_demo.py
  notes    speaker notes
  flags    transcript flags: [kind, exact quote from the slide or notes, note]
The transcript of a slide is built from exactly these fields (see make_demo.transcript), so every quote
in the seeder can be checked against what is on the slide.
"""

FOOTER = "Sample study material. Not for clinical use."

ANS = dict(
    key="ans",
    file="PHAR7340-L07-autonomic-nervous-system.pptx",
    name="PHAR 7340 L07 Autonomic nervous system overview.pptx",
    slides=[
        dict(
            title="Autonomic Nervous System Overview",
            lines=["Pharmacology II (PHAR 7340)", "Lecture 7", "Autonomic pharmacology block"],
            notes="This block runs for four lectures: this overview, cholinergic drugs, adrenergic agonists and beta blockers. Everything later builds on the receptor tables in this deck.",
        ),
        dict(
            title="Learning objectives",
            bullets=[
                "Compare the sympathetic and parasympathetic divisions",
                "Name the neurotransmitter and receptor at each synapse",
                "Predict organ responses to autonomic stimulation",
                "Describe how acetylcholine and norepinephrine are made, released and removed",
            ],
        ),
        dict(
            title="Two divisions",
            table=[
                ["Feature", "Sympathetic", "Parasympathetic"],
                ["Origin in the CNS", "Thoracolumbar (T1 to L2)", "Craniosacral (cranial nerves III, VII, IX, X; S2 to S4)"],
                ["Location of ganglia", "Close to the spinal cord (paravertebral chain)", "Close to or within the target organ"],
                ["Preganglionic fibre", "Short", "Long"],
                ["Postganglionic fibre", "Long", "Short"],
                ["Overall role", "Fight or flight", "Rest and digest"],
            ],
            notes="The vagus nerve (cranial nerve X) carries most parasympathetic outflow to the heart, lungs and gut.",
        ),
        dict(
            title="Autonomic pathways at a glance",
            image="pathways",
            notes="Read each row left to right: CNS, preganglionic fibre, ganglion, postganglionic fibre, target. Every ganglion uses acetylcholine at nicotinic NN receptors.",
        ),
        dict(
            title="Neurotransmitters at each synapse",
            bullets=[
                "All preganglionic neurons release acetylcholine (ACh) onto nicotinic NN receptors",
                "Parasympathetic postganglionic neurons release ACh onto muscarinic receptors",
                "Most sympathetic postganglionic neurons release norepinephrine (NE) onto adrenergic receptors",
                ("Exception: sympathetic fibres to sweat glands release ACh onto muscarinic receptors", 1),
                "Adrenal medulla: acts like a ganglion and releases epinephrine (about 80%) and NE into the blood",
                "Somatic motor neurons release ACh onto NM receptors of skeletal muscle, with no ganglion",
            ],
            notes="The adrenal medulla is the reason a sympathetic surge raises circulating epinephrine.",
        ),
        dict(
            title="Cholinergic receptors",
            table=[
                ["Receptor", "Type", "Main location", "Response"],
                ["NN (nicotinic, neuronal)", "Ligand-gated ion channel", "Autonomic ganglia, adrenal medulla", "Depolarises the postganglionic neuron; catecholamine release"],
                ["NM (nicotinic, muscle)", "Ligand-gated ion channel", "Neuromuscular junction", "Skeletal muscle contraction"],
                ["M1", "Gq-coupled", "CNS, enteric neurons, gastric glands", "Neuronal excitation; gastric acid secretion"],
                ["M2", "Gi-coupled", "Heart (SA and AV nodes)", "Slower heart rate and AV conduction"],
                ["M3", "Gq-coupled", "Smooth muscle, exocrine glands, vascular endothelium", "Contraction, secretion, NO-mediated vasodilation"],
            ],
        ),
        dict(
            title="Adrenergic receptors",
            table=[
                ["Receptor", "G protein", "Main location", "Response"],
                ["alpha-1", "Gq", "Vascular smooth muscle, iris dilator muscle, bladder sphincter", "Vasoconstriction, mydriasis, urinary retention"],
                ["alpha-2", "Gi", "Presynaptic nerve terminals, CNS", "Less NE release; lower sympathetic outflow"],
                ["beta-1", "Gs", "Heart, juxtaglomerular cells of the kidney", "Higher heart rate and contractility; renin release"],
                ["beta-2", "Gs", "Bronchial and vascular smooth muscle, liver, uterus", "Bronchodilation, vasodilation, glycogenolysis, uterine relaxation"],
                ["beta-3", "Gs", "Adipose tissue, bladder detrusor", "Lipolysis; detrusor relaxation"],
            ],
            notes="Memory hook: Gq contracts (alpha-1, M3), Gs relaxes or stimulates via cAMP (all beta), Gi inhibits (alpha-2, M2).",
        ),
        dict(
            title="Organ responses",
            table=[
                ["Organ", "Sympathetic", "Parasympathetic"],
                ["Heart rate", "Increase (beta-1)", "Decrease (M2)"],
                ["Bronchi", "Dilate (beta-2)", "Constrict, more secretions (M3)"],
                ["Pupil", "Dilate: mydriasis (alpha-1)", "Constrict: miosis (M3)"],
                ["GI motility", "Decrease", "Increase"],
                ["Bladder", "Relax detrusor (beta-3), contract sphincter (alpha-1)", "Contract detrusor (M3), relax sphincter"],
                ["Sweat glands", "Secretion (muscarinic, sympathetic cholinergic)", "No innervation"],
            ],
            notes="Most organs get both divisions and the parasympathetic tone usually dominates at rest. Blood vessels are mainly sympathetic.",
        ),
        dict(
            title="Acetylcholine: synthesis to breakdown",
            bullets=[
                "Choline enters the nerve terminal on a sodium-dependent transporter (blocked by hemicholinium)",
                "Choline acetyltransferase joins choline and acetyl-CoA to make ACh",
                "VAChT packs ACh into vesicles (blocked by vesamicol)",
                "Calcium entry triggers release; botulinum toxin prevents it",
                "Acetylcholinesterase splits ACh into choline and acetate in the synaptic cleft",
            ],
        ),
        dict(
            title="Norepinephrine: synthesis to removal",
            bullets=[
                "Tyrosine to DOPA by tyrosine hydroxylase, the rate-limiting step (blocked by metyrosine)",
                "DOPA to dopamine; VMAT moves dopamine into vesicles (blocked by reserpine)",
                "Dopamine beta-hydroxylase makes NE inside the vesicle",
                "Calcium-triggered release; presynaptic alpha-2 receptors reduce further release",
                "Action ends mainly by reuptake through NET (uptake 1), blocked by cocaine and tricyclic antidepressants",
                "Broken down by MAO (in the nerve terminal) and COMT",
            ],
            notes="Unlike ACh, NE is mostly recycled, not destroyed in the cleft. That is why reuptake blockers raise synaptic NE.",
        ),
        dict(
            title="Key terms",
            bullets=[
                "Sympathomimetic: mimics sympathetic stimulation (adrenergic agonist)",
                "Sympatholytic: blocks sympathetic effects (adrenergic antagonist)",
                "Parasympathomimetic or cholinomimetic: mimics ACh at muscarinic receptors",
                "Parasympatholytic or antimuscarinic: blocks ACh at muscarinic receptors",
                "Direct-acting drugs bind the receptor; indirect-acting drugs change the amount of transmitter",
            ],
        ),
        dict(
            title="Summary",
            bullets=[
                "ACh at every ganglion (NN); NE at most sympathetic targets; ACh at parasympathetic targets",
                "Receptor subtype predicts the response: learn the receptor tables",
                "ACh is destroyed by acetylcholinesterase; NE is mostly taken back up",
            ],
            footer=True,
        ),
    ],
)

CHOLINERGIC = dict(
    key="chol",
    file="PHAR7340-L08-cholinergic-drugs.pptx",
    name="PHAR 7340 L08 Cholinergic agonists and antagonists.pptx",
    slides=[
        dict(
            title="Cholinergic Agonists and Antagonists",
            lines=["Pharmacology II (PHAR 7340)", "Lecture 8", "Autonomic pharmacology block"],
        ),
        dict(
            title="Learning objectives",
            bullets=[
                "Classify direct agonists, cholinesterase inhibitors and muscarinic antagonists",
                "Predict muscarinic and nicotinic effects and toxicity",
                "Manage organophosphate and anticholinergic poisoning",
                "Match each drug to its main clinical use",
            ],
        ),
        dict(
            title="Direct-acting muscarinic agonists",
            table=[
                ["Drug", "Feature", "Main use"],
                ["Bethanechol", "Muscarinic selective; not broken down by acetylcholinesterase", "Non-obstructive urinary retention"],
                ["Pilocarpine", "Tertiary amine; also an eye drop", "Dry mouth in Sjogren syndrome; glaucoma"],
                ["Cevimeline", "M3 agonist", "Dry mouth in Sjogren syndrome"],
                ["Methacholine", "Inhaled", "Bronchial challenge test for asthma"],
            ],
            notes="Bethanechol must never be used when the bladder or bowel is mechanically obstructed.",
        ),
        dict(
            title="Muscarinic excess",
            bullets=[
                "Diarrhea, urination, miosis",
                "Bronchospasm and bronchorrhea, bradycardia",
                "Emesis, lacrimation, salivation, sweating",
                "Avoid muscarinic agonists in asthma, peptic ulcer, bradycardia and urinary or GI obstruction",
            ],
            notes="Students often remember these with DUMBBELSS or SLUDGE. Both are on the exam review sheet.",
        ),
        dict(
            title="Cholinesterase inhibitors",
            table=[
                ["Drug", "Type", "Use"],
                ["Neostigmine", "Reversible; quaternary, no CNS entry", "Reversal of nondepolarising blockade; myasthenia gravis"],
                ["Pyridostigmine", "Reversible; quaternary", "Myasthenia gravis (oral maintenance)"],
                ["Physostigmine", "Reversible; tertiary, enters the CNS", "Severe anticholinergic toxicity"],
                ["Donepezil, rivastigmine, galantamine", "Reversible; act in the CNS", "Alzheimer disease"],
                ["Organophosphates (malathion, sarin)", "Irreversible", "Insecticides and nerve agents: poisoning"],
            ],
        ),
        dict(
            title="Organophosphate poisoning",
            bullets=[
                "Muscarinic signs: secretions, bronchospasm, bradycardia, miosis",
                "Nicotinic signs: fasciculations, then weakness and paralysis",
                "Atropine: repeat and titrate until bronchial secretions are dry",
                "Pralidoxime regenerates acetylcholinesterase if given before the enzyme ages",
                "Benzodiazepines for seizures",
            ],
            notes="Pupil size is a poor end point for atropine. Use drying of bronchial secretions and adequate oxygenation.",
        ),
        dict(
            title="Muscarinic antagonists",
            table=[
                ["Drug", "Feature", "Main use"],
                ["Atropine", "Non-selective, tertiary", "Symptomatic bradycardia; organophosphate poisoning"],
                ["Scopolamine", "Marked CNS effect", "Motion sickness (transdermal patch)"],
                ["Ipratropium", "Inhaled, quaternary, short acting", "COPD; added to albuterol in acute asthma"],
                ["Tiotropium", "Inhaled, long acting", "COPD maintenance"],
                ["Oxybutynin, tolterodine", "Bladder antimuscarinics", "Overactive bladder"],
                ["Glycopyrrolate", "Quaternary, no CNS entry", "Reduces secretions around surgery"],
                ["Benztropine", "Central action", "Drug-induced parkinsonism"],
            ],
        ),
        dict(
            title="Anticholinergic adverse effects",
            bullets=[
                "Dry mouth, constipation, urinary retention",
                "Blurred vision; can precipitate acute angle-closure glaucoma",
                "Tachycardia; reduced sweating with hyperthermia",
                "Confusion and delirium, especially in older adults",
                "Toxicity: hot, dry, flushed skin, dilated pupils, delirium, urinary retention",
            ],
            notes="Strongly anticholinergic drugs are on the Beers list of drugs to avoid in older adults. Watch for cumulative burden from several drugs.",
        ),
        dict(
            title="Neuromuscular blockers (NM antagonists)",
            table=[
                ["Drug", "Type", "Point to know"],
                ["Succinylcholine", "Depolarising", "Hyperkalaemia; trigger for malignant hyperthermia"],
                ["Rocuronium", "Nondepolarising", "Reversed by sugammadex"],
                ["Vecuronium", "Nondepolarising", "Reversed by sugammadex"],
                ["Cisatracurium", "Nondepolarising", "Hofmann elimination: useful in renal or hepatic failure"],
            ],
            notes="Neostigmine reverses nondepolarising block and is given with glycopyrrolate to block its muscarinic effects.",
        ),
        dict(
            title="Doses at a glance",
            table=[
                ["Drug", "Usual adult dose"],
                ["Bethanechol", "10 to 50 mg PO three or four times daily"],
                ["Pilocarpine (oral)", "5 mg PO three times daily"],
                ["Oxybutynin IR", "5 mg PO two or three times daily"],
                ["Atropine (symptomatic bradycardia)", "1 mg IV every 3 to 5 minutes, maximum 3 mg"],
                ["Tiotropium (inhalation capsule)", "18 mcg inhaled once daily"],
            ],
            notes="Doses are teaching figures for this course. Always check a current reference.",
            flags=[
                ["dose", "1 mg IV every 3 to 5 minutes, maximum 3 mg", "Atropine bradycardia dose: check against the current resuscitation guideline."],
                ["dose", "18 mcg inhaled once daily", "Strength differs between tiotropium devices."],
            ],
        ),
        dict(
            title="Clinical pearls",
            bullets=[
                "Donepezil plus oxybutynin: opposing effects, and a classic prescribing cascade",
                "Quaternary amines (neostigmine, glycopyrrolate, ipratropium) do not cross the blood-brain barrier",
                "Scopolamine patch: apply behind the ear at least 4 hours before travel",
            ],
        ),
        dict(
            title="Summary",
            bullets=[
                "Agonists cause SLUDGE-type effects; antagonists cause the opposite",
                "Cholinesterase inhibitors raise ACh at both muscarinic and nicotinic sites",
                "Atropine for muscarinic toxicity; pralidoxime for organophosphates; physostigmine for severe anticholinergic toxicity",
            ],
            footer=True,
        ),
    ],
)

ADRENERGIC = dict(
    key="adr",
    file="PHAR7340-L09-adrenergic-agonists.pptx",
    name="PHAR 7340 L09 Adrenergic agonists.pptx",
    slides=[
        dict(
            title="Adrenergic Agonists",
            lines=["Pharmacology II (PHAR 7340)", "Lecture 9", "Autonomic pharmacology block"],
        ),
        dict(
            title="Learning objectives",
            bullets=[
                "Predict the effects of an agonist from the receptors it activates",
                "Compare catecholamines and non-catecholamines",
                "Choose an agent for shock, anaphylaxis, asthma and hypotension",
                "Name the key adverse effects of each group",
            ],
        ),
        dict(
            title="Catecholamines and non-catecholamines",
            bullets=[
                "Catecholamines: epinephrine, norepinephrine, dopamine, dobutamine, isoproterenol",
                ("Broken down by MAO and COMT: short acting, not given orally", 1),
                ("Poor entry into the CNS", 1),
                "Non-catecholamines: phenylephrine, ephedrine, pseudoephedrine, albuterol",
                ("Not COMT substrates: longer acting, several are oral", 1),
            ],
        ),
        dict(
            title="Receptor selectivity",
            table=[
                ["Drug", "Receptors", "Main effect"],
                ["Epinephrine", "alpha-1, alpha-2, beta-1, beta-2", "Raises heart rate and contractility; bronchodilates; vasoconstricts at high doses"],
                ["Norepinephrine", "alpha-1, alpha-2, beta-1 (little beta-2)", "Strong vasoconstriction; reflex slowing of heart rate is possible"],
                ["Dopamine", "D1, beta-1, alpha-1 (dose dependent)", "See the next slide"],
                ["Dobutamine", "Mainly beta-1", "Inotrope: raises contractility"],
                ["Isoproterenol", "beta-1, beta-2", "Raises heart rate; vasodilates"],
                ["Phenylephrine", "alpha-1", "Vasoconstriction; reflex bradycardia"],
                ["Albuterol", "beta-2", "Bronchodilation"],
                ["Clonidine", "alpha-2 (central)", "Lowers sympathetic outflow"],
            ],
        ),
        dict(
            title="Dopamine: effect depends on dose",
            bullets=[
                "Low dose: D1 receptors, renal and mesenteric vasodilation",
                "Intermediate dose: beta-1, more contractility and heart rate",
                "High dose: alpha-1, vasoconstriction",
                "So-called renal-dose dopamine does not protect the kidneys",
            ],
            notes="Published cut-offs between the ranges vary. A common teaching version is below about 3, about 3 to 10, and above 10 mcg/kg/min.",
            flags=[["dose", "below about 3, about 3 to 10, and above 10 mcg/kg/min", "Dose bands differ between references."]],
        ),
        dict(
            title="Shock and anaphylaxis",
            bullets=[
                "Septic shock: norepinephrine is the first-choice vasopressor",
                "Cardiogenic shock with low output: dobutamine adds contractility",
                "Anaphylaxis: epinephrine IM into the anterolateral thigh, first and without delay",
                "Antihistamines and corticosteroids are add-ons, never a substitute for epinephrine",
            ],
        ),
        dict(
            title="Beta-2 agonists",
            table=[
                ["Drug", "Action profile", "Role"],
                ["Albuterol (SABA)", "Onset within minutes, lasts 4 to 6 hours", "Reliever (rescue) inhaler"],
                ["Salmeterol (LABA)", "Lasts about 12 hours, slower onset", "Maintenance; never alone in asthma"],
                ["Formoterol (LABA)", "Fast onset, lasts about 12 hours", "Maintenance; with budesonide as reliever too"],
                ["Terbutaline", "Oral, inhaled or injected", "Bronchospasm"],
            ],
            notes="Adverse effects of beta-2 agonists: tremor, tachycardia, hypokalaemia and hyperglycaemia. In asthma a LABA is always paired with an inhaled corticosteroid.",
        ),
        dict(
            title="Alpha agonists",
            bullets=[
                "Phenylephrine (alpha-1): nasal decongestant, hypotension during anaesthesia, mydriasis",
                "Pseudoephedrine: oral decongestant, sold behind the counter; can raise blood pressure",
                "Oxymetazoline: topical decongestant; rebound congestion if used more than 3 days",
                "Midodrine (alpha-1 prodrug): orthostatic hypotension; watch for supine hypertension",
                "Clonidine (alpha-2): hypertension, ADHD, withdrawal symptoms; rebound hypertension if stopped suddenly",
                "Methyldopa (alpha-2): hypertension in pregnancy",
            ],
        ),
        dict(
            title="Indirect and mixed-acting agents",
            bullets=[
                "Amphetamine: releases stored NE and dopamine",
                "Cocaine: blocks NE reuptake (NET)",
                "Ephedrine: direct agonist and releaser (mixed acting)",
            ],
        ),
        dict(
            title="Doses at a glance",
            table=[
                ["Drug", "Setting", "Usual adult dose"],
                ["Epinephrine", "Anaphylaxis", "0.3 to 0.5 mg IM (1 mg/mL) in the thigh; repeat every 5 to 15 minutes if needed"],
                ["Epinephrine", "Cardiac arrest", "1 mg IV or IO every 3 to 5 minutes"],
                ["Albuterol inhaler", "Acute symptoms", "1 to 2 puffs (90 mcg per puff) every 4 to 6 hours as needed"],
                ["Clonidine", "Hypertension", "0.1 mg PO twice daily to start"],
                ["Midodrine", "Orthostatic hypotension", "2.5 to 10 mg PO three times daily while upright; last dose at least 4 hours before bedtime"],
            ],
            notes="Teaching figures for this course. The 1 mg/mL strength is for IM use only, never IV push.",
            flags=[
                ["dose", "0.3 to 0.5 mg IM (1 mg/mL)", "Concentration matters: 1 mg/mL is the IM strength."],
                ["dose", "0.1 mg PO twice daily", "Check the decimal."],
            ],
        ),
        dict(
            title="Summary",
            bullets=[
                "Receptor profile predicts the effect",
                "Norepinephrine for septic shock; epinephrine IM for anaphylaxis",
                "Beta-2 agonists: tremor, tachycardia, low potassium",
                "Never stop clonidine abruptly",
            ],
            footer=True,
        ),
    ],
)

BETA = dict(
    key="beta",
    file="PHAR7340-L10-beta-blockers.pptx",
    name="PHAR 7340 L10 Beta blockers.pptx",
    slides=[
        dict(
            title="Beta-Adrenergic Blockers",
            lines=["Pharmacology II (PHAR 7340)", "Lecture 10", "Autonomic pharmacology block"],
        ),
        dict(
            title="Learning objectives",
            bullets=[
                "Explain how beta blockade lowers heart rate, contractility and blood pressure",
                "Classify beta blockers by selectivity and extra properties",
                "Name the beta blockers proven in HFrEF",
                "Recognize adverse effects, contraindications and interactions",
            ],
        ),
        dict(
            title="Mechanism of action",
            bullets=[
                "Competitive antagonists at beta receptors",
                "Beta-1 blockade: lower heart rate, contractility and AV conduction",
                "Less renin release from the kidney",
                "Net effect: lower cardiac output, blood pressure and myocardial oxygen demand",
            ],
            notes="Because the antagonism is competitive, a large catecholamine surge can partly overcome it.",
        ),
        dict(
            title="Classification",
            table=[
                ["Group", "Examples", "Key point"],
                ["Non-selective (beta-1 and beta-2)", "Propranolol, nadolol, timolol", "Avoid in asthma"],
                ["Beta-1 selective (cardioselective)", "Atenolol, metoprolol, bisoprolol, esmolol", "Selectivity is lost at high doses"],
                ["Beta-1 selective with vasodilation", "Nebivolol", "Nitric oxide-mediated vasodilation"],
                ["Mixed alpha-1 and beta", "Carvedilol, labetalol", "Extra vasodilation from alpha-1 blockade"],
                ["Intrinsic sympathomimetic activity", "Pindolol, acebutolol", "Less slowing of the resting heart rate"],
            ],
            notes="Cardioselective does not mean cardiac-only.",
        ),
        dict(
            title="Pharmacokinetic differences",
            table=[
                ["Drug", "Lipid solubility", "Elimination", "Half-life"],
                ["Propranolol", "High", "Hepatic, large first-pass effect", "3 to 6 h"],
                ["Metoprolol", "Moderate", "Hepatic (CYP2D6)", "3 to 7 h"],
                ["Atenolol", "Low", "Renal", "6 to 7 h"],
                ["Nadolol", "Low", "Renal", "20 to 24 h"],
                ["Esmolol", "Low", "Red blood cell esterases", "About 9 minutes"],
                ["Carvedilol", "High", "Hepatic (CYP2D6, CYP2C9)", "7 to 10 h"],
            ],
            notes="Lipophilic agents reach the brain: vivid dreams and sleep disturbance are more common with propranolol. Renally cleared atenolol and nadolol accumulate in kidney disease.",
        ),
        dict(
            title="Clinical uses",
            bullets=[
                "Angina and after myocardial infarction",
                "HFrEF: only bisoprolol, carvedilol and metoprolol succinate",
                "Rate control in atrial fibrillation",
                "Hypertension, mainly when there is a compelling indication",
                "Propranolol: migraine prevention, essential tremor, symptoms of hyperthyroidism",
                "Timolol eye drops for glaucoma",
            ],
        ),
        dict(
            title="Adverse effects",
            bullets=[
                "Bradycardia, AV block, hypotension",
                "Fatigue and reduced exercise tolerance",
                "Bronchospasm in asthma, especially with non-selective agents",
                "Masks warning signs of hypoglycaemia (tremor, palpitations); sweating still occurs",
                "Cold extremities, sexual dysfunction",
                "Abrupt withdrawal: rebound tachycardia, angina, even myocardial infarction",
            ],
        ),
        dict(
            title="Contraindications and cautions",
            bullets=[
                "Severe bradycardia or second- or third-degree heart block without a pacemaker",
                "Cardiogenic shock and acutely decompensated heart failure",
                "Asthma: avoid non-selective agents; a cardioselective agent at low dose if one is needed",
                "Insulin-treated diabetes: warn about masked hypoglycaemia",
            ],
        ),
        dict(
            title="Interactions",
            bullets=[
                "Verapamil or diltiazem: additive bradycardia and AV block",
                "Clonidine: stop the beta blocker first when withdrawing both",
                "CYP2D6 inhibitors (fluoxetine, paroxetine) raise metoprolol levels",
                "NSAIDs blunt the blood pressure effect",
            ],
        ),
        dict(
            title="Usual starting doses (hypertension)",
            table=[
                ["Drug", "Starting dose", "Frequency"],
                ["Metoprolol tartrate", "25 to 50 mg", "Twice daily"],
                ["Metoprolol succinate ER", "25 to 100 mg", "Once daily"],
                ["Atenolol", "25 to 50 mg", "Once daily"],
                ["Bisoprolol", "2.5 to 5 mg", "Once daily"],
                ["Carvedilol", "6.25 mg", "Twice daily with food"],
                ["Propranolol", "40 mg", "Twice daily"],
                ["Nebivolol", "5 mg", "Once daily"],
            ],
            notes="Heart failure doses start much lower and are covered in Pharmacotherapy I. Teaching figures only.",
            flags=[["dose", "6.25 mg", "Check the decimal."]],
        ),
        dict(
            title="Counseling",
            bullets=[
                "Do not stop suddenly: taper over 1 to 2 weeks",
                "Take carvedilol with food to reduce dizziness",
                "Rise slowly from sitting or lying",
                "Check your pulse; report a heart rate that stays below 50",
            ],
        ),
        dict(
            title="Summary",
            bullets=[
                "Competitive beta antagonists lower heart rate, contractility and renin",
                "Selectivity guides the choice but fades at high doses",
                "Three are proven in HFrEF: bisoprolol, carvedilol, metoprolol succinate",
                "Taper, never stop abruptly",
            ],
            footer=True,
        ),
    ],
)

HTN = dict(
    key="htn",
    file="PHAR7310-L08-hypertension.pptx",
    name="PHAR 7310 L08 Hypertension.pptx",
    slides=[
        dict(
            title="Hypertension: Diagnosis and Drug Therapy",
            lines=["Pharmacotherapy I (PHAR 7310)", "Lecture 8", "Cardiovascular module"],
        ),
        dict(
            title="Learning objectives",
            bullets=[
                "Classify blood pressure using the 2017 ACC/AHA categories",
                "Decide when to start drug therapy and what goal to aim for",
                "Choose first-line drugs, including for compelling indications",
                "Plan monitoring for each first-line class",
            ],
        ),
        dict(
            title="Blood pressure categories (2017 ACC/AHA)",
            table=[
                ["Category", "Systolic (mm Hg)", "", "Diastolic (mm Hg)"],
                ["Normal", "Below 120", "and", "Below 80"],
                ["Elevated", "120 to 129", "and", "Below 80"],
                ["Stage 1 hypertension", "130 to 139", "or", "80 to 89"],
                ["Stage 2 hypertension", "140 or higher", "or", "90 or higher"],
            ],
            notes="When systolic and diastolic fall in different categories, use the higher category. A reading above 180/120 mm Hg is a hypertensive crisis.",
        ),
        dict(
            title="Measuring blood pressure",
            bullets=[
                "Seated and resting for at least 5 minutes, back supported, feet flat",
                "Arm supported at heart level, correct cuff size",
                "No caffeine, exercise or smoking for 30 minutes before",
                "Average at least 2 readings on at least 2 occasions",
                "Confirm with home or ambulatory readings",
            ],
        ),
        dict(
            title="When to start drug therapy",
            bullets=[
                "Stage 1 with clinical ASCVD or a 10-year ASCVD risk of 10% or more: lifestyle plus a drug",
                "Stage 1 with a 10-year risk below 10%: lifestyle first, reassess in 3 to 6 months",
                "Stage 2: lifestyle plus a drug",
                ("Start two first-line drugs of different classes if BP is more than 20/10 mm Hg above goal", 1),
                "Goal for most adults: below 130/80 mm Hg",
            ],
        ),
        dict(
            title="Lifestyle changes",
            table=[
                ["Change", "Approximate fall in systolic BP"],
                ["Weight loss", "About 1 mm Hg for every kg lost"],
                ["DASH eating pattern", "About 11 mm Hg"],
                ["Less sodium (ideally below 1500 mg a day)", "5 to 6 mm Hg"],
                ["More dietary potassium (3500 to 5000 mg a day)", "4 to 5 mm Hg"],
                ["Aerobic exercise, 90 to 150 minutes a week", "5 to 8 mm Hg"],
                ["Alcohol: at most 2 drinks a day (men) or 1 (women)", "About 4 mm Hg"],
            ],
            notes="Effects are roughly additive and are larger in people who already have hypertension.",
        ),
        dict(
            title="First-line drug classes",
            bullets=[
                "Thiazide-type diuretics (chlorthalidone preferred)",
                "ACE inhibitors",
                "Angiotensin receptor blockers (ARBs)",
                "Dihydropyridine calcium channel blockers",
                "Black adults without heart failure or CKD: start with a thiazide or a calcium channel blocker",
                "Never combine an ACE inhibitor with an ARB",
            ],
            notes="Beta blockers are not first line for uncomplicated hypertension. Use them when there is another reason, such as HFrEF or a previous myocardial infarction.",
        ),
        dict(
            title="Compelling indications",
            table=[
                ["Condition", "Preferred therapy"],
                ["HFrEF", "Guideline-directed therapy: ARNI, ACE inhibitor or ARB; evidence-based beta blocker; MRA"],
                ["CKD with albuminuria", "ACE inhibitor or ARB"],
                ["Diabetes with albuminuria", "ACE inhibitor or ARB"],
                ["Stable ischaemic heart disease or previous MI", "Beta blocker plus ACE inhibitor or ARB"],
                ["Pregnancy", "Labetalol or nifedipine; avoid ACE inhibitors, ARBs and aliskiren"],
            ],
        ),
        dict(
            title="First-line classes: adverse effects and monitoring",
            table=[
                ["Class", "Examples", "Key adverse effects", "Monitor"],
                ["Thiazide", "Chlorthalidone, hydrochlorothiazide", "Low potassium and sodium, high uric acid (gout), high glucose", "Electrolytes, uric acid"],
                ["ACE inhibitor", "Lisinopril, enalapril", "Dry cough, high potassium, angioedema, rise in creatinine", "Serum creatinine, potassium"],
                ["ARB", "Losartan, valsartan", "High potassium, rise in creatinine; no cough", "Serum creatinine, potassium"],
                ["Dihydropyridine CCB", "Amlodipine, nifedipine ER", "Ankle edema, headache, flushing", "Blood pressure, edema"],
                ["Non-dihydropyridine CCB", "Diltiazem, verapamil", "Bradycardia, constipation (verapamil)", "Heart rate; avoid in HFrEF"],
            ],
        ),
        dict(
            title="Usual starting doses",
            table=[
                ["Drug", "Brand", "Starting dose", "Usual range"],
                ["Chlorthalidone", "Thalitone", "12.5 mg once daily", "12.5 to 25 mg"],
                ["Hydrochlorothiazide", "Microzide", "12.5 to 25 mg once daily", "25 to 50 mg"],
                ["Lisinopril", "Zestril, Prinivil", "10 mg once daily", "10 to 40 mg"],
                ["Losartan", "Cozaar", "50 mg once daily", "50 to 100 mg"],
                ["Valsartan", "Diovan", "80 to 160 mg once daily", "80 to 320 mg"],
                ["Amlodipine", "Norvasc", "5 mg once daily", "2.5 to 10 mg"],
            ],
            notes="Start lower (for example lisinopril 5 mg) in older adults, in volume depletion or when already on a diuretic. Teaching figures only.",
            flags=[
                ["dose", "12.5 mg once daily", "Check the decimal."],
                ["drug_name", "Thalitone", "Brand name: check it is the current brand."],
            ],
        ),
        dict(
            title="Special situations",
            bullets=[
                "ACE inhibitors, ARBs and aliskiren are fetotoxic: avoid in pregnancy and counsel on contraception",
                "History of angioedema with an ACE inhibitor: do not use an ACE inhibitor again",
                "Bilateral renal artery stenosis: ACE inhibitors and ARBs can cause acute kidney injury",
                "A rise in serum creatinine of up to 30% after starting an ACE inhibitor or ARB is expected",
            ],
        ),
        dict(
            title="Follow-up",
            bullets=[
                "Recheck monthly until at goal, then every 3 to 6 months",
                "Check potassium and creatinine within 2 to 4 weeks of starting or raising an ACE inhibitor, ARB or diuretic",
                "Ask about adherence before adding a drug",
            ],
            flags=[["uncertain", "within 2 to 4 weeks", "Lab timing varies between sources; check what the course expects."]],
        ),
        dict(
            title="Summary",
            bullets=[
                "Stage 1 is 130/80; the goal is below 130/80 mm Hg for most adults",
                "First line: thiazide, ACE inhibitor or ARB, dihydropyridine CCB",
                "Compelling indications steer the choice",
                "Lifestyle helps every patient",
            ],
            footer=True,
        ),
    ],
)

HF = dict(
    key="hf",
    file="PHAR7310-L09-heart-failure.pptx",
    name="PHAR 7310 L09 Heart failure (HFrEF).pptx",
    slides=[
        dict(
            title="Heart Failure with Reduced Ejection Fraction",
            lines=["Pharmacotherapy I (PHAR 7310)", "Lecture 9", "Cardiovascular module"],
        ),
        dict(
            title="Learning objectives",
            bullets=[
                "Classify heart failure by ejection fraction, stage and NYHA class",
                "Explain why neurohormonal blockade improves survival",
                "Build a regimen from the four pillars of guideline-directed therapy",
                "Start and titrate each drug safely",
            ],
        ),
        dict(
            title="Heart failure by ejection fraction",
            table=[
                ["Type", "LVEF"],
                ["HFrEF (reduced)", "40% or less"],
                ["HFmrEF (mildly reduced)", "41% to 49%"],
                ["HFpEF (preserved)", "50% or more"],
                ["HFimpEF (improved)", "Was 40% or less, now above 40%"],
            ],
        ),
        dict(
            title="Stages and NYHA classes",
            table=[
                ["ACC/AHA stage", "Meaning", "NYHA class", "Meaning"],
                ["A", "At risk, no structural disease", "I", "No limitation of activity"],
                ["B", "Structural disease, never had symptoms", "II", "Slight limitation; ordinary activity causes symptoms"],
                ["C", "Structural disease with current or past symptoms", "III", "Marked limitation; less than ordinary activity causes symptoms"],
                ["D", "Advanced, symptoms despite maximal therapy", "IV", "Symptoms at rest"],
            ],
            notes="Stages only move forward. NYHA class can improve with treatment.",
        ),
        dict(
            title="Why neurohormonal blockade works",
            bullets=[
                "A failing heart activates the renin-angiotensin-aldosterone system and the sympathetic nervous system",
                "Result: vasoconstriction, salt and water retention, cardiac remodelling",
                "Blocking these systems slows remodelling and improves survival",
                "Diuretics relieve congestion but do not improve survival",
            ],
        ),
        dict(
            title="The four pillars of guideline-directed therapy",
            table=[
                ["Pillar", "Examples", "Benefit"],
                ["ARNI (or ACE inhibitor or ARB)", "Sacubitril/valsartan", "Lower mortality and fewer HF hospitalisations"],
                ["Evidence-based beta blocker", "Bisoprolol, carvedilol, metoprolol succinate", "Lower mortality"],
                ["Mineralocorticoid receptor antagonist (MRA)", "Spironolactone, eplerenone", "Lower mortality"],
                ["SGLT2 inhibitor", "Dapagliflozin, empagliflozin", "Fewer HF hospitalisations and cardiovascular deaths"],
            ],
            notes="Start all four as soon as possible, at low doses, rather than maximizing one drug before adding the next.",
        ),
        dict(
            title="Starting and target doses",
            table=[
                ["Drug", "Starting dose", "Target dose"],
                ["Sacubitril/valsartan", "49/51 mg twice daily", "97/103 mg twice daily"],
                ["Lisinopril", "2.5 to 5 mg once daily", "20 to 40 mg once daily"],
                ["Carvedilol", "3.125 mg twice daily", "25 mg twice daily (50 mg twice daily if over 85 kg)"],
                ["Metoprolol succinate", "12.5 to 25 mg once daily", "200 mg once daily"],
                ["Bisoprolol", "1.25 mg once daily", "10 mg once daily"],
                ["Spironolactone", "12.5 to 25 mg once daily", "25 to 50 mg once daily"],
                ["Dapagliflozin or empagliflozin", "10 mg once daily", "10 mg once daily"],
            ],
            notes="Beta blocker doses are doubled no more often than every 2 weeks. Teaching figures only.",
            flags=[
                ["dose", "3.125 mg twice daily", "Check the decimal."],
                ["dose", "49/51 mg twice daily", "Combination strength: sacubitril/valsartan."],
            ],
        ),
        dict(
            title="ARNI: sacubitril/valsartan",
            bullets=[
                "Sacubitril blocks neprilysin, so natriuretic peptides last longer",
                "Stop an ACE inhibitor at least 36 hours before the first dose",
                "Never use with an ACE inhibitor or after angioedema",
                "Watch blood pressure, potassium and renal function",
            ],
            notes="The 36-hour gap is there because neprilysin and ACE both break down bradykinin. Together they raise the risk of angioedema.",
        ),
        dict(
            title="MRA safety",
            bullets=[
                "Start only if potassium is below 5.0 mEq/L and eGFR is above 30 mL/min/1.73 m2",
                "Recheck potassium and renal function within about 1 week, then regularly",
                "Spironolactone can cause gynaecomastia; eplerenone rarely does",
                "Avoid potassium supplements and salt substitutes unless potassium is low",
            ],
            flags=[["unit", "5.0 mEq/L", "Check the decimal and the unit."]],
        ),
        dict(
            title="Symptom relief and add-on therapy",
            bullets=[
                "Loop diuretics for congestion: furosemide, bumetanide, torsemide",
                ("Roughly equivalent: furosemide 40 mg PO, furosemide 20 mg IV, bumetanide 1 mg, torsemide 20 mg", 1),
                "Hydralazine with isosorbide dinitrate: self-identified Black patients with NYHA III to IV on optimal therapy",
                "Ivabradine: sinus rhythm with resting heart rate of 70 or more on a maximally tolerated beta blocker",
                "Digoxin: fewer hospitalisations, no survival benefit",
            ],
            flags=[["dose", "furosemide 40 mg PO, furosemide 20 mg IV, bumetanide 1 mg, torsemide 20 mg", "Equivalence is approximate."]],
        ),
        dict(
            title="Drugs that worsen HFrEF",
            bullets=[
                "NSAIDs: salt and water retention, worse renal function",
                "Non-dihydropyridine calcium channel blockers (diltiazem, verapamil): negative inotropes",
                "Thiazolidinediones (pioglitazone): fluid retention",
                "Most antiarrhythmics, except amiodarone and dofetilide",
            ],
        ),
        dict(
            title="Summary",
            bullets=[
                "HFrEF means an LVEF of 40% or less",
                "Four pillars: ARNI, beta blocker, MRA, SGLT2 inhibitor",
                "Start low, titrate every 2 weeks, check potassium and renal function",
                "Loop diuretics for symptoms only",
            ],
            footer=True,
        ),
    ],
)

DECKS = [ANS, CHOLINERGIC, ADRENERGIC, BETA, HTN, HF]
