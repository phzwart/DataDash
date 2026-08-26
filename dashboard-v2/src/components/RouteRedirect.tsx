import { Navigate } from "react-router";

/** Hidden route target: redirect legacy bookmarks to new paths. */
export default function RouteRedirect({ to }: { to: string }) {
  return <Navigate to={to} replace />;
}
