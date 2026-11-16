"""Generate every converter test fixture from scratch (made-up content, no third-party material).

Run through fixtures/generator/build.sh (needs Docker). Output: the directory given as argv[1] (default /out).
"""
import io, json, os, random, shutil, struct, subprocess, sys, zipfile, zlib
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
import pikepdf

OUT = sys.argv[1] if len(sys.argv) > 1 else "/out"
os.makedirs(OUT, exist_ok=True)
random.seed(7)

# ---------------------------------------------------------------- lecture content (also the expected-text oracle)
SLIDES = [
  dict(title="Beta-Adrenergic Antagonists", bullets=["Pharmacology 301, Lecture 7", "Cardiovascular block"], notes="Welcome. Today: how beta-blockers work, who gets them, and why they are not interchangeable."),
  dict(title="Learning objectives", bullets=["Name the beta receptor subtypes and their tissues", "Explain the mechanism of beta blockade", "Classify agents by selectivity", "List major adverse effects and contraindications"], notes="Objectives map to the exam blueprint. Spend most time on selectivity."),
  dict(title="Receptor subtypes", table=[["Receptor","Main location","Effect of stimulation"],["beta-1","Heart, kidney","Raises heart rate and contractility"],["beta-2","Bronchi, vascular smooth muscle","Relaxation, bronchodilation"],["beta-3","Adipose tissue","Lipolysis"]], notes=None),
  dict(title="Mechanism of action", bullets=["Competitive antagonism at beta receptors", "Lower cAMP in cardiac myocytes", ("Reduced heart rate and contractility", 1), ("Reduced renin release", 1), "Net effect: lower cardiac output and blood pressure"], image=True, notes="Draw the cAMP pathway on the board. Stress that antagonism is competitive, so high catecholamine levels can overcome it."),
  dict(title="Classification by selectivity", table=[["Class","Examples","Note"],["Non-selective","Propranolol, nadolol","Block beta-1 and beta-2"],["Cardioselective","Metoprolol, atenolol","Selectivity lost at high doses"],["Mixed alpha/beta","Carvedilol, labetalol","Add vasodilation"]], notes="Cardioselective does not mean cardiac-only."),
  dict(title="Pharmacokinetics", bullets=["Propranolol: extensive first-pass metabolism", "Atenolol: renal elimination, t½ about 6-7 h", "Therapeutic range often quoted as 50-100 µg/mL for older assays", "Lipophilic agents cross the blood-brain barrier"], font="Arial", notes="Lipophilicity explains the sleep disturbance and vivid dreams reported with propranolol."),
  dict(title="Clinical uses", bullets=["Hypertension", "Angina and post-myocardial infarction", "Heart failure with reduced ejection fraction", "Arrhythmia rate control", "Migraine prophylaxis; essential tremor"], font="Calibri", notes=None),
  dict(title="Adverse effects", bullets=["Bradycardia and AV block", "Bronchospasm in asthma with non-selective agents", "Fatigue, cold extremities", "Masked hypoglycaemia in insulin-treated diabetes", "Abrupt withdrawal: rebound tachycardia"], notes="Never stop abruptly. Taper over one to two weeks."),
  dict(title="Interactions to know", bullets=["Verapamil or diltiazem: additive AV block", "Insulin: masked hypoglycaemia symptoms", "NSAIDs: blunted antihypertensive effect", "Clonidine: rebound hypertension on withdrawal"], font="Cambria", notes=None),
  dict(title="Dosing at a glance", table=[["Drug","Usual daily dose","Frequency"],["Metoprolol tartrate","50-200 mg","Twice daily"],["Atenolol","25-100 mg","Once daily"],["Propranolol","40-320 mg","Divided doses"],["Carvedilol","6.25-25 mg","Twice daily with food"]], notes="Doses are teaching figures only, not a prescribing reference."),
  dict(title="Case discussion (hidden)", bullets=["68-year-old with COPD and new hypertension", "Which beta-blocker, if any, and why?"], hidden=True, notes="Hidden slide: use only if time allows. Expected answer: cardioselective agent at a low dose, with monitoring."),
  dict(title="Summary", bullets=["Competitive beta antagonists reduce cardiac work", "Selectivity guides choice, but is dose dependent", "Taper, never stop abruptly"], notes="Questions before the quiz."),
]
json.dump(SLIDES, open(f"{OUT}/lecture.expected.json", "w"), indent=1, ensure_ascii=False)

