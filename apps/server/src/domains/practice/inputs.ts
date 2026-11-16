import { ConceptId, ExamId, NodeId, practice } from "@notes/schema";
import { z } from "zod";

const NodeIds = z.array(NodeId).min(1).max(50);

/**
 * Where a session draws from. The shared `SessionScope` plus the due
 * flashcards, and an optional exam or set of nodes to narrow the notebook
 * and the due deck (M3).
 */
export const StartScope = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({ kind: z.literal("nodes"), nodeIds: NodeIds }),
    z.strictObject({
      kind: z.literal("concepts"),
      conceptIds: z.array(ConceptId).min(1).max(50),
    }),
    z.strictObject({ kind: z.literal("exam"), examId: ExamId }),
    z.strictObject({
      kind: z.literal("missed"),
      examId: ExamId.optional(),
      nodeIds: NodeIds.optional(),
    }),
    z.strictObject({
      kind: z.literal("due"),
      examId: ExamId.optional(),
      nodeIds: NodeIds.optional(),
    }),
    z.strictObject({ kind: z.literal("all") }),
  ],
  { error: 'scope needs kind "nodes", "concepts", "exam", "missed", "due" or "all".' },
);
export type StartScope = z.infer<typeof StartScope>;

export const StartSessionInput = z.strictObject({
  scope: StartScope,
  /** Question types to draw; all of them when left out. */
  formats: z.array(practice.QuestionType).min(1).max(practice.QUESTION_TYPES.length).optional(),
  length: z.number().int().min(1).max(100).default(10),
  /** Same scope, formats, length, seed and questions give the same session. */
  seed: practice.RandomSeed.optional(),
});
export type StartSessionInput = z.input<typeof StartSessionInput>;

export const CreateQuestionsInput = z.strictObject({
  /** The lectures, folders or documents the questions belong to. */
  nodeIds: z.array(NodeId).min(1).max(10),
  questions: z.array(z.unknown()).min(1).max(100),
  /** Store the valid ones and report the rest, instead of refusing the whole batch. */
  partial: z.boolean().default(false),
});
export type CreateQuestionsInput = z.input<typeof CreateQuestionsInput>;

export const UpdateQuestionInput = z
  .strictObject({
    /** The whole question, replacing the old content. The type cannot change. */
    question: z.unknown().optional(),
    nodeIds: z.array(NodeId).min(1).max(10).optional(),
  })
  .refine((v) => v.question !== undefined || v.nodeIds !== undefined, {
    error: "Send `question` (the new content), `nodeIds` (where it lives), or both.",
  });
export type UpdateQuestionInput = z.input<typeof UpdateQuestionInput>;

export const SubmitAnswerInput = z.object({
  /** Which question; the first unanswered one when left out. */
  position: z.number().int().min(0).max(99).optional(),
  answer: practice.Answer,
  /** Milliseconds she took; measured by the server when left out. */
  timeTakenMs: z.number().int().min(0).max(86_400_000).optional(),
});

export const ReviewInput = z.strictObject({
  status: practice.ReviewStatus,
});
