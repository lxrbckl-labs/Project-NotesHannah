import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: api.me, retry: false, staleTime: 5 * 60_000 });
}

/** Sign out, forget everything cached for this person, and go to the sign-in screen. */
export function useSignOut() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return async (everywhere = false) => {
    try {
      await (everywhere ? api.logoutAll() : api.logout());
    } finally {
      client.clear();
      navigate("/login", { replace: true });
    }
  };
}
