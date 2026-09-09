"use client";

import { PublicRouteError } from "@/components/PublicRouteError";

/** See `components/PublicRouteError.tsx` for the full reasoning — issue
 * #106 finding 8. Before this, /esign had no React error boundary of its
 * own at all: a double-click could commit a signature and then show
 * Next's bare crash screen instead of anything telling the signer it
 * actually went through. */
export default function EsignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicRouteError error={error} reset={reset} />;
}
