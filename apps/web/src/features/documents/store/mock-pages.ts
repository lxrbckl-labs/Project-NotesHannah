import type { NormalizedBox } from "@notes/schema";

/**
 * Invented source pages for the mock store: slides from a lecture deck, a
 * page of handwritten notes, a receptor diagram and a textbook page that has
 * been trashed. Page images are generated SVGs that draw the transcript, so a
 * citation's region can be computed from where its quote sits on the page.
 */

/** A deterministic, well-formed ID: prefix + "01JC" + 22 digits. */
export function mockId(prefix: string, n: number): string {
  return `${prefix}_01JC${String(n).padStart(22, "0")}`;
}

export interface MockPage {
  id: string;
  fileId: string;
  index: number;
  title: string;
  /** The transcript as it would be stored. */
  text: string;
  style: "slide" | "handwriting" | "diagram" | "textbook";
}

export interface MockFile {
  id: string;
  name: string;
  trashed: boolean;
  deleted?: boolean;
  pages: MockPage[];
}

export const FILE_IDS = {
  deck: mockId("fil", 1),
  notes: mockId("fil", 2),
  textbook: mockId("fil", 3),
  deleted: mockId("fil", 4),
};

function page(
  fileId: string,
  index: number,
  title: string,
  text: string,
  style: MockPage["style"],
  n: number,
): MockPage {
  return { id: mockId("pag", n), fileId, index, title, text, style };
}

const deckPages: MockPage[] = [
  page(
    FILE_IDS.deck,
    2,
    "Where the receptors are",
    "Where the receptors are\nβ1: heart (SA node, AV node, ventricles).\nβ2: bronchial smooth muscle, vascular smooth muscle, liver.\nβ1: kidney (juxtaglomerular cells, renin release).",
    "diagram",
    12,
  ),
  page(
    FILE_IDS.deck,
    3,
    "Beta-adrenergic receptors",
    "Beta-adrenergic receptors\nβ1 receptors are found mainly in the heart, where stimulation increases heart rate and contractility.\nβ2 receptors are found in bronchial and vascular smooth muscle; stimulation causes relaxation.\nBeta blockers competitively antagonise catecholamines at beta-adrenergic receptors.",
    "slide",
    13,
  ),
  page(
    FILE_IDS.deck,
    4,
    "Cardioselectivity",
    "Cardioselectivity\nCardioselective agents (atenolol, metoprolol) preferentially block β1 receptors.\nSelectivity is dose-dependent and is lost at higher doses.\nNon-selective agents (propranolol, nadolol) block β1 and β2 receptors.\nCarvedilol and labetalol also block α1 receptors (vasodilation).",
    "slide",
    14,
  ),
  page(
    FILE_IDS.deck,
    5,
    "Clinical uses",
    "Clinical uses\nIndications: hypertension, angina, heart failure with reduced ejection fraction, secondary prevention after myocardial infarction, rate control in atrial fibrillation.\nPropranolol is also used for migraine prophylaxis and essential tremor.\nOnly bisoprolol, carvedilol and metoprolol succinate have mortality benefit in heart failure.",
    "slide",
    15,
  ),
  page(
    FILE_IDS.deck,
    6,
    "Adverse effects and cautions",
    "Adverse effects and cautions\nCommon adverse effects: bradycardia, fatigue, cold extremities, sleep disturbance.\nBeta blockers may mask the tachycardia of hypoglycaemia in patients with diabetes.\nAvoid non-selective agents in asthma: β2 blockade can trigger bronchospasm.\nNever stop a beta blocker abruptly: taper over 1–2 weeks to avoid rebound tachycardia.",
    "slide",
    16,
  ),
  page(
    FILE_IDS.deck,
    7,
    "Metoprolol",
    "Metoprolol\nMetoprolol tartrate (Lopressor): immediate release, given twice daily.\nMetoprolol succinate (Toprol-XL): extended release, once daily.\nHypertension: start 25–50 mg PO BID (tartrate), titrate to response.\nMonitor heart rate and blood pressure; hold if HR < 50 bpm.\nHepatic metabolism via CYP2D6: fluoxetine and paroxetine raise levels.",
    "slide",
    17,
  ),
  page(
    FILE_IDS.deck,
    8,
    "Comparing the agents",
    "Comparing the agents\nAtenolol: β1-selective, hydrophilic, renally cleared, half-life 6–7 h.\nMetoprolol: β1-selective, lipophilic, hepatic (CYP2D6), half-life 3–7 h.\nPropranolol: non-selective, highly lipophilic, hepatic, half-life 3–6 h.\nCarvedilol: non-selective with α1 blockade, hepatic, half-life 7–10 h.",
    "slide",
    18,
  ),
];