def chart_png():
    im = Image.new("RGB", (900, 560), "white"); d = ImageDraw.Draw(im)
    f = ImageFont.load_default(size=30); small = ImageFont.load_default(size=22)
    d.text((40, 20), "Heart rate vs propranolol dose", fill="black", font=f)
    d.line((90, 480, 860, 480), fill="black", width=3); d.line((90, 480, 90, 90), fill="black", width=3)
    for i, v in enumerate([78, 70, 62, 55, 50]):
        x = 140 + i * 145; h = (v - 40) * 8
        d.rectangle((x, 480 - h, x + 90, 480), fill=(60 + i * 30, 110, 190))
        d.text((x + 15, 485), f"{i*40} mg", fill="black", font=small); d.text((x + 20, 480 - h - 28), str(v), fill="black", font=small)
    b = io.BytesIO(); im.save(b, "PNG"); b.seek(0); return b

def build_pptx(path):
    prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    for s in SLIDES:
        slide = prs.slides.add_slide(prs.slide_layouts[5])  # Title Only
        t = slide.shapes.title; t.left, t.top, t.width, t.height = Inches(0.7), Inches(0.4), Inches(11.9), Inches(1.2)
        t.text_frame.text = s["title"]
        font = s.get("font")
        if font:
            for r in t.text_frame.paragraphs[0].runs: r.font.name = font
        if "bullets" in s:
            width = Inches(6.8) if s.get("image") else Inches(11.9)
            tb = slide.shapes.add_textbox(Inches(0.7), Inches(1.9), width, Inches(4.8)); tf = tb.text_frame; tf.word_wrap = True
            first = True
            for b in s["bullets"]:
                text, lvl = (b, 0) if isinstance(b, str) else b
                p = tf.paragraphs[0] if first else tf.add_paragraph(); first = False
                p.level = lvl
                r = p.add_run(); r.text = ("• " if lvl == 0 else "– ") + text; r.font.size = Pt(26 if lvl == 0 else 22)
                if font: r.font.name = font
        if "table" in s:
            rows = s["table"]
            gf = slide.shapes.add_table(len(rows), len(rows[0]), Inches(0.7), Inches(2.0), Inches(11.9), Inches(0.7 * len(rows)))
            for i, row in enumerate(rows):
                for j, val in enumerate(row):
                    gf.table.cell(i, j).text = val
        if s.get("image"):
            slide.shapes.add_picture(chart_png(), Inches(7.8), Inches(1.9), width=Inches(4.9))
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = s["notes"]
        if s.get("hidden"):
            slide._element.set("show", "0")
    prs.save(path)

build_pptx(f"{OUT}/lecture.pptx")

# ---------------------------------------------------------------- PDFs
def text_pdf(path, pages):
    c = canvas.Canvas(path, pagesize=letter)
    for n in range(1, pages + 1):
        c.setFont("Helvetica-Bold", 20); c.drawString(72, 720, f"Study notes, page {n}")
        c.setFont("Helvetica", 12)
        c.drawString(72, 690, f"Warfarin inhibits vitamin K epoxide reductase (page {n}). Target INR 2.0-3.0.")
        c.drawString(72, 672, "Monitor: INR, bleeding signs. Interactions: antibiotics, amiodarone, St John's wort.")
        c.showPage()
    c.save()
text_pdf(f"{OUT}/text-layer.pdf", 5)
text_pdf(f"{OUT}/toomany-501pages.pdf", 501)

