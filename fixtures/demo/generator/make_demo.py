"""Generate the pharmacy demo files (original sample material) and their transcripts.

Run through fixtures/demo/generator/build.sh (needs Docker). Output: the directory given as argv[1]
(default /out): six .pptx decks, two typed PDFs, one handwriting-style image-only PDF, two JPEG photos,
and manifest.json with the transcript of every page (what the seeder saves, and what citations quote).
"""
import glob, io, json, math, os, random, sys
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Inches, Pt
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from decks import DECKS, FOOTER

OUT = sys.argv[1] if len(sys.argv) > 1 else "/out"
os.makedirs(OUT, exist_ok=True)
random.seed(2026)


def font_file(pattern):
    found = sorted(glob.glob(f"/usr/share/fonts/**/{pattern}", recursive=True))
    if not found:
        raise SystemExit(f"font not found: {pattern}")
    return found[0]


HAND = font_file("Humor-Sans.ttf")
SANS = font_file("DejaVuSans.ttf")
SANS_BOLD = font_file("DejaVuSans-Bold.ttf")

manifest = {"files": []}


def check_flags(text, flags, where):
    for flag in flags:
        if flag["quote"] not in text:
            raise SystemExit(f"{where}: flag quote not in transcript: {flag['quote']!r}")


# ------------------------------------------------------------------------------------------ pathways diagram
PW, PH = 1800, 800
PATHWAY_ROWS = [
    ("Parasympathetic", "ACh", "NN", "ACh", "Muscarinic receptor (M2, M3)"),
    ("Sympathetic", "ACh", "NN", "NE", "Adrenergic receptor (alpha, beta)"),
    ("Sympathetic: sweat glands", "ACh", "NN", "ACh", "Muscarinic receptor (M3)"),
    ("Adrenal medulla", "ACh", None, None, "Epinephrine and NE into the blood"),
    ("Somatic motor", "ACh", None, None, "NM receptor: skeletal muscle"),
]
# Where the picture sits on its slide (inches), so hotspots can be given as fractions of the slide image.
PIC_LEFT, PIC_TOP, PIC_WIDTH = 0.7, 1.55, 11.9
SLIDE_W, SLIDE_H = 13.333, 7.5


def pathways_png():
    im = Image.new("RGB", (PW, PH), "white")
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(SANS, 30)
    fb = ImageFont.truetype(SANS_BOLD, 30)
    small = ImageFont.truetype(SANS_BOLD, 26)
    spots = {}
    for i, (label, t1, ganglion, t2, target) in enumerate(PATHWAY_ROWS):
        y = 80 + i * 150
        d.text((20, y - 18), label, fill=(30, 30, 30), font=fb)
        d.rounded_rectangle((450, y - 32, 560, y + 32), 10, outline=(40, 70, 140), width=4, fill=(225, 233, 250))
        d.text((474, y - 17), "CNS", fill=(40, 70, 140), font=f)
        if ganglion:
            d.line((560, y, 860, y), fill=(60, 60, 60), width=5)
            d.text((680, y - 46), t1, fill=(150, 60, 20), font=small)
            d.ellipse((860, y - 40, 940, y + 40), outline=(20, 120, 90), width=5, fill=(220, 245, 235))
            d.text((878, y - 16), ganglion, fill=(20, 120, 90), font=small)
            d.line((940, y, 1250, y), fill=(60, 60, 60), width=5)
            d.text((1060, y - 46), t2, fill=(150, 60, 20), font=small)
            spots[f"ganglion{i}"] = (900, y)
        elif label == "Adrenal medulla":
            d.line((560, y, 860, y), fill=(60, 60, 60), width=5)
            d.text((680, y - 46), t1, fill=(150, 60, 20), font=small)
            d.rounded_rectangle((860, y - 34, 1235, y + 34), 12, outline=(20, 120, 90), width=4, fill=(220, 245, 235))
            d.text((880, y - 17), "Adrenal medulla (NN)", fill=(20, 120, 90), font=f)
            d.line((1235, y, 1260, y), fill=(60, 60, 60), width=5)
            spots["adrenal"] = (1050, y)
        else:
            d.line((560, y, 1250, y), fill=(60, 60, 60), width=5)
            d.text((880, y - 46), t1, fill=(150, 60, 20), font=small)
        d.polygon([(1250, y - 14), (1270, y), (1250, y + 14)], fill=(60, 60, 60))
        d.rounded_rectangle((1275, y - 34, 1785, y + 34), 12, outline=(120, 50, 120), width=4, fill=(245, 230, 245))
        d.text((1292, y - 17), target, fill=(90, 30, 90), font=f)
        spots[f"target{i}"] = (1530, y)
    b = io.BytesIO()
    im.save(b, "PNG", optimize=True)
    b.seek(0)
    pic_h = PIC_WIDTH * PH / PW
    to_slide = {
        k: (
            round((PIC_LEFT + x / PW * PIC_WIDTH) / SLIDE_W, 4),
            round((PIC_TOP + y / PH * pic_h) / SLIDE_H, 4),
        )
        for k, (x, y) in spots.items()
    }
    return b, to_slide


