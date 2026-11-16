import type { ConceptFilter, ConceptType } from "@notes/schema";

export interface FinderQuestion {
  id: string;
  /** The question up to the blank. */
  lead: string;
  /** What fills the blank. */
  pick: ConceptType[];
  pickLabel: string;
  example: string;
  build(targetId: string): ConceptFilter;
}

/** The server's filter queries (F5) written as the questions she would ask. */
export const FINDER_QUESTIONS: FinderQuestion[] = [
  {
    id: "causes",
    lead: "Everything that causes",
    pick: ["adverse_effect"],
    pickLabel: "an adverse effect",
    example: "bradycardia",
    build: (id) => ({
      kind: "with_relation",
      relation: "causes_adverse_effect",
      target: { id },
      side: "from",
      viaClass: true,
      limit: 200,
    }),
  },
  {
    id: "treats",
    lead: "Everything used to treat",
    pick: ["indication"],
    pickLabel: "a condition",
    example: "heart failure",
    build: (id) => ({
      kind: "with_relation",
      relation: "treats",
      target: { id },
      side: "from",
      viaClass: true,
      limit: 200,
    }),
  },
  {
    id: "contra",
    lead: "Everything contraindicated in",
    pick: ["contraindication"],
    pickLabel: "a condition",
    example: "pregnancy",
    build: (id) => ({
      kind: "with_relation",
      relation: "contraindicated_in",
      target: { id },
      side: "from",
      viaClass: true,
      limit: 200,
    }),
  },
  {
    id: "monitored",
    lead: "Everything monitored with",
    pick: ["monitoring_parameter"],
    pickLabel: "a measurement",
    example: "serum potassium",
    build: (id) => ({
      kind: "with_relation",
      relation: "monitored_by",
      target: { id },
      side: "from",
      viaClass: true,
      limit: 200,
    }),
  },
  {
    id: "class",
    lead: "All drugs in the class",
    pick: ["drug_class"],
    pickLabel: "a class",
    example: "beta blockers",
    build: (id) => ({ kind: "in_class", class: { id }, includeSubclasses: true, limit: 200 }),
  },
  {
    id: "mechanism",
    lead: "Drugs that share a mechanism with",
    pick: ["drug"],
    pickLabel: "a drug",
    example: "metoprolol",
    build: (id) => ({ kind: "sharing_mechanism", drug: { id }, limit: 200 }),
  },
];
