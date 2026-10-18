### The state tells us who is doing certified payroll this week, and now the app reads it (Cyrus)
`cyrus/dir-pull`

Cold outreach lives on one question: is this firm doing prevailing-wage
work right now, and on which job? California answers it in public — DIR's
portal lists every registered project, every subcontractor on it, and every
electronic certified payroll filed — but publishes no bulk file, and the
pages are JavaScript. Established 2026-10-13 by reading the portal's own
network calls: the search pages are ServiceNow widgets that answer a guest
session, 1,000 rows a page, with the reCAPTCHA enforced only in the browser.

`/sales/public-works` is the result. A sync (`lib/public-works/sync.ts`)
streams CSLB's free licence file for every CLEAR drywall, plaster, framing
and insulation firm, then pulls DIR's project↔subcontractor links (awarded
in the last 180 days) and eCPR filings (last 60 days, county by county,
windows halved when a query hits DIR's 6,500-row cap). Each firm's TIER —
in market this week, on the record, or nothing public — is derived from its
signals on every render and never stored, so it cannot disagree with them.
The "fact to open with" column is the sentence that opens the call: "filed
certified payroll 2026-10-07 on McAuliffe Modernization for Oxnard School
District (DIR eCPR list)".

Three new tables (`PublicWorksFirm`, `PublicWorksSignal`,
`PublicWorksSyncSlice`), additive, not company-scoped — these rows are about
OTHER firms and are read only by the operating company's owner, the same
gate as `/sales`. A signal carries DIR's own key as a unique column, so a
re-pull inserts nothing twice. The sync does one slice per call, stalest
first. Measured against the live portals on 2026-10-13, a slice takes
95–290 seconds (the CSLB file, DIR's 44-page link table, a big county in
halved windows), which no Vercel function survives — so the daily pull is a
GitHub Actions workflow (`public-works-sync.yml`, same secrets as
`migrate.yml`) with a 50-minute budget. `/api/public-works/sync` (bearer
`CRON_SECRET`, fails closed) and the page's button are for a nudge, and a
slice they cannot finish is harmless: writes are idempotent and the bookmark
is written only on completion, so the next run repeats the slice.

The check, run 2026-10-13 against ep-icy-hat and the live portals with
`pnpm --filter web public-works:sync`: six rounds pulled 6,699 firms with
owners, 43,769 project links (482 to our firms), and the first nine
counties' filings — 2,454 signals, 13 slices bookmarked. Then on
`/sales/public-works` the Alameda rows read tier 1 with 2026-10 filing
dates and real awarding bodies. Run the workflow by hand once (Actions →
Public works sync → Run workflow) and the counts on the page climb.
