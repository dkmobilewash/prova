"use client";

import { PublicRouteError } from "@/components/PublicRouteError";

/** The public routes' shared boundary — see `components/PublicRouteError.tsx`. */
export default function UnsubscribeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicRouteError error={error} reset={reset} />;
}
