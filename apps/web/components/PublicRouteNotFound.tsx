/**
 * What a GC sees when a portal or signing link doesn't open anything.
 *
 * Before this, nothing — `app/(app)/not-found.tsx` is scoped to the signed-in
 * route group, and neither `/portal` nor `/esign` had a `not-found.tsx` of
 * their own, so every `notFound()` on those routes fell through to Next's
 * built-in 404: a bare, unbranded developer page. That page is the whole of
 * what an outside company sees at that moment. The same argument as
 * `PublicRouteError` (issue #106 finding 8), one route segment over.
 *
 * WHY IT IS NOT A COPY OF `(app)/not-found.tsx`. The audience has no account
 * here. The app's version offers "Back to jobs" and "Line item catalog",
 * which for a GC are two links into a product they cannot sign into — worse
 * than no link, because it turns a dead link into a dead end with a login
 * wall behind it. There is deliberately no link on this page at all. The way
 * out is a person: whoever sent the link.
 *
 * WHY THE COPY IS VAGUE ON PURPOSE, AND WHY THAT MUST NOT BE "IMPROVED".
 * `/portal/[token]`, `/portal/[token]/jobs/[jobId]` and `/esign/[token]` all
 * 404 identically for a token that never existed, a token that was revoked,
 * a contact set INACTIVE, an expired signature request, and a job belonging
 * to somebody else — see those files' own comments. That is the privacy
 * property: whoever holds a dead link is not told whether it ever worked, or
 * whose it was. A friendlier page saying "this link has expired" or "this
 * link was revoked" would hand that fact back and undo all three guards at
 * once, from a file none of them mention. So this page names both
 * possibilities and commits to neither, and it never names a company, a job
 * or a contact — it has no way to know any of them, and must not learn.
 */
export function PublicRouteNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="rounded-lg border border-line-card bg-surface p-5">
        <h1 className="text-lg font-semibold text-ink">This link doesn&apos;t open anything</h1>
        <p className="mt-2 text-sm text-ink-body">
          The address may have changed since it was sent to you, or it may have been typed or
          copied incompletely. Either way there is nothing here to show you.
        </p>
        <p className="mt-3 text-sm text-ink-body">
          Ask the person who sent it for a current link. They can send a new one; nothing you
          did caused this, and nothing has been lost.
        </p>
      </div>
    </main>
  );
}
