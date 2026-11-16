import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { ToastProvider } from "../components/ui/toast";
import { meKey } from "../features/auth/useAuth";
import { isApiError, onUnauthenticated } from "../lib/api";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => isApiError(error) && error.code === "network" && count < 2,
      },
    },
  });
}

/** When any call says the session ended, re-check who is signed in; the gate sends them to sign in. */
function SessionWatcher() {
  const client = useQueryClient();
  useEffect(
    () => onUnauthenticated(() => void client.invalidateQueries({ queryKey: meKey })),
    [client],
  );
  return null;
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [own] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client ?? own}>
      <ToastProvider>
        <SessionWatcher />
        {children}
      </ToastProvider>
    </QueryClientProvider>
  );
}
