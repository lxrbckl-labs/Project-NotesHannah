import type { ConceptType, RelationGroup, RelationType } from "@notes/schema";

/** One readable section of the concept page: a relation type read in one direction. */
export interface RelationSection {
  key: string;
  title: string;
  type: RelationType;
  direction: "out" | "in";
  group: RelationGroup;
}

const TITLES: Record<RelationType, { out: string; in: string }> = {
  belongs_to_class: { out: "Belongs to class", in: "Members of this class" },
  has_mechanism: { out: "Mechanism", in: "Classes and drugs with this mechanism" },
  acts_on: { out: "Acts on", in: "Mechanisms that act on this" },
  treats: { out: "Treats", in: "Treated with" },
  causes_adverse_effect: { out: "Adverse effects", in: "Caused by" },
  interacts_with: { out: "Interactions", in: "Interactions" },
  contraindicated_in: { out: "Contraindicated in", in: "Contraindicated with" },
  monitored_by: { out: "Monitoring", in: "Monitored for" },
  brand_of: { out: "Brand of", in: "Brand names as concepts" },
  related_to: { out: "Related", in: "Related" },
};

/** The order sections appear in: what a student reads first. */
const ORDER: RelationType[] = [
  "belongs_to_class",
  "has_mechanism",
  "acts_on",
  "treats",
  "causes_adverse_effect",
  "interacts_with",
  "contraindicated_in",
  "monitored_by",
  "brand_of",
  "related_to",
];

export function sectionTitle(type: RelationType, direction: "out" | "in"): string {
  return TITLES[type][direction];
}

/** Group the server's relation groups into titled sections: outgoing first, then incoming. */
export function relationSections(groups: RelationGroup[]): RelationSection[] {
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  const make = (g: RelationGroup): RelationSection => ({
    key: `${g.type}:${g.direction}`,
    title: sectionTitle(g.type, g.direction),
    type: g.type,
    direction: g.direction,
    group: g,
  });
  const rank = (g: RelationGroup) => ORDER.indexOf(g.type);
  const out = nonEmpty.filter((g) => g.direction === "out").sort((a, b) => rank(a) - rank(b));
  const inc = nonEmpty.filter((g) => g.direction === "in").sort((a, b) => rank(a) - rank(b));
  return [...out, ...inc].map(make);
}

/** Short edge words for the graph. */
export const EDGE_LABEL: Record<RelationType, string> = {
  belongs_to_class: "class",
  has_mechanism: "mechanism",
  acts_on: "acts on",
  treats: "treats",
  causes_adverse_effect: "causes",
  interacts_with: "interacts",
  contraindicated_in: "contraindicated",
  monitored_by: "monitor",
  brand_of: "brand of",
  related_to: "related",
};

export const RELATION_FILTER_LABEL: Record<RelationType, string> = {
  belongs_to_class: "Class",
  has_mechanism: "Mechanism",
  acts_on: "Acts on",
  treats: "Treats",
  causes_adverse_effect: "Adverse effects",
  interacts_with: "Interactions",
  contraindicated_in: "Contraindications",
  monitored_by: "Monitoring",
  brand_of: "Brand of",
  related_to: "Related",
};

export type TypeTone = "green" | "blue" | "violet" | "teal" | "red" | "amber" | "grey";

export const TYPE_TONE: Record<ConceptType, TypeTone> = {
  drug: "green",
  drug_class: "blue",
  mechanism: "violet",
  target: "violet",
  indication: "teal",
  adverse_effect: "red",
  interaction: "amber",
  contraindication: "red",
  monitoring_parameter: "teal",
  counselling_point: "amber",
  other: "grey",
};

export const SEVERITY_LABEL = {
  minor: "Minor",
  moderate: "Moderate",
  major: "Major",
  contraindicated: "Contraindicated",
} as const;
