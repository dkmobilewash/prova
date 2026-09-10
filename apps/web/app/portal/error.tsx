"use client";

import { PublicRouteError } from "@/components/PublicRouteError";

/** See `components/PublicRouteError.tsx` for the full reasoning — issue
 * #106 finding 8. Before this, /portal had no React error boundary of
 * its own at all. */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicRouteError error={error} reset={reset} />;
}
