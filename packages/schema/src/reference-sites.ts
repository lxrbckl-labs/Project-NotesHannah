import { type ReferenceSource, referenceSourceOf } from "./references.js";

/** One section of a built-in site: its own name, what it is for in our words, its address. */
export interface ReferenceSitePart {
  label: string;
  blurb: string;
  href: string;
  /** When an agent should look here, in our words. */
  useFor: string;
}

/**
 * A reference site the app knows by name and treats as trusted for checking and extending her
 * notes. Data only: the web app draws a card per entry and agents read the same list, so another
 * site is one more entry. Our own wording plus the site's section names and addresses only;
 * nothing from its pages (docs/references.md).
 */
export interface ReferenceSite {
  id: ReferenceSource;
  name: string;
  hosts: readonly string[];
  blurb: string;
  home: string;
  /** Their search, with {words} where the words go; null when there is none. */
  searchPattern: string | null;
  parts: readonly ReferenceSitePart[];
  /** Topic names to search for, when the topics have no address of their own. */
  topics: readonly string[];
  notice: string;
}

const PG = "https://www.pharmguides.com";

export const REFERENCE_SITES: readonly ReferenceSite[] = [
  {
    id: "pharmguides",
    name: "PharmGuides",
    hosts: ["pharmguides.com", "www.pharmguides.com"],
    blurb:
      "A searchable index of clinical practice guidelines, sorted by therapeutic area, with pharmacy tools beside it.",
    home: `${PG}/`,
    searchPattern: `${PG}/search/?query={words}`,
    parts: [
      {
        label: "Guidelines by category",
        blurb: "Browse guidelines by therapeutic area.",
        href: `${PG}/categories/`,
        useFor: "finding the current practice guideline for a topic",
      },
      {
        label: "AntibioticDex",
        blurb: "Which antibiotics cover which organisms, tissue reach, IV to oral.",
        href: `${PG}/antibioticdex/`,
        useFor: "antibiotic spectrum, tissue penetration and IV to oral switches",
      },
      {
        label: "DoseDex",
        blurb: "Emergency and critical care dosing for adults, children and newborns.",
        href: `${PG}/dosedex/`,
        useFor: "emergency and critical care doses",
      },
      {
        label: "TNKalc",
        blurb: "A calculator for tenecteplase doses.",
        href: `${PG}/tnkalc/`,
        useFor: "tenecteplase dosing",
      },
      {
        label: "Pharmacy Notes",
        blurb: "Equations, equivalence and conversion charts, pharmacist resources.",
        href: `${PG}/clinical-notes/`,
        useFor: "pharmacy equations, benzodiazepine and opioid equivalence, IV to oral charts",
      },
    ],
    topics: [
      "Cardiovascular",
      "Critical Care",
      "Dermatologic",
      "Endocrine",
      "Gastrointestinal",
      "Gynecologic and Obstetric",
      "Hematologic",
      "Hepatic / Liver",
      "Immunization",
      "Infectious Disease",
      "Neurologic",
      "Nutritional",
      "Oncologic",
      "Ophthalmic and Otolaryngological",
      "Pain",
      "Pediatrics",
      "Pharmacy Initiatives",
      "Psychiatric",
      "Renal",
      "Respiratory",
      "Rheumatologic",
      "Special Populations",
      "Transplant",
      "Travel Health",
    ],
    notice:
      "Opens pharmguides.com. An independent, pharmacist-curated reference. Check primary sources before relying on any reference.",
  },
];

/** A built-in site's search address for some words, or its home page when it has no search. */
export function siteSearchUrl(site: ReferenceSite, words: string): string {
  if (!site.searchPattern) return site.home;
  // Spaces as "+", as a browser's own form submission sends them.
  return site.searchPattern.replace(
    "{words}",
    encodeURIComponent(words.trim()).replace(/%20/g, "+"),
  );
}

/** The words on a reference chip: "PharmGuides · DoseDex", or the title alone. */
export function attributionLabel(ref: { title: string; url: string }): string {
  const site = REFERENCE_SITES.find((s) => s.id === referenceSourceOf(ref.url));
  if (!site || ref.title.toLowerCase().includes(site.name.toLowerCase())) return ref.title;
  return `${site.name} · ${ref.title}`;
}