def handwriting_page(n, w=1700, h=2200):
    im = Image.new("RGB", (w, h), (250, 247, 238)); d = ImageDraw.Draw(im)
    for y in range(180, h, 70): d.line((80, y, w - 80, y), fill=(190, 205, 230), width=2)
    f = ImageFont.load_default(size=54)
    lines = [f"Lecture note {n}: beta blockers", "metoprolol 50 mg bid  (B1 selective)", "propranolol - non selective, crosses BBB", "NEVER stop abruptly -> rebound", "ask: carvedilol dose in HF?"]
    for i, line in enumerate(lines):
        x = 110
        for ch in line:
            d.text((x, 130 + i * 140 + random.randint(-6, 6)), ch, fill=(25, 35, 120), font=f)
            x += 30 + random.randint(-2, 3)
    for _ in range(6):
        pts = [(random.randint(100, w - 100), random.randint(900, h - 100)) for _ in range(6)]
        d.line(pts, fill=(25, 35, 120), width=5)
    return im
pages = [handwriting_page(i).resize((1275, 1650), Image.LANCZOS) for i in range(1, 5)]
pages[0].save(f"{OUT}/image-only.pdf", save_all=True, append_images=pages[1:], resolution=150, quality=55)

pdf = pikepdf.open(f"{OUT}/text-layer.pdf")
pdf.save(f"{OUT}/encrypted-userpw.pdf", encryption=pikepdf.Encryption(user="secret", owner="owner"))
pdf.save(f"{OUT}/encrypted-ownerpw-only.pdf", encryption=pikepdf.Encryption(user="", owner="owner"))
open(f"{OUT}/corrupt.pdf", "wb").write(b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" + os.urandom(3000))

# ---------------------------------------------------------------- photos
def paper_photo(w, h):
    im = Image.new("RGB", (w, h), (70, 60, 55)); d = ImageDraw.Draw(im)
    d.rectangle((int(w*.06), int(h*.04), int(w*.94), int(h*.96)), fill=(246, 243, 232))
    f = ImageFont.load_default(size=int(w / 22))
    for i, t in enumerate(["UPRIGHT TOP: Warfarin notes", "INR target 2.0-3.0", "Vitamin K antagonist", "Check interactions", "Bottom line: reads upright"]):
        d.text((int(w*.1), int(h*.08) + i * int(h*.11)), t, fill=(20, 20, 90), font=f)
    return im
up = paper_photo(3024, 4032)
# stored sideways + EXIF orientation 6 (display = rotate 90 clockwise), as a phone does
stored = up.transpose(Image.ROTATE_90)
ex = Image.Exif(); ex[0x0112] = 6; ex[0x010F] = "FakeCam"
stored.save(f"{OUT}/photo-exif6.jpg", "JPEG", quality=88, exif=ex)
up2 = paper_photo(1600, 2000)
stored2 = up2.transpose(Image.ROTATE_180)  # orientation 3 = rotate 180
ex2 = Image.Exif(); ex2[0x0112] = 3
stored2.save(f"{OUT}/photo-exif3.png", "PNG", exif=ex2)
# HEIC via heif-enc (x265). photo.heic is stored upright. photo-rotated.heic is stored sideways with an `irot`
# transform box (like an iPhone portrait shot): heif-enc turns the JPEG's EXIF orientation into irot.
paper_photo(1500, 2000).save(f"{OUT}/_photo-for-heic.png", "PNG")
subprocess.run(["heif-enc", "-q", "50", f"{OUT}/_photo-for-heic.png", "-o", f"{OUT}/photo.heic"], check=True)
small = paper_photo(1200, 1600).transpose(Image.ROTATE_90)
ex3 = Image.Exif(); ex3[0x0112] = 6
small.save(f"{OUT}/_photo-sideways.jpg", "JPEG", quality=85, exif=ex3)
subprocess.run(["heif-enc", "-q", "50", f"{OUT}/_photo-sideways.jpg", "-o", f"{OUT}/photo-rotated.heic"], check=True)
info = subprocess.run(["heif-info", f"{OUT}/photo-rotated.heic"], capture_output=True, text=True).stdout
assert "angle (ccw): " in info, "heif-enc did not write a rotation box:\n" + info
os.remove(f"{OUT}/_photo-for-heic.png"); os.remove(f"{OUT}/_photo-sideways.jpg")
b = open(f"{OUT}/photo-exif6.jpg", "rb").read(); open(f"{OUT}/truncated.jpg", "wb").write(b[: len(b) // 3])

# ---------------------------------------------------------------- bad / hostile files
b = open(f"{OUT}/lecture.pptx", "rb").read()
open(f"{OUT}/truncated.pptx", "wb").write(b[: int(len(b) * 0.6)])

with zipfile.ZipFile(f"{OUT}/junkxml.pptx", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>')
    z.writestr("ppt/presentation.xml", "<<<not xml at all>>>")

# decompression bomb: a valid deck plus a 700 MB run of zeros (compresses to ~700 KB)
with zipfile.ZipFile(f"{OUT}/lecture.pptx") as src, zipfile.ZipFile(f"{OUT}/zipbomb.pptx", "w", zipfile.ZIP_DEFLATED) as z:
    for i in src.infolist(): z.writestr(i.filename, src.read(i.filename))
    with z.open("ppt/media/bomb.bin", "w", force_zip64=True) as w:
        chunk = bytes(1024 * 1024)
        for _ in range(700): w.write(chunk)

# pixel bomb: 20000 x 20000 1-bit PNG (400 Mpixel, ~50 KB on disk)
Image.new("1", (20000, 20000), 1).save(f"{OUT}/pixelbomb.png", "PNG", optimize=True)

with zipfile.ZipFile(f"{OUT}/other-office.docx", "w") as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    z.writestr("word/document.xml", "<w:document xmlns:w='x'/>")
open(f"{OUT}/plain-text.pdf", "w").write("This is just a text file with a pdf extension.\n")

# password-protected PPTX (OLE EncryptedPackage), via msoffcrypto-tool
from msoffcrypto.format.ooxml import OOXMLFile
with open(f"{OUT}/lecture.pptx", "rb") as f_in, open(f"{OUT}/encrypted.pptx", "wb") as f_out:
    OOXMLFile(f_in).encrypt("secret", f_out)

# ---------------------------------------------------------------- visual deck: gradient, chart, grouped (SmartArt-like) shapes
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE

VISUAL = [
  dict(title="Gradient background", lines=["Slide with a two-colour gradient fill", "White text on a dark gradient must stay readable"], notes="Gradient test: the background is a linear gradient, not an image."),
  dict(title="Chart slide", chart=True, lines=["Heart rate falls with dose"], notes="Chart test: a native column chart with a title and category labels."),
  dict(title="Pathway as grouped shapes", group=["Receptor", "G-protein", "Adenylyl cyclase", "cAMP"], lines=["Grouped shapes stand in for SmartArt"], notes="Group test: four boxes with arrows between them, one group nested inside another."),
  dict(title="Plain closing slide", lines=["Nothing special here"], notes=None),
]
json.dump(VISUAL, open(f"{OUT}/deck-visual.expected.json", "w"), indent=1)

def build_visual(path):
    prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
    for i, s in enumerate(VISUAL):
        slide = prs.slides.add_slide(prs.slide_layouts[5])
        t = slide.shapes.title; t.left, t.top, t.width, t.height = Inches(0.7), Inches(0.4), Inches(11.9), Inches(1.2)
        t.text_frame.text = s["title"]
        if i == 0:
            fill = slide.background.fill; fill.gradient(); fill.gradient_angle = 35
            st = fill.gradient_stops; st[0].color.rgb = RGBColor(0x10, 0x20, 0x60); st[1].color.rgb = RGBColor(0x60, 0x20, 0x90)
            for r_ in t.text_frame.paragraphs[0].runs: r_.font.color.rgb = RGBColor(255, 255, 255)
        tb = slide.shapes.add_textbox(Inches(0.7), Inches(5.9), Inches(11.9), Inches(1.0)); tb.text_frame.word_wrap = True
        for j, line in enumerate(s["lines"]):
            p = tb.text_frame.paragraphs[0] if j == 0 else tb.text_frame.add_paragraph()
            r_ = p.add_run(); r_.text = line; r_.font.size = Pt(24)
            if i == 0: r_.font.color.rgb = RGBColor(255, 255, 255)
        if s.get("chart"):
            cd = CategoryChartData(); cd.categories = ["0 mg", "40 mg", "80 mg", "120 mg"]; cd.add_series("Heart rate (bpm)", (78, 70, 62, 55))
            gf = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1.5), Inches(1.8), Inches(10), Inches(4), cd)
            gf.chart.has_title = True; gf.chart.chart_title.text_frame.text = "Heart rate by propranolol dose"
        if s.get("group"):
            outer = slide.shapes.add_group_shape(); inner = outer.shapes.add_group_shape()
            for k, label in enumerate(s["group"]):
                host = inner if k >= 2 else outer
                box = host.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.9 + k * 3.0), Inches(2.6), Inches(2.4), Inches(1.4))
                box.text_frame.text = label
                box.fill.solid(); box.fill.fore_color.rgb = RGBColor(0x2E + k * 20, 0x75, 0xB6)
                if k:
                    host.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(0.9 + (k - 1) * 3.0 + 2.4), Inches(3.3), Inches(0.9 + k * 3.0), Inches(3.3))
        if s.get("notes"): slide.notes_slide.notes_text_frame.text = s["notes"]
    prs.save(path)
