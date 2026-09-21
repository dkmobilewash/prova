"use client";

import { PageLoadError } from "@/components/PageLoadError";

/**
 * The boundary ABOVE the `(app)` layout — the one that was missing.
 *
 * Next.js renders a segment's `error.tsx` INSIDE that segment's
 * `layout.tsx`, so `app/(app)/error.tsx` catches a failing page and never
 * a failing `app/(app)/layout.tsx`. That layout is the first server code a
 * signed-in person runs: `requireCompanyContext()`, the Company row, the
 * financials, the alert count, the Money Rail. When any of it throws, the
 * only boundary that can catch it is one in the PARENT segment — this file.
 *
 * Until 2026-09-21 there was none, and a brand-new owner's first screen
 * was Next's stock "Application error … Digest: 446730191". This file
 * renders the same `PageLoadError` the in-shell boundary does, so the
 * preview paragraph telling a tester to run the Migrate demo database
 * workflow — the exact advice for that morning's cause — now reaches the
 * one screen it was needed on.
 *
 * It also covers every route outside `(app)` that has no boundary of its
 * own: `/welcome` (the onboarding questions, deliberately outside the
 * shell), `/pilot`, sign-in and sign-up. `/portal` and `/esign` keep their
 * own, nearer boundaries and are unaffected.
 *
 * What it cannot catch: a failure in `app/layout.tsx` itself — that is
 * `app/global-error.tsx`'s job. `lib/errorBoundaryCoverage.test.ts` walks
 * `app/` and fails the build if any layout or page is left uncovered.
 */
export default function RootSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageLoadError error={error} reset={reset} />;
}
