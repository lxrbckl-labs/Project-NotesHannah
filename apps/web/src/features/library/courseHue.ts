import type { NodeWithLinks } from "@notes/schema";
import { useQueries } from "@tanstack/react-query";
import { type CategoricalHue, hueForId } from "../../lib/hues";
import { nodeQuery } from "./queries";

/** The colour of a course: stable, the same on every device. Terms and the top stay neutral. */
export function courseHue(courseId: string): CategoricalHue {
  return hueForId(courseId);
}

/**
 * The colour a library item carries: its own if it is a course, its course's if it sits under
 * one, and none for terms (neutral). Reads the ancestors through the cache the breadcrumbs
 * already fill, so it costs no extra requests.
 */
export function useCourseHue(node: NodeWithLinks | undefined): CategoricalHue | null {
  const ancestors = useQueries({
    queries: (node && node.kind !== "course" && node.kind !== "term" ? node.ancestors : []).map(
      (id) => nodeQuery(id),
    ),
  });
  if (!node) return null;
  if (node.kind === "course") return courseHue(node.id);
  const course = ancestors.find((q) => q.data?.kind === "course")?.data;
  return course ? courseHue(course.id) : null;
}
