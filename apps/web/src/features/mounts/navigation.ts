import { useMemo } from "react";
import { useNavigate } from "react-router";
import { appHttp } from "../../lib/api";
import { nodeHref } from "../library/rules";

/**
 * Where links from the request and concept modules go. Agents link to a document by its document
 * id, and to a question by its question id, but the app's pages are addressed by library node: the
 * node is looked up through the existing read routes (`GET /documents/:id`, `GET /practice/questions/:id`).
 */
export function useModuleNavigation() {
  const navigate = useNavigate();
  return useMemo(() => {
    const openNodeById = async (nodeId: string, block?: string | null, replace = false) => {
      try {
        const { node } = await appHttp.get<{
          node: {
            id: string;
            kind: "lecture" | "document" | "term" | "course" | "section" | "folder";
          };
        }>(`/nodes/${nodeId}`);
        const href = nodeHref(node);
        navigate(block && href.startsWith("/doc/") ? `${href}?block=${block}` : href, { replace });
      } catch {
        navigate(`/library/${nodeId}`, { replace });
      }
    };
    return {
      onOpenConcept: (conceptId: string) => navigate(`/concepts/${conceptId}`),
      onOpenIndex: () => navigate("/concepts"),
      onOpenDocument: async (target: {
        documentId?: string;
        nodeId?: string | null;
        blockId?: string | null;
      }) => {
        let nodeId = target.nodeId ?? null;
        if (!nodeId && target.documentId) {
          try {
            nodeId = (
              await appHttp.get<{ document: { nodeId: string } }>(`/documents/${target.documentId}`)
            ).document.nodeId;
          } catch {
            nodeId = null;
          }
        }
        if (nodeId) await openNodeById(nodeId, target.blockId);
        else navigate("/library");
      },
      onOpenQuestion: async (target: {
        questionId: string;
        nodeId?: string | null;
        replace?: boolean;
      }) => {
        let nodeId = target.nodeId ?? null;
        if (!nodeId) {
          try {
            nodeId =
              (
                await appHttp.get<{ question: { nodeIds: string[] } }>(
                  `/practice/questions/${target.questionId}`,
                )
              ).question.nodeIds[0] ?? null;
          } catch {
            nodeId = null;
          }
        }
        if (nodeId) await openNodeById(nodeId, null, target.replace);
        else navigate("/practice", { replace: target.replace });
      },
    };
  }, [navigate]);
}