def pathways_lines():
    out = []
    for label, t1, ganglion, t2, target in PATHWAY_ROWS:
        if ganglion:
            out.append(f"{label}: CNS -> {t1} -> ganglion ({ganglion}) -> {t2} -> {target}")
        elif label == "Adrenal medulla":
            out.append(f"{label}: CNS -> {t1} -> Adrenal medulla (NN) -> {target}")
        else:
            out.append(f"{label}: CNS -> {t1} -> {target}")
    return out


# ------------------------------------------------------------------------------------------ decks
ACCENT = {"PHAR 7340": RGBColor(0x1F, 0x7A, 0x74), "PHAR 7310": RGBColor(0x7A, 0x3E, 0x7A)}


def transcript(slide):
    lines = [slide["title"]]
    lines += slide.get("lines", [])
    for b in slide.get("bullets", []):
        text, level = (b, 0) if isinstance(b, str) else b
        lines.append(("• " if level == 0 else "   – ") + text)
    if slide.get("image") == "pathways":
        lines += pathways_lines()
    for row in slide.get("table", []):
        lines.append(" | ".join(row))
    if slide.get("footer"):
        lines.append(FOOTER)
    text = "\n".join(lines)
    if slide.get("notes"):
        text += "\n\nSpeaker notes: " + slide["notes"]
    return text


def build_deck(deck):
    prs = Presentation()
    prs.slide_width = Inches(SLIDE_W)
    prs.slide_height = Inches(SLIDE_H)
    course = "PHAR 7340" if deck["file"].startswith("PHAR7340") else "PHAR 7310"
    accent = ACCENT[course]
    pages, hotspots = [], None
    for n, s in enumerate(deck["slides"]):
        slide = prs.slides.add_slide(prs.slide_layouts[5])  # Title Only
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(0.18))
        bar.fill.solid()
        bar.fill.fore_color.rgb = accent
        bar.line.fill.background()
        t = slide.shapes.title
        first = n == 0
        t.left, t.top, t.width, t.height = Inches(0.7), Inches(1.9 if first else 0.35), Inches(11.9), Inches(1.2)
        t.text_frame.text = s["title"]
        for r in t.text_frame.paragraphs[0].runs:
            r.font.size = Pt(44 if first else 34)
            r.font.bold = True
            r.font.color.rgb = accent
        if s.get("lines"):
            tb = slide.shapes.add_textbox(Inches(0.7), Inches(3.4), Inches(11.9), Inches(2.5))
            tf = tb.text_frame
            for i, line in enumerate(s["lines"]):
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                r = p.add_run()
                r.text = line
                r.font.size = Pt(26 if i == 0 else 22)
                r.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
        top = 1.65
        if s.get("bullets"):
            height = 1.4 if s.get("table") else 5.2
            tb = slide.shapes.add_textbox(Inches(0.7), Inches(top), Inches(11.9), Inches(height))
            tf = tb.text_frame
            tf.word_wrap = True
            for i, b in enumerate(s["bullets"]):
                text, level = (b, 0) if isinstance(b, str) else b
                p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
                p.level = level
                p.space_after = Pt(8)
                r = p.add_run()
                r.text = ("• " if level == 0 else "– ") + text
                r.font.size = Pt(22 if level == 0 else 18)
            top += height + 0.1
        if s.get("table"):
            rows = s["table"]
            ncols = len(rows[0])
            gf = slide.shapes.add_table(len(rows), ncols, Inches(0.7), Inches(top), Inches(11.9), Inches(0.5 * len(rows)))
            for i, row in enumerate(rows):
                for j, val in enumerate(row):
                    cell = gf.table.cell(i, j)
                    cell.text = val
                    for p in cell.text_frame.paragraphs:
                        for r in p.runs:
                            r.font.size = Pt(15 if i == 0 else 14)
                            r.font.bold = i == 0
        if s.get("image") == "pathways":
            png, hotspots = pathways_png()
            slide.shapes.add_picture(png, Inches(PIC_LEFT), Inches(PIC_TOP), width=Inches(PIC_WIDTH))
        if s.get("footer"):
            fb = slide.shapes.add_textbox(Inches(0.7), Inches(6.75), Inches(11.9), Inches(0.4))
            r = fb.text_frame.paragraphs[0].add_run()
            r.text = FOOTER
            r.font.size = Pt(12)
            r.font.italic = True
            r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = s["notes"]
        text = transcript(s)
        flags = [dict(kind=k, quote=q, note=nt) for k, q, nt in s.get("flags", [])]
        check_flags(text, flags, f"{deck['file']} slide {n + 1}")
        pages.append(dict(text=text, flags=flags))
    prs.save(f"{OUT}/{deck['file']}")
    entry = dict(key=deck["key"], file=deck["file"], name=deck["name"], pages=pages)
    if hotspots:
        entry["hotspots"] = {"page": 4, "points": hotspots}
    manifest["files"].append(entry)
    print(f"  {deck['file']}: {len(pages)} slides")


