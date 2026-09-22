import { redirect } from "next/navigation";

/**
 * Whether a signed-in person should be sent to the full-page onboarding
 * gate (`/welcome`) instead of wherever they asked to go.
 *
 * TRUE only for the account owner of a company that has NEVER been asked —
 * `businessScopeAskedAt === null`. Every company that existed before this
 * feature shipped is backfilled to a non-null value by migration
 * `20260921000000_backfill_business_scope_asked_at` (`COALESCE` onto
 * `createdAt` — a data-only, additive migration, no schema change), so
 * after that migration runs, null means "created after this shipped and
 * not yet asked" — genuinely new, never "an existing company that just
 * never got around to it." That is what makes "existing companies are
 * never redirected" true by construction rather than by a check that has
 * to remember to exempt them.
 *
 * A MEMBER is never gated, even on a company with no answers on record:
 * only the owner can answer (`saveBusinessScope`/`skipBusinessScopeQuestions`
 * both refuse a non-owner), and a page that only ever refuses a MEMBER is
 * the "door that will not open" shape this codebase avoids elsewhere
 * (`navItems.tsx`'s `OWNER_ONLY_FOOTER`).
 *
 * Pure — no request, no database — so the rule that matters most (an
 * existing company is never redirected) is unit-tested without a browser,
 * same shape as lib/permissions.ts and lib/businessScope.ts.
 */
export function shouldGateToOnboarding(subject: { role: string; businessScopeAskedAt: Date | null }): boolean {
  return subject.role === "OWNER" && subject.businessScopeAskedAt === null;
}

/**
 * The ONE call site that sends a person to `/welcome`: `app/(app)/dashboard
 * /page.tsx`, and nowhere else. `/dashboard` is the only page a fresh
 * signup or sign-in ever lands on by default — `ClerkProvider`'s
 * `signUpFallbackRedirectUrl`/`signInFallbackRedirectUrl` and both auth
 * pages' own `fallbackRedirectUrl` all say so — and Clerk's own
 * `redirect_url` mechanism takes precedence over the fallback whenever one
 * is present, which is exactly what carries a signed-out visitor who
 * followed a link straight to a job or an invoice past this page entirely.
 * So gating IN THIS ONE PLACE, rather than in the shared layout every route
 * renders through, is what keeps a deep link from ever being intercepted —
 * `lib/onboardingGateCensus.test.ts` fails the build if a second page
 * starts calling this.
 *
 * Called before any of the page's own data loading, so a redirect costs
 * nothing beyond the one `requireCompanyContext()` call already paid for.
 */
export function redirectToOnboardingIfUnasked(subject: { role: string; businessScopeAskedAt: Date | null }): void {
  if (shouldGateToOnboarding(subject)) {
    redirect("/welcome");
  }
}

/**
 * The inverse, called only from `app/welcome/page.tsx` itself: the moment
 * this stops being the right screen for this viewer — already answered,
 * already skipped, or never the owner to begin with — bounce straight back
 * to `/dashboard` rather than show the questions again.
 *
 * THIS IS WHAT KEEPS THE PAGE FROM EVER BECOMING A TRAP. A stale bookmark,
 * a browser's back-then-forward, or someone pasting the URL to a teammate
 * all land here with no reason to assume the visitor still qualifies — so
 * every load re-checks rather than trusting that reaching the URL was
 * proof enough.
 */
export function redirectAwayFromOnboardingIfAsked(subject: { role: string; businessScopeAskedAt: Date | null }): void {
  if (!shouldGateToOnboarding(subject)) {
    redirect("/dashboard");
  }
}
