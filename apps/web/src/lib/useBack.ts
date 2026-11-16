import { useCallback } from "react";
import { useNavigate } from "react-router";

/** Go back in history when there is somewhere to go back to (so lists keep their state), else to a fallback. */
export function useBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate(fallback);
  }, [navigate, fallback]);
}
