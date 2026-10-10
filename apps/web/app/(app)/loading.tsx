/**
 * What every signed-in page shows while it renders. Next wraps the page
 * (never this group's layout) in a Suspense boundary with this as the
 * fallback, so the sidebar, topbar and scroll port stay exactly where they
 * are and only the content column swaps to this.
 *
 * Shaped like the list pages most routes are — a title, a line of
 * explanation, a card of rows, in the same `max-w-4xl px-6 py-8` column —
 * so the page landing in its place moves as little as possible. One file
 * covers every route under (app); a route that renders something very
 * different can add its own loading.tsx beside its page.
 *
 * The pulse is `motion-safe:` only: under prefers-reduced-motion the
 * skeleton is still there, just still.
 */
export default function Loading() {
  return (
    <div role="status" className="mx-auto max-w-4xl px-6 py-8">
      <span className="sr-only">Loading page</span>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-3 h-6 w-48 rounded bg-surface" />
        <div className="mb-8 h-4 w-full max-w-md rounded bg-surface" />
        <div className="divide-y divide-line-row rounded-lg border border-line-card bg-surface">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-line-row" />
                <div className="h-3 w-1/3 rounded bg-line-row" />
              </div>
              <div className="h-4 w-16 shrink-0 rounded bg-line-row" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
