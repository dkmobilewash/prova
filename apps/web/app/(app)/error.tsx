"use client";

import { PageLoadError } from "@/components/PageLoadError";

/**
 * A page inside the signed-in shell failed to render. The sidebar and
 * topbar stay up around this; the copy is `components/PageLoadError.tsx`,
 * which also explains why the same screen is mounted at two more levels
 * (`app/error.tsx`, `app/global-error.tsx`) — this boundary cannot see a
 * failure in `app/(app)/layout.tsx` beside it, and for weeks that was the
 * one place a first-run failure could come from.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageLoadError error={error} reset={reset} />;
}
