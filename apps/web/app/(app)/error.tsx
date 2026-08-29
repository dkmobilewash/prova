"use client";

/**
 * What the app shows when a page fails to render.
 *
 * Without this there is no boundary anywhere in the app, so a failure falls
 * through to Next's default screen — which in production says only that a
 * server-side exception occurred. That is the wrong thing to show after
 * someone has just pressed Save, because it doesn't answer the only
 * question they have: did my work save?
 *
 * The honest answer is usually "we can't tell from here". A database
 * connection can drop *after* the write commits — the CHANGELOG records
 * exactly that — so the page failing does not mean the save failed. The
 * dangerous reading is the opposite one: assume it failed, do it again, and
 * end up with two records. So this says so explicitly and sends people to
 * reload rather than re-submit.
 */
export default function AppError({
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
          Something went wrong reading your data. This is a problem loading the page, not
          necessarily a problem with anything you just saved.
        </p>
        <p className="mt-3 text-sm font-medium text-rose-100">
          If you were saving something, don&apos;t submit it again yet — reload first and check
          whether it&apos;s there. Saving twice is how duplicates get made.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Back to jobs
          </a>
        </div>

        {/* Production redacts the message, but the digest is in the Vercel
            logs — quoting it is the difference between "it broke" and a
            report someone can actually trace. */}
        {error.digest && (
          <p className="mt-5 text-xs text-rose-200/70">
            If you report this, include reference <code className="font-mono">{error.digest}</code>.
          </p>
        )}
      </div>
    </div>
  );
}