build_visual(f"{OUT}/deck-visual.pptx")

# ---------------------------------------------------------------- macro-carrying decks (the payload is inert junk: no macro is ever run)
def with_macro_part(src, dst, macro_enabled_main):
    # An OLE-looking blob: the header magic then filler. LibreOffice must neither run it nor choke on it.
    blob = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + bytes(504) + b"Attribute VB_Name = \"Module1\"\nSub AutoOpen()\nEnd Sub\n" + bytes(2000)
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "[Content_Types].xml":
                t = data.decode()
                t = t.replace("</Types>", '<Override PartName="/ppt/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')
                if macro_enabled_main:
                    t = t.replace("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml", "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml")
                data = t.encode()
            if item.filename == "ppt/_rels/presentation.xml.rels":
                data = data.decode().replace("</Relationships>", '<Relationship Id="rIdVba1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>').encode()
            zout.writestr(item.filename, data)
        zout.writestr("ppt/vbaProject.bin", blob)
with_macro_part(f"{OUT}/deck-visual.pptx", f"{OUT}/macro.pptx", False)
with_macro_part(f"{OUT}/deck-visual.pptx", f"{OUT}/macro.pptm", True)

# ---------------------------------------------------------------- lying zip header: declares 1 KB uncompressed, inflates to 700 MB
def lying_zip(path):
    tmp = path + ".honest"
    with zipfile.ZipFile(f"{OUT}/lecture.pptx") as src, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for i in src.infolist(): z.writestr(i.filename, src.read(i.filename))
        with z.open("ppt/media/bomb.bin", "w", force_zip64=True) as w:
            chunk = bytes(1024 * 1024)
            for _ in range(700): w.write(chunk)
    data = bytearray(open(tmp, "rb").read()); os.remove(tmp)
    name = b"ppt/media/bomb.bin"
    patched = 0
    # Patch the uncompressed size (and the zip64 extra field's copy) in the local header and the central directory.
    for sig, size_off, name_off in ((b"PK\x03\x04", 22, 30), (b"PK\x01\x02", 24, 46)):
        pos = 0
        while (pos := data.find(sig, pos)) != -1:
            nlen = struct.unpack_from("<H", data, pos + (26 if sig == b"PK\x03\x04" else 28))[0]
            if bytes(data[pos + name_off: pos + name_off + nlen]) == name:
                struct.pack_into("<I", data, pos + size_off, 1024); patched += 1
                elen = struct.unpack_from("<H", data, pos + (28 if sig == b"PK\x03\x04" else 30))[0]
                ex = pos + name_off + nlen
                if elen >= 12 and struct.unpack_from("<H", data, ex)[0] == 1:
                    struct.pack_into("<Q", data, ex + 4, 1024)
            pos += 4
    assert patched >= 2, patched
    open(path, "wb").write(data)
lying_zip(f"{OUT}/lying-zip-header.pptx")
print(sorted(os.listdir(OUT)))
