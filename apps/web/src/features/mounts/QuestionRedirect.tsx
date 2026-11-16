import { useEffect } from "react";
import { useParams } from "react-router";
import { Skeleton } from "../../components/ui/states";
import { useModuleNavigation } from "./navigation";

/** `/question/:id`: a practice question has no page of its own, so it opens the lecture it belongs to. */
export function QuestionRedirect() {
  const { questionId } = useParams();
  const { onOpenQuestion } = useModuleNavigation();
  useEffect(() => {
    if (questionId) void onOpenQuestion({ questionId, replace: true });
  }, [questionId, onOpenQuestion]);
  return <Skeleton className="m-6 h-24" />;
}
