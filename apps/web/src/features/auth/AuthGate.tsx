import { Navigate, Outlet, useLocation } from "react-router";
import { ErrorState, Skeleton } from "../../components/ui/states";
import { isApiError } from "../../lib/api";
import { useMe } from "./useAuth";

/** Everything but the sign-in screen needs a signed-in person. */
export function AuthGate() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div role="status" aria-label="Loading" className="grid min-h-dvh place-items-center">
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }
  if (me.isError) {
    if (isApiError(me.error) && me.error.code === "unauthenticated") {
      const next = location.pathname + location.search;
      const to =
        next === "/" || next === "/library" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
      return <Navigate to={to} replace />;
    }
    return (
      <div className="mx-auto max-w-md p-6 pt-24">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  return <Outlet />;
}
