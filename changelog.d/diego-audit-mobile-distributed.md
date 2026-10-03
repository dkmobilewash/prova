### Three audit claims that stopped being true, and the evidence for each (Diego)
`diego/audit-mobile-distributed`

**DOCS-ONLY.** No code. Shipped alone under the audit exception the working
agreement grants, which exists for exactly this: documentation being dragged
back to reality after it has drifted, with no accompanying change for it to
ride along with. `FEATURE-AUDIT.md` says of itself that it has drifted more
than once and not to let it.

**1. The mobile app row said it was Partial for two reasons and gave them by
name** — "no TestFlight build exists" and "it has not been clicked through on
a device end-to-end", adding "those are the flips to Built". Both are false.
Builds 7 through 12 are in TestFlight (build 12 is commit `88ff819a`,
accepted by App Store Connect), and build 11 was driven end-to-end on a
physical iPhone through iPhone Mirroring on 2026-10-02 — Home, Jobs, a job
hub, the punch list, creating a punch item and moving it OPEN →
READY_FOR_REVIEW, and the new job-progress band tracking that change. The
row is Built on its own stated terms.

What the clicking found is kept rather than quietly dropped, because it is
the honest remainder: the phone can create a punch item and cannot delete
one (#592), a punch row's chevron toggles status instead of navigating
(#593), and the field tier has still not been walked as a FIELD user.

**2. The field-tier row carried the same stale half** — "the app is not yet
distributed" — alongside a true one. It now says the one thing that is
still true, and says why the 2026-10-02 walk is not evidence for it: that
walk was as the OWNER, which is the principal this row is not about.

**3. FIVE alert rows were waiting on "the two environment variables and one
observed run". The variables are set.** `NOTIFY_BASE_URL` and `CRON_SECRET`
both exist on the Vercel production environment, created 2026-09-28 —
verified by listing the project's variables, not assumed. `CRON_SECRET`
carries its own note that it was set through the API because a clipboard
copy kept adding a trailing newline, which Vercel rejects as whitespace in
a header value.

**The run is still unconfirmed, and this entry refuses to claim otherwise.**
Runtime logs cannot settle it: Pro retention is one day, and a count grouped
by request path over the last 24 hours returned a single line, for `/`. An
instrument that sees one request in a day is not a control, and absence in
it is not evidence that a daily cron did not fire — the same rule this repo
has written down after being caught by it twice. The remaining check is
`NotificationDispatch` rows or Vercel's own cron history.

**What this does NOT do:** flip any row's verdict. Every one of these rows
was written by somebody who had a reason, and three of those reasons have
expired while a fourth has not. Changing Partial to Built is a judgement
for whoever owns the sheet, made with a true row in front of them rather
than a stale one.
