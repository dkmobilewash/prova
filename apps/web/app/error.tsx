"use client";

/**
 * The boundary for everything OUTSIDE the signed-in app — /portal/[token],
 * /esign/[token], and the marketing root.
 *
 * There was one at `app/(app)/error.tsx` and nowhere else, so the only
 * pages in this product with no login had no boundary at all: a failure on
 * either of them fell through to Next's default screen, which in production
 * says a server-side exception occurred and gives a digest. That is the
 * worst possible audience for that screen. The reader is a general
 * contractor the sub is trying to look competent in front of, they have no
 * account to check anything with, and on /esign the action that just failed
 * may have already recorded a legal signature.
 *
 * SO THIS SAYS THE OPPOSITE OF "TRY AGAIN" ON THE THING THAT MATTERS. The
 * app-side boundary already carries this reasoning: a write can commit and
 * the render still fail, so "it broke" does not mean "it didn't save", and
 * re-submitting is how you get two of something. Here the something is a
 * signature on a contract.
 *
 * Deliberately NOT the app boundary's copy. That one offers "Back to jobs"
 * and, on previews, an explanation about migrations and the Actions tab —
 * both meaningless to someone who has never seen this software before and
 * has no GitHub account. No internal vocabulary reaches this page.
 *
 * The digest is still shown, because it is the only handle the contractor
 * can quote when the GC phones to say the link is broken.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-5">
        <h1 className="text-lg font-semibold text-rose-200">This page didn&apos;t load</h1>
        <p className="mt-2 text-sm text-rose-100/90">
          Something went wrong on our side while loading this page. Nothing you did caused it.
        </p>
        <p className="mt-3 text-sm font-medium text-rose-100">
          If you had just signed or submitted something, don&apos;t do it again yet. Reload this
          page first and check whether it went through — the page failing does not mean your
          signature didn&apos;t record.
        </p>
        <p className="mt-3 text-sm text-rose-100/90">
          If it still doesn&apos;t load, contact whoever sent you this link and ask them to send a
          fresh one.
        </p>

        <div className="mt-5">
          <button
            onClick={reset}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
          >
            Reload this page
          </button>
        </div>

        {error.digest && (
          <p className="mt-5 text-xs text-rose-200/70">
            If you report this, include reference <code className="font-mono">{error.digest}</code>.
          </p>
        )}
      </div>
    </div>
  );
}
