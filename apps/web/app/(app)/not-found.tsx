import Link from "next/link";

/**
 * What the app shows for a record that doesn't exist.
 *
 * Distinct from error.tsx, and the distinction matters. A job page calls
 * notFound() when the id doesn't resolve — that is not a failure, and it
 * must not carry error.tsx's "don't submit again before reloading" warning,
 * because nothing was being submitted. Browser testing found the stock Next
 * 404 here precisely because error.tsx never sees a notFound().
 *
 * Most often this is a deleted record or a stale link, so it says that
 * rather than implying something broke.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
        <h1 className="text-lg font-semibold text-slate-100">Not found</h1>
        <p className="mt-2 text-sm text-slate-400">
          This page doesn&apos;t exist, or the record it points at was deleted. If you followed a
          link from somewhere else, that link is probably out of date.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Back to jobs
          </Link>
          <Link
            href="/catalog"
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Line item catalog
          </Link>
        </div>
      </div>
    </div>
  );
}
