import {
  CALLOUT_DEFAULT_COLORS,
  type CalloutKind,
  type ConceptType,
  type ConnectorKind,
  type FileStatus,
  type InteractionSeverity,
  type practice,
  type RequestStatus,
} from "@notes/schema";
import type { Hue, Tone } from "./hues";

/**
 * Named roles on top of the palette. A feature never picks a colour for a meaning itself: it
 * looks the meaning up here and renders the hue with data-hue (or a component's hue prop).
 * Colour is never the only signal: every role is shown with a label or an icon as well.
 */

/** Concept types: the chip and node colour of each kind of concept. */
export const CONCEPT_TYPE_HUE: Record<ConceptType, Hue> = {
  drug: "green",
  drug_class: "blue",
  mechanism: "purple",
  target: "pink",
  indication: "teal",
  adverse_effect: "red",
  interaction: "orange",
  contraindication: "red",
  monitoring_parameter: "blue",
  counselling_point: "yellow",
  other: "gray",
};

/** How serious a drug interaction is. */
export const SEVERITY_HUE: Record<InteractionSeverity, Hue> = {
  minor: "gray",
  moderate: "orange",
  major: "red",
  contraindicated: "red",
};

/** Document callouts: the schema's own defaults, so the document, the canvas and agents agree. */
export const CALLOUT_HUE: Record<CalloutKind, Hue> = CALLOUT_DEFAULT_COLORS;

/** Document marks that are not chosen by her. */
export const DOCUMENT_HUE = {
  /** Citation numbers and links. */
  citation: "blue",
  /** Concept links in prose. */
  concept: "teal",
  /** The default highlighter. */
  highlight: "yellow",
  /** A flagged word (spelling, unclear). */
  flag: "orange",
  /** A flagged dose, unit or decimal: worth a second look. */
  flagDose: "red",
  /** A ticked checklist item. */
  checked: "green",
  /** A citation whose source is in the trash or gone. */
  citationMissing: "gray",
} as const satisfies Record<string, Hue>;

/** Practice feedback after an answer. */
export const FEEDBACK_HUE = {
  correct: "green",
  incorrect: "red",
  partial: "yellow",
  skipped: "gray",
} as const satisfies Record<string, Hue>;
export type Feedback = keyof typeof FEEDBACK_HUE;

/** Self-graded recall ratings. */
export const RATING_HUE: Record<practice.ReviewRating, Hue> = {
  again: "red",
  hard: "orange",
  good: "green",
  easy: "blue",
};

/** Requests to an agent. */
export const REQUEST_STATUS_HUE: Record<RequestStatus, Tone> = {
  waiting: "gray",
  in_progress: "blue",
  done: "green",
  declined: "orange",
  cancelled: "gray",
};

/** Source files on their way from upload to the library. */
export const FILE_STATUS_HUE: Record<FileStatus, Hue> = {
  uploaded: "gray",
  converting: "blue",
  converted: "teal",
  transcribed: "green",
  filed: "green",
  failed: "red",
};

/** Canvas connectors, by kind. The line uses the solid shade, the label the text shade. */
export const CONNECTOR_HUE: Record<ConnectorKind, Hue> = {
  leads_to: "gray",
  causes: "orange",
  treats: "green",
  contrasts: "purple",
  part_of: "blue",
  related: "gray",
};

/** Canvas cards and frames with no colour chosen. null means the plain surface. */
export const CANVAS_DEFAULT_HUE = {
  card: null,
  frame: null,
  /** A card being connected from, and drop targets. */
  connecting: "blue",
} as const satisfies Record<string, Hue | null>;

/** Semantic tones for messages, toasts and banners. */
export const STATUS_TONE = {
  neutral: "gray",
  accent: "accent",
  success: "green",
  warning: "orange",
  info: "blue",
  danger: "red",
} as const satisfies Record<string, Tone>;
export type StatusTone = keyof typeof STATUS_TONE;