for deck in DECKS:
    build_deck(deck)


# ------------------------------------------------------------------------------------------ typed PDFs
STYLES = {
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=17, leading=21, spaceAfter=6),
    "meta": ParagraphStyle("meta", fontName="Helvetica", fontSize=9.5, leading=12, textColor=colors.HexColor("#555555"), spaceAfter=10),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, spaceBefore=8, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="Helvetica", fontSize=10.5, leading=14, spaceAfter=4),
    "formula": ParagraphStyle("formula", fontName="Courier-Bold", fontSize=10.5, leading=14, leftIndent=14, spaceAfter=4),
    "ex": ParagraphStyle("ex", fontName="Helvetica-Oblique", fontSize=10.5, leading=14, leftIndent=14, spaceAfter=4),
    "foot": ParagraphStyle("foot", fontName="Helvetica-Oblique", fontSize=8.5, leading=11, textColor=colors.HexColor("#666666"), spaceBefore=10),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=9.5, leading=11.5),
    "cellh": ParagraphStyle("cellh", fontName="Helvetica-Bold", fontSize=9.5, leading=11.5),
}


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_pdf(path, pages):
    """pages: list of pages; each page is a list of (style, text) or ("table", rows). One PDF page each."""
    story, texts = [], []
    for i, page in enumerate(pages):
        lines = []
        for item in page:
            kind, value = item[0], item[1]
            if kind == "table":
                data = [[Paragraph(esc(c), STYLES["cellh" if r == 0 else "cell"]) for c in row] for r, row in enumerate(value)]
                widths = item[2] if len(item) > 2 else None
                t = Table(data, colWidths=widths, repeatRows=1)
                t.setStyle(TableStyle([
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#999999")),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF4")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                ]))
                story.append(t)
                story.append(Spacer(1, 6))
                lines += [" | ".join(row) for row in value]
            else:
                story.append(Paragraph(esc(value), STYLES[kind]))
                lines.append(value)
        story.append(Paragraph(FOOTER, STYLES["foot"]))
        lines.append(FOOTER)
        if i < len(pages) - 1:
            story.append(PageBreak())
        texts.append("\n".join(lines))
    doc = SimpleDocTemplate(path, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch, title=os.path.basename(path), author="Sample study material")
    doc.build(story)
    if doc.page != len(pages):
        raise SystemExit(f"{path}: expected {len(pages)} pages, got {doc.page}; shorten a page")
    return texts


CALC_PAGES = [
    [
        ("h1", "Calculations Handout 1: Renal Function and Body Weight"),
        ("meta", "Pharmacotherapy I (PHAR 7310) · Practice set for the calculations quiz"),
        ("h2", "Cockcroft-Gault creatinine clearance"),
        ("formula", "CrCl (mL/min) = [(140 - age) x weight (kg)] / (72 x SCr (mg/dL))"),
        ("p", "Multiply by 0.85 for female patients."),
        ("p", "Course convention for the weight: use ideal body weight (IBW), or actual weight if it is lower. If actual weight is more than 120% of IBW, use adjusted body weight."),
        ("h2", "Body weight equations"),
        ("formula", "IBW (male) = 50 kg + 2.3 kg for each inch over 5 feet"),
        ("formula", "IBW (female) = 45.5 kg + 2.3 kg for each inch over 5 feet"),
        ("formula", "Adjusted body weight = IBW + 0.4 x (actual weight - IBW)"),
        ("h2", "Worked examples"),
        ("ex", "Example 1. Man, 68 years, 5 ft 10 in, 80 kg, SCr 1.4 mg/dL. IBW = 50 + 2.3 x 10 = 73 kg. Actual weight is 110% of IBW, so use 73 kg. CrCl = (72 x 73) / (72 x 1.4) = 52 mL/min."),
        ("ex", "Example 2. Woman, 75 years, 5 ft 4 in, 60 kg, SCr 1.1 mg/dL. IBW = 45.5 + 2.3 x 4 = 54.7 kg. CrCl = (65 x 54.7) / (72 x 1.1) x 0.85 = 38 mL/min."),
        ("ex", "Example 3. Man, 50 years, 5 ft 10 in, 120 kg, SCr 1.0 mg/dL. IBW = 73 kg; 120 kg is 164% of IBW, so adjusted weight = 73 + 0.4 x 47 = 91.8 kg. CrCl = (90 x 91.8) / (72 x 1.0) = 115 mL/min."),
    ],
    [
        ("h1", "Dosing and Infusion Rates"),
        ("h2", "Weight-based doses"),
        ("formula", "Weight (kg) = weight (lb) / 2.2"),
        ("formula", "Dose (mg) = dose per kg (mg/kg) x weight (kg)"),
        ("ex", "Example 4. Enoxaparin 1 mg/kg SC every 12 hours for a 176 lb patient: 176 / 2.2 = 80 kg, so 80 mg every 12 hours."),
        ("h2", "Infusion rates"),
        ("formula", "Rate (mL/hr) = dose per hour / concentration"),
        ("ex", "Example 5. Heparin 25,000 units in 250 mL (100 units/mL). Order: 18 units/kg/hr for an 80 kg patient. 18 x 80 = 1440 units/hr; 1440 / 100 = 14.4 mL/hr."),
        ("ex", "Example 6. Dopamine 400 mg in 250 mL (1600 mcg/mL). Order: 5 mcg/kg/min for a 70 kg patient. 5 x 70 = 350 mcg/min; x 60 = 21,000 mcg/hr; 21,000 / 1600 = 13.1 mL/hr."),
        ("h2", "Drip rates"),
        ("formula", "Drops per minute = volume (mL) x drop factor (gtt/mL) / time (min)"),
        ("ex", "Example 7. 1000 mL over 8 hours with a 15 gtt/mL set: 1000 x 15 / 480 = 31.25, about 31 gtt/min."),
        ("p", "Check every answer for size: a heparin rate of 144 mL/hr or a dopamine rate of 1.3 mL/hr should make you stop and recalculate."),
    ],
    [
        ("h1", "Milliequivalents and Pharmacokinetics"),
        ("h2", "Milliequivalents"),
        ("formula", "mEq = mg x valence / molecular weight"),
        ("ex", "Example 8. Potassium chloride (KCl, MW 74.5, valence 1): 1 g = 1000 x 1 / 74.5 = 13.4 mEq."),
        ("ex", "Example 9. Sodium chloride 0.9% contains 9 g per litre (MW 58.5): 9000 / 58.5 = 154 mEq of sodium per litre."),
        ("h2", "Loading dose and half-life"),
        ("formula", "Loading dose = Vd x target concentration (divide by F for an oral dose)"),
        ("ex", "Example 10. Vd 0.5 L/kg, 60 kg patient, target 10 mg/L: 0.5 x 60 x 10 = 300 mg."),
        ("formula", "t1/2 = 0.693 / k"),
        ("p", "An elimination rate constant of 0.1 per hour gives a half-life of 6.93 hours. Steady state is reached after about 4 to 5 half-lives."),
        ("h2", "Renal dosing reminders"),
        ("table", [
            ["Drug", "Rule taught in this course"],
            ["Metformin", "Do not start if eGFR is 30 to 45; contraindicated below 30 mL/min/1.73 m2"],
            ["Enoxaparin (treatment)", "CrCl below 30 mL/min: 1 mg/kg once daily"],
            ["Spironolactone (heart failure)", "Avoid if eGFR is 30 or below or potassium is 5.0 mEq/L or above"],
            ["Nitrofurantoin", "Avoid in older adults if CrCl is below 30 mL/min"],
        ], [1.9 * inch, 4.9 * inch]),
    ],
]
calc_texts = build_pdf(f"{OUT}/PHAR7310-calculations-handout.pdf", CALC_PAGES)
calc_flags = [
    [dict(kind="decimal", quote="Multiply by 0.85 for female patients.", note="Check the decimal.")],
    [dict(kind="dose", quote="18 units/kg/hr", note="Heparin nomogram rate: check against the protocol in use.")],
    [dict(kind="decimal", quote="t1/2 = 0.693 / k", note="0.693 is ln 2.")],
]
for t, f in zip(calc_texts, calc_flags):
    check_flags(t, f, "calculations handout")
manifest["files"].append(dict(key="calc", file="PHAR7310-calculations-handout.pdf", name="PHAR 7310 Calculations handout 1.pdf", pages=[dict(text=t, flags=f) for t, f in zip(calc_texts, calc_flags)]))
print(f"  PHAR7310-calculations-handout.pdf: {len(calc_texts)} pages")

TOP_CV = [
    ["Generic", "Brand", "Class"],
    ["amlodipine", "Norvasc", "Dihydropyridine CCB"],
    ["atenolol", "Tenormin", "Beta-1 selective blocker"],
    ["bumetanide", "Bumex", "Loop diuretic"],
    ["carvedilol", "Coreg", "Alpha-1 and beta blocker"],
    ["chlorthalidone", "Thalitone", "Thiazide-type diuretic"],
    ["clonidine", "Catapres", "Central alpha-2 agonist"],
    ["dapagliflozin", "Farxiga", "SGLT2 inhibitor"],
    ["digoxin", "Lanoxin", "Cardiac glycoside"],
    ["diltiazem", "Cardizem", "Non-dihydropyridine CCB"],
    ["empagliflozin", "Jardiance", "SGLT2 inhibitor"],
    ["enalapril", "Vasotec", "ACE inhibitor"],
    ["eplerenone", "Inspra", "Mineralocorticoid receptor antagonist"],
    ["furosemide", "Lasix", "Loop diuretic"],
    ["hydralazine/isosorbide dinitrate", "BiDil", "Vasodilator combination"],
    ["hydrochlorothiazide", "Microzide", "Thiazide diuretic"],
    ["ivabradine", "Corlanor", "Funny current (If) inhibitor"],
    ["labetalol", "Trandate", "Alpha-1 and beta blocker"],
    ["lisinopril", "Zestril, Prinivil", "ACE inhibitor"],
    ["losartan", "Cozaar", "Angiotensin receptor blocker"],
    ["metoprolol succinate", "Toprol-XL", "Beta-1 selective blocker"],
    ["metoprolol tartrate", "Lopressor", "Beta-1 selective blocker"],
    ["nebivolol", "Bystolic", "Beta-1 selective blocker, vasodilating"],
    ["nifedipine ER", "Procardia XL", "Dihydropyridine CCB"],
    ["propranolol", "Inderal LA", "Non-selective beta blocker"],
    ["sacubitril/valsartan", "Entresto", "ARNI"],
    ["spironolactone", "Aldactone", "Mineralocorticoid receptor antagonist"],
    ["valsartan", "Diovan", "Angiotensin receptor blocker"],
    ["verapamil", "Calan", "Non-dihydropyridine CCB"],
]
TOP_AUT = [
    ["Generic", "Brand", "Class"],
    ["albuterol", "Ventolin HFA", "Short-acting beta-2 agonist"],
    ["bethanechol", "Urecholine", "Muscarinic agonist"],
    ["cevimeline", "Evoxac", "Muscarinic agonist"],
    ["donepezil", "Aricept", "Cholinesterase inhibitor"],
    ["epinephrine auto-injector", "EpiPen", "Adrenergic agonist"],
    ["galantamine", "Razadyne", "Cholinesterase inhibitor"],
    ["glycopyrrolate", "Robinul", "Antimuscarinic"],
    ["ipratropium", "Atrovent HFA", "Short-acting muscarinic antagonist"],
    ["oxybutynin", "Ditropan XL", "Antimuscarinic (bladder)"],
    ["oxymetazoline", "Afrin", "Alpha agonist (topical decongestant)"],
    ["pilocarpine", "Salagen", "Muscarinic agonist"],
    ["pseudoephedrine", "Sudafed", "Sympathomimetic decongestant"],
    ["pyridostigmine", "Mestinon", "Cholinesterase inhibitor"],
    ["rivastigmine", "Exelon", "Cholinesterase inhibitor"],
    ["salmeterol", "Serevent", "Long-acting beta-2 agonist"],
    ["scopolamine patch", "Transderm Scop", "Antimuscarinic"],
    ["sugammadex", "Bridion", "Neuromuscular blockade reversal"],
    ["tiotropium", "Spiriva", "Long-acting muscarinic antagonist"],
    ["tolterodine", "Detrol", "Antimuscarinic (bladder)"],
]
widths = [2.3 * inch, 1.6 * inch, 2.9 * inch]
top_texts = build_pdf(f"{OUT}/top-drugs-brand-generic.pdf", [
    [
        ("h1", "Top Drugs: Brand and Generic Names"),
        ("meta", "Self-study sheet for Pharmacology II and Pharmacotherapy I · Page 1: cardiovascular"),
        ("table", TOP_CV, widths),
    ],
    [
        ("h1", "Top Drugs: Autonomic and Respiratory"),
        ("meta", "Page 2: drugs from the autonomic block"),
        ("table", TOP_AUT, widths),
        ("h2", "Stems worth knowing"),
        ("p", "-olol: beta blocker. -pril: ACE inhibitor. -sartan: angiotensin receptor blocker. -dipine: dihydropyridine CCB. -gliflozin: SGLT2 inhibitor. -stigmine: cholinesterase inhibitor."),
    ],
])
top_flags = [[dict(kind="drug_name", quote="Funny current (If) inhibitor", note="Class name: check the spelling of If.")], []]
manifest["files"].append(dict(key="top", file="top-drugs-brand-generic.pdf", name="Top drugs brand and generic.pdf", pages=[dict(text=t, flags=f) for t, f in zip(top_texts, top_flags)], table=dict(cardiovascular=TOP_CV[1:], autonomic=TOP_AUT[1:])))
print(f"  top-drugs-brand-generic.pdf: {len(top_texts)} pages")


# ------------------------------------------------------------------------------------------ handwriting
HAND_PAGES = [
    [
        ("Beta blockers - lec 10   11/3", "title"),
        ("MOA: compete w/ NE + epi at B receptors", None),
        ("  -> lower HR, contractility, renin", None),
        ("B1 selective (A-M): atenolol, metoprolol,", None),
        ("  bisoprolol, esmolol", None),
        ("Non-selective: propranolol, nadolol, timolol", None),
        ("Mixed a1 + B: carvedilol, labetalol", None),
        ("Nebivolol = B1 + NO vasodilation", None),
        ("* only 3 for HFrEF: carvedilol,", "star"),
        ("  metoprolol SUCCINATE, bisoprolol", None),
    ],
    [
        ("Side effects", "title"),
        ("- bradycardia, AV block, fatigue", None),
        ("- bronchospasm (non-selective!)", None),
        ("- masks hypoglycemia (sweating still happens)", None),
        ("- vivid dreams w/ propranolol (lipophilic)", None),
        ("NEVER stop abruptly -> taper 1-2 wk", "box"),
        ("Esmolol t1/2 ~9 min (IV only)", None),
        ("Atenolol + nadolol = renal -> adjust in CKD", None),
        ("+ verapamil/diltiazem = too slow (AV block)", None),
    ],
    [
        ("Doses to know", "title"),
        ("metoprolol tart 25-50 mg BID", None),
        ("metoprolol succ 25-100 mg daily", None),
        ("carvedilol 3.125 mg BID in HF, w/ food", None),
        ("propranolol: migraine, tremor, thyroid", None),
        ("timolol drops = glaucoma", None),
        ("Q for office hrs: why is carvedilol target", "star"),
        ("  50 mg BID if >85 kg?", None),
    ],
]
HAND_FLAGS = [
    [dict(kind="uncertain", quote="B1 selective (A-M)", note="B1 is my shorthand for beta-1.")],
    [dict(kind="decimal", quote="Esmolol t1/2 ~9 min", note="Approximate value written quickly.")],
    [
        dict(kind="dose", quote="metoprolol tart 25-50 mg BID", note="Hand-copied dose: check against the slide."),
        dict(kind="dose", quote="carvedilol 3.125 mg BID in HF", note="Check the decimal."),
    ],
]


def hand_page(lines, seed):
    rnd = random.Random(seed)
    w, h = 1275, 1650
    im = Image.new("RGB", (w, h), (252, 250, 241))
    d = ImageDraw.Draw(im)
    for y in range(150, h - 60, 92):
        d.line((60, y, w - 60, y), fill=(178, 200, 228), width=2)
    d.line((150, 0, 150, h), fill=(232, 160, 160), width=2)
    font = ImageFont.truetype(HAND, 44)
    big = ImageFont.truetype(HAND, 54)
    y = 150 - 52
    for text, mark in lines:
        f = big if mark == "title" else font
        ink = (24 + rnd.randint(0, 12), 38 + rnd.randint(0, 12), 118 + rnd.randint(0, 20))
        x = 175 + rnd.randint(-6, 8)
        layer = Image.new("RGBA", (w, 120), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        cx = x
        for word in text.split(" "):
            if word == "":
                cx += 14
                continue
            ld.text((cx, 30 + rnd.randint(-3, 3)), word, fill=ink + (255,), font=f)
            cx += ld.textlength(word + " ", font=f) + rnd.randint(-2, 4)
        layer = layer.rotate(rnd.uniform(-0.8, 0.8), resample=Image.BICUBIC, center=(x, 60))
        im.paste(layer, (0, y - 30), layer)
        if mark == "title":
            d.line((x, y + 62, x + int(f.getlength(text)), y + 66), fill=ink, width=4)
        if mark == "box":
            d.rounded_rectangle((x - 16, y - 8, x + int(f.getlength(text)) + 18, y + 64), 18, outline=(190, 40, 40), width=4)
        if mark == "star":
            d.text((90, y + 2), "!", fill=(190, 40, 40), font=big)
        y += 92
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    return im


hand_imgs = [hand_page(lines, 40 + i) for i, lines in enumerate(HAND_PAGES)]
hand_imgs[0].save(f"{OUT}/beta-blockers-handwritten-notes.pdf", save_all=True, append_images=hand_imgs[1:], resolution=150, quality=62)
hand_texts = ["\n".join(text for text, _ in page) for page in HAND_PAGES]
for t, f in zip(hand_texts, HAND_FLAGS):
    check_flags(t, f, "handwritten notes")
manifest["files"].append(dict(key="hand", file="beta-blockers-handwritten-notes.pdf", name="Beta blockers handwritten notes.pdf", pages=[dict(text=t, flags=f) for t, f in zip(hand_texts, HAND_FLAGS)]))
print(f"  beta-blockers-handwritten-notes.pdf: {len(hand_imgs)} pages (images only)")


# ------------------------------------------------------------------------------------------ photos
def photo(board, background, out_w, out_h, quad_jitter, seed):
    """Put a flat board image into a photo: perspective, uneven light, sensor noise."""
    rnd = random.Random(seed)
    canvas = Image.new("RGB", (out_w, out_h), background)
    mx, my = int(out_w * 0.06), int(out_h * 0.07)
    j = lambda: rnd.randint(-quad_jitter, quad_jitter)
    # Corners of the board in the photo: top-left, bottom-left, bottom-right, top-right.
    dst = [(mx + j(), my + j()), (mx + j(), out_h - my + j()), (out_w - mx + j(), out_h - my + j()), (out_w - mx + j(), my + j())]
    flat = board.resize((out_w - 2 * mx, out_h - 2 * my), Image.LANCZOS).convert("RGBA")
    fw, fh = flat.size
    coeffs = _perspective_coeffs(dst, [(0, 0), (0, fh), (fw, fh), (fw, 0)])
    warped = flat.transform((out_w, out_h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    canvas.paste(warped, (0, 0), warped)
    # Light falls off away from one corner; then a little grain and softness.
    light = Image.radial_gradient("L").resize((out_w * 2, out_h * 2)).crop((int(out_w * 0.3), int(out_h * 0.2), int(out_w * 1.3), int(out_h * 1.2)))
    dark = Image.new("RGB", canvas.size, (0, 0, 0))
    canvas = Image.composite(dark, canvas, light.point(lambda v: int(v * 0.28)))
    noise = Image.effect_noise((out_w, out_h), 14).convert("RGB")
    canvas = Image.blend(canvas, noise, 0.05)
    return canvas.filter(ImageFilter.GaussianBlur(0.7))


def _perspective_coeffs(target, source):
    """Coefficients for Image.PERSPECTIVE mapping target points back to source points."""
    rows = []
    for (x, y), (u, v) in zip(target, source):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, v])
    # Solve the 8x8 system by Gaussian elimination.
    n = 8
    m = [r[:] for r in rows]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                for k in range(c, n + 1):
                    m[r][k] -= f * m[c][k]
    return [m[i][n] / m[i][i] for i in range(n)]


def marker_text(d, xy, text, size, color, rnd):
    f = ImageFont.truetype(HAND, size)
    x, y = xy
    for word in text.split(" "):
        d.text((x, y + rnd.randint(-3, 3)), word, fill=color, font=f)
        x += f.getlength(word + " ") + rnd.randint(-1, 3)


WHITEBOARD_ROWS = [
    ["Class", "Example", "Watch for"],
    ["Thiazide", "chlorthalidone", "low K, high uric acid"],
    ["ACEi", "lisinopril", "cough, high K, angioedema"],
    ["ARB", "losartan", "high K, no cough"],
    ["DHP CCB", "amlodipine", "ankle edema"],
]
WHITEBOARD_TITLE = "1st line HTN drugs (ACC/AHA 2017)"
WHITEBOARD_NOTE = "Goal < 130/80 for most adults. Never ACEi + ARB together!"


def whiteboard():
    rnd = random.Random(7)
    w, h = 2400, 1700
    im = Image.new("RGB", (w, h), (244, 245, 242))
    d = ImageDraw.Draw(im)
    for _ in range(25):  # ghosts of erased writing
        x, y = rnd.randint(0, w), rnd.randint(0, h)
        d.line((x, y, x + rnd.randint(80, 400), y + rnd.randint(-20, 20)), fill=(226, 228, 226), width=rnd.randint(8, 20))
    blue, black, red = (30, 70, 170), (35, 35, 40), (190, 40, 40)
    marker_text(d, (120, 70), WHITEBOARD_TITLE, 96, blue, rnd)
    cols = [120, 640, 1300, 2300]
    top = 260
    row_h = 210
    for r, row in enumerate(WHITEBOARD_ROWS):
        y = top + r * row_h
        for c, cell in enumerate(row):
            marker_text(d, (cols[c] + 20, y + 50), cell, 74 if r == 0 else 64, blue if r == 0 else black, rnd)
    for r in range(len(WHITEBOARD_ROWS) + 1):
        y = top + r * row_h
        d.line((cols[0], y + rnd.randint(-4, 4), cols[-1], y + rnd.randint(-4, 4)), fill=black, width=6)
    for x in cols:
        d.line((x + rnd.randint(-4, 4), top, x + rnd.randint(-4, 4), top + row_h * len(WHITEBOARD_ROWS)), fill=black, width=6)
    marker_text(d, (120, top + row_h * len(WHITEBOARD_ROWS) + 60), WHITEBOARD_NOTE, 72, red, rnd)
    return im


CARD_LEFT_TITLE = "Cholinergic crisis"
CARD_LEFT = ["(organophosphates)", "SLUDGE + bradycardia", "miosis, bronchorrhea", "Tx: atropine + pralidoxime"]
CARD_RIGHT_TITLE = "Anticholinergic tox"
CARD_RIGHT = ["hot, dry, red skin", "big pupils, delirium", "urinary retention", "Tx: supportive; physostigmine", "only in severe cases"]


def index_card():
    rnd = random.Random(11)
    w, h = 2000, 1250
    im = Image.new("RGB", (w, h), (253, 252, 246))
    d = ImageDraw.Draw(im)
    d.line((0, 190, w, 190), fill=(220, 120, 120), width=4)
    for y in range(280, h, 95):
        d.line((0, y, w, y), fill=(170, 200, 230), width=3)
    ink = (30, 30, 110)
    marker_text(d, (60, 70), CARD_LEFT_TITLE, 76, (150, 30, 30), rnd)
    marker_text(d, (1040, 70), CARD_RIGHT_TITLE, 76, (150, 30, 30), rnd)
    d.line((1000, 40, 1000, h - 40), fill=ink, width=5)
    for i, line in enumerate(CARD_LEFT):
        marker_text(d, (60, 225 + i * 95), line, 58, ink, rnd)
    for i, line in enumerate(CARD_RIGHT):
        marker_text(d, (1040, 225 + i * 95), line, 58, ink, rnd)
    return im


wb = photo(whiteboard(), (120, 110, 100), 1600, 1200, 40, 3)
wb.save(f"{OUT}/whiteboard-htn-first-line.jpg", "JPEG", quality=80)
wb_text = "\n".join([WHITEBOARD_TITLE] + [" | ".join(r) for r in WHITEBOARD_ROWS] + [WHITEBOARD_NOTE])
wb_flags = [dict(kind="uncertain", quote="Goal < 130/80", note="Units not written on the board (mm Hg).")]
check_flags(wb_text, wb_flags, "whiteboard")
manifest["files"].append(dict(key="board", file="whiteboard-htn-first-line.jpg", name="Whiteboard first-line HTN drugs.jpg", pages=[dict(text=wb_text, flags=wb_flags)]))

card = photo(index_card(), (92, 70, 52), 1600, 1100, 30, 5)
card.save(f"{OUT}/index-card-cholinergic-toxidromes.jpg", "JPEG", quality=80)
card_text = "\n".join([f"{CARD_LEFT_TITLE} | {CARD_RIGHT_TITLE}"] + CARD_LEFT + CARD_RIGHT)
manifest["files"].append(dict(key="card", file="index-card-cholinergic-toxidromes.jpg", name="Index card toxidromes.jpg", pages=[dict(text=card_text, flags=[])]))
print("  two photos")

manifest["footer"] = FOOTER
with open(f"{OUT}/manifest.json", "w") as fh:
    json.dump(manifest, fh, indent=1, ensure_ascii=False)
    fh.write("\n")
print("  manifest.json")
