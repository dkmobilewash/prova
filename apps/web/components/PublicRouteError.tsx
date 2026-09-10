"use client";

import { isStaleDeployError } from "@/lib/stale-deploy-error";

/**
 * The error boundary for /portal and /esign — issue #106 finding 8.
 *
 * Before this, an anonymous route had NO React error boundary at all.
 * #221 added `(app)/error.tsx` and a window-level net at the root layout
 * (`StaleDeployBanner`, which DOES cover every route including these two —
 * see its own comment) for errors that never reach React's render/commit
 * cycle in the first place. Neither of those is a boundary FOR this route
 * group: a failure that DOES happen during render here fell through to
 * Next's bare, unbranded "client-side exception" screen, on a page a GC
 * has no login to retry from and no dashboard to escape to.
 *
 * Deliberately its own component rather than a copy of `(app)/error.tsx`,
 * because the audience is different in a way that changes the copy, not
 * just the wrapper:
 *
 *   - no "Back to jobs" link — there is no dashboard this reader has
 *     access to, and sending a GC to a sign-in page they don't have an
 *     account for is worse than no link at all;
 *   - no mention of "Server Action", "digest", or the preview/demo-database
 *     hint aimed at whoever is debugging the app — a GC reading this isn't
 *     debugging the app, they're trying to see a contract or sign one;
 *   - the "don't resubmit" warning is still here, because it's the one
 *     sentence that actually matters to THIS reader: `/esign` commits a
 *     legal signature, and the double-click race this issue also fixes in
 *     `signRequest` is defense in depth, not a reason to remove the
 *     warning that stops the second click from happening at all.
 *
 * Reuses `isStaleDeployError` from `lib/stale-deploy-error.ts` for the
 * same reason `(app)/error.tsx` does: a stale JS chunk needs a real
 * reload, not React's `reset()`, which just re-renders the same failed
 * subtree and re-requests the exact same now-missing asset. Sharing the
 * predicate means these three boundaries can't drift into three different
 * ideas of what counts as "stale deploy" — if the detection ever needs to
 * change, it changes in one place for all of them.
 */
export function PublicRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleDeploy = isStaleDeployError(error);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-5">
        <h1 className="text-lg font-semibold text-rose-200">This page didn&apos;t load</h1>
        {staleDeploy ? (
          <p className="mt-2 text-sm text-rose-100/90">
            This page was updated while you had it open. Reloading will fix it.
          </p>
        ) : (
          <p className="mt-2 text-sm text-rose-100/90">
            Something went wrong loading this page. This is a problem showing the page, not
            necessarily a problem with anything you just did.
          </p>
        )}
        <p className="mt-3 text-sm font-medium text-rose-100">
          If you were signing or submitting something, don&apos;t do it again yet — reload first
          and check whether it went through.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          {staleDeploy ? (
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
            >
              Reload the page
            </button>
          ) : (
            <button
              onClick={reset}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
            >
              Try again
            </button>
          )}
        </div>

        {error.digest && (
          <p className="mt-5 text-xs text-rose-200/70">
            If you report this, include reference <code className="font-mono">{error.digest}</code>.
          </p>
        )}
      </div>
    </main>
  );
}
