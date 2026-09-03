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
 *
 * ON A PREVIEW IT SAYS ONE MORE THING, because there the likeliest cause is
 * not a bug at all.
 *
 * Migrations reach a database when a PR merges, so a branch that adds a
 * table or a column runs against a database that does not have it yet. That
 * surfaces as P2021 (`table does not exist`) or P2022 (`column does not
 * exist`) and renders as this screen — which reads as broken code and is
 * not. It has now cost three rounds of debugging on this project: the
 * Integrations page, and twice on Settings.
 *
 * The boundary cannot detect it. A production build redacts every thrown
 * Server Action message to a digest, so all this component ever receives is
 * an opaque string — a missing column and a dropped connection look
 * identical from here. But it does not need the code: on a preview, this
 * cause is common enough to be worth naming, and on production it is
 * impossible, because CI applies migrations on merge. So the hint is shown
 * by ENVIRONMENT rather than by error, which is a claim this file can
 * actually stand behind.
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

        {/* Named only on a preview, where it is the likeliest cause and the
            remedy is one button. On production this is impossible — CI
            applies migrations on merge — so saying it there would be noise
            pointing at the wrong thing. */}
        {process.env.NEXT_PUBLIC_DEPLOY_ENV === "preview" && (
          <div className="mt-5 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-medium text-amber-100">
              On a preview, this is usually the database, not the code.
            </p>
            <p className="mt-1 text-sm text-amber-100/80">
              A branch that adds a table or a column runs against a database that doesn&apos;t
              have it yet — migrations only land when the PR merges. Run the{" "}
              <span className="font-medium">Migrate demo database</span> workflow from THIS
              branch (Actions tab → Run workflow → pick this branch), then reload. If the page
              still fails after that, it is a real bug.
            </p>
          </div>
        )}

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