const notesPages: MockPage[] = [
  page(
    FILE_IDS.notes,
    1,
    "Week 7 notes",
    "Week 7 – beta blockers\nDr Patel: never stop a beta blocker abruptly!!\n-olol = beta blocker. carvedilol + labetalol also block alpha 1\nlipophilic ones (propranolol) cross BBB -> vivid dreams, CNS effects\nmetoprolol succ 25-100 mg once daily ?? ask in tutorial\ncounsel: take with food, don't skip doses",
    "handwriting",
    21,
  ),
];

const textbookPages: MockPage[] = [
  page(
    FILE_IDS.textbook,
    212,
    "Chapter 12",
    "Chapter 12. Sympatholytics\nBeta blockers reduce mortality after myocardial infarction.",
    "textbook",
    31,
  ),
];

const deletedPages: MockPage[] = [
  page(
    FILE_IDS.deleted,
    1,
    "Old handout",
    "Old handout\nSotalol also prolongs the QT interval.",
    "slide",
    41,
  ),
];

export const MOCK_FILES: MockFile[] = [
  { id: FILE_IDS.deck, name: "Lecture 07 – Beta blockers.pptx", trashed: false, pages: deckPages },
  { id: FILE_IDS.notes, name: "Week 7 handwritten notes.pdf", trashed: false, pages: notesPages },
  {
    id: FILE_IDS.textbook,
    name: "Pharmacology textbook, ch 12.pdf",
    trashed: true,
    pages: textbookPages,
  },
  {
    id: FILE_IDS.deleted,
    name: "Old handout.pdf",
    trashed: true,
    deleted: true,
    pages: deletedPages,
  },
];

export function findPage(pageId: string): { file: MockFile; page: MockPage } | null {
  for (const file of MOCK_FILES) {
    const found = file.pages.find((p) => p.id === pageId);
    if (found) return { file, page: found };
  }
  return null;
}

/** Look up a page by file and slide or page number (fixture convenience). */
export function pageAt(fileId: string, index: number): MockPage {
  const file = MOCK_FILES.find((f) => f.id === fileId);
  const found = file?.pages.find((p) => p.index === index);
  if (!found) throw new Error(`No mock page ${fileId} #${index}`);
  return found;
}

// ---------------------------------------------------------------------------
// Layout and SVG rendering.
// ---------------------------------------------------------------------------

interface PageGeometry {
  width: number;
  height: number;
  marginX: number;
  top: number;
  lineHeight: number;
  titleSize: number;
  bodySize: number;
  charsPerLine: number;
}

function geometry(style: MockPage["style"]): PageGeometry {
  if (style === "handwriting" || style === "textbook")
    return {
      width: 850,
      height: 1100,
      marginX: 80,
      top: 150,
      lineHeight: 44,
      titleSize: 34,
      bodySize: 24,
      charsPerLine: 52,
    };
  return {
    width: 1280,
    height: 720,
    marginX: 90,
    top: 190,
    lineHeight: 48,
    titleSize: 46,
    bodySize: 26,
    charsPerLine: style === "diagram" ? 34 : 72,
  };
}

