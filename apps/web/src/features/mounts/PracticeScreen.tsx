import { useCallback, useMemo, useState } from "react";
import { useBlocker, useNavigate, useSearchParams } from "react-router";
import { ConfirmDialog } from "../../components/ui/dialog";
import { usePickNodes } from "../library/pickNodes";
import {
  PracticeApp,
  type PracticeView,
  type SessionScope,
  type SourceCitation,
} from "../practice";
import { useStores } from "./services";

const VIEWS: PracticeView[] = ["start", "cards", "notebook", "weak", "exams"];

/** `/practice`, `/exams` and `/practice/session/:id`: the practice module on the real server. */
function PracticeScreen({ route }: { route: "practice" | "exams" | "session" }) {
  const stores = useStores();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pickNodes = usePickNodes();
  const [active, setActive] = useState(false);
  const blocker = useBlocker(() => active);
  const sessionId = route === "session" ? location.pathname.split("/").pop() : undefined;

  const fromUrl = params.get("view") as PracticeView | null;
  const view: PracticeView =
    route === "exams" ? "exams" : fromUrl && VIEWS.includes(fromUrl) ? fromUrl : "start";

  // "Practise this": a link names what to practise and the session starts at once.
  const autoStart = useMemo<SessionScope | undefined>(() => {
    const node = params.get("node");
    const exam = params.get("exam");
    if (node) return { kind: "nodes", nodeIds: [node] };
    if (exam) return { kind: "exam", examId: exam };
    if (params.get("missed")) return { kind: "missed" };
    return undefined;
  }, [params]);

  const onViewChange = useCallback(
    (next: PracticeView) => {
      if (next === "exams") navigate("/exams");
      else if (route === "exams")
        navigate(next === "start" ? "/practice" : `/practice?view=${next}`);
      else setParams(next === "start" ? {} : { view: next }, { replace: true });
    },
    [navigate, route, setParams],
  );

  const openSource = useCallback(
    (c: SourceCitation) =>
      navigate(`/files/${c.fileId}?page=${c.pageId}&quote=${encodeURIComponent(c.quote)}`),
    [navigate],
  );

  return (
    <>
      <PracticeApp
        store={stores.practice}
        currentNodeId={params.get("node")}
        pickNodes={pickNodes}
        view={view}
        onViewChange={onViewChange}
        onActiveChange={setActive}
        onOpenSource={openSource}
        initialSessionId={sessionId}
        autoStart={autoStart}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
        title="Leave this practice session?"
        description="Your answers so far are kept, and you can pick the session up again from Practice."
        confirmLabel="Leave"
        onConfirm={() => blocker.proceed?.()}
      />
    </>
  );
}

export const PracticeRoute = () => <PracticeScreen route="practice" />;
export const ExamsRoute = () => <PracticeScreen route="exams" />;
export const SessionRoute = () => <PracticeScreen route="session" />;
export default PracticeScreen;