interface LaidLine {
  text: string;
  /** Offset of this line's first character in the transcript text. */
  start: number;
  y: number;
  title: boolean;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function layout(p: MockPage): { geo: PageGeometry; lines: LaidLine[] } {
  const geo = geometry(p.style);
  const lines: LaidLine[] = [];
  let offset = 0;
  let y = geo.top;
  p.text.split("\n").forEach((raw, i) => {
    if (i === 0) {
      lines.push({ text: raw, start: 0, y: geo.top - 70, title: true });
    } else {
      let local = 0;
      for (const piece of wrap(raw, geo.charsPerLine)) {
        const at = raw.indexOf(piece, local);
        lines.push({ text: piece, start: offset + at, y, title: false });
        local = at + piece.length;
        y += geo.lineHeight;
      }
      y += geo.lineHeight * 0.35;
    }
    offset += raw.length + 1;
  });
  return { geo, lines };
}

/** The box around a quote on the page, from the generated layout. */
export function regionForQuote(p: MockPage, quote: string): NormalizedBox | undefined {
  const at = p.text.indexOf(quote);
  if (at < 0) return undefined;
  const end = at + quote.length;
  const { geo, lines } = layout(p);
  const hit = lines.filter((l) => !l.title && l.start < end && l.start + l.text.length > at);
  if (hit.length === 0) return undefined;
  const first = hit[0] as LaidLine;
  const last = hit[hit.length - 1] as LaidLine;
  const top = first.y - geo.bodySize - 8;
  const bottom = last.y + 14;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    x: round((geo.marginX - 18) / geo.width),
    y: round(top / geo.height),
    width: round((geo.width - 2 * geo.marginX + 36) / geo.width),
    height: round((bottom - top) / geo.height),
  };
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function diagramArt(): string {
  return `
  <g opacity="0.95">
    <ellipse cx="760" cy="300" rx="70" ry="110" fill="#f3c9c4" stroke="#c2574b" stroke-width="4"/>
    <ellipse cx="960" cy="300" rx="70" ry="110" fill="#f3c9c4" stroke="#c2574b" stroke-width="4"/>
    <path d="M860 170 v80 M860 250 l-60 40 M860 250 l60 40" stroke="#c2574b" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M860 380 c-70 -60 -120 -10 -90 50 c20 40 90 80 90 100 c0 -20 70 -60 90 -100 c30 -60 -20 -110 -90 -50z" fill="#e8796b" stroke="#a83b2f" stroke-width="4"/>
    <ellipse cx="1080" cy="520" rx="80" ry="45" fill="#d9b48a" stroke="#8a5a2b" stroke-width="4"/>
    <ellipse cx="660" cy="560" rx="34" ry="52" fill="#c48f6a" stroke="#7d4e2c" stroke-width="4"/>
    <path d="M700 640 h320" stroke="#5a7fc0" stroke-width="12" stroke-linecap="round"/>
  </g>`;
}

/** An SVG drawing of the page: the transcript laid out as a slide or a notebook page. */
export function pageSvg(p: MockPage): string {
  const { geo, lines } = layout(p);
  const hand = p.style === "handwriting";
  const font = hand
    ? "'Bradley Hand','Segoe Print','Comic Sans MS',cursive"
    : "'Helvetica Neue',Arial,sans-serif";
  const bg =
    p.style === "slide" || p.style === "diagram"
      ? `<rect width="100%" height="100%" fill="#fbfaf6"/><rect width="100%" height="18" fill="#2f6f5e"/><rect x="0" y="${geo.height - 40}" width="100%" height="40" fill="#eeede6"/><text x="${geo.width - 60}" y="${geo.height - 13}" font-family="${font}" font-size="18" fill="#77756c" text-anchor="end">${p.index}</text>`
      : `<rect width="100%" height="100%" fill="${hand ? "#fffdf3" : "#ffffff"}"/>${
          hand
            ? Array.from(
                { length: 24 },
                (_, i) =>
                  `<line x1="0" x2="${geo.width}" y1="${geo.top + i * geo.lineHeight + 10}" y2="${geo.top + i * geo.lineHeight + 10}" stroke="#c9dcf0" stroke-width="2"/>`,
              ).join("") +
              `<line x1="60" x2="60" y1="0" y2="${geo.height}" stroke="#f0b7b7" stroke-width="2"/>`
            : ""
        }<text x="${geo.width / 2}" y="${geo.height - 40}" font-family="${font}" font-size="18" fill="#888" text-anchor="middle">${p.index}</text>`;
  const text = lines
    .map((line) =>
      line.title
        ? `<text x="${geo.marginX}" y="${line.y}" font-family="${font}" font-size="${geo.titleSize}" font-weight="700" fill="${hand ? "#1d3a8a" : "#1c1b18"}">${esc(line.text)}</text>`
        : `<text x="${geo.marginX}" y="${line.y}" font-family="${font}" font-size="${geo.bodySize}" fill="${hand ? "#1d3a8a" : "#33322d"}">${esc(line.text)}</text>`,
    )
    .join("");
  const art = p.style === "diagram" ? diagramArt() : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}">${bg}${art}${text}</svg>`;
}

export function pageImage(p: MockPage): { url: string; width: number; height: number } {
  const geo = geometry(p.style);
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageSvg(p))}`,
    width: geo.width,
    height: geo.height,
  };
}
