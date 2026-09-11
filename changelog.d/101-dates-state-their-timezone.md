### Every rendered date says which zone it is in — #101 (Diego)
`claude/prova-vercel-direct-url-hg1acx`

Nineteen date renders called `toLocaleDateString` with no `timeZone`, which
formats in whatever zone the JavaScript happens to be running in. That is
two different bugs wearing one line of code, and which one you got depended
only on where the component ran.

**In a client component it is live and wrong.** The zone is the reader's
own, so a UTC-midnight column renders a day early for all of North America.
`components/ComplianceDocumentRow.tsx` showed a certificate's expiry, and
`components/PayApplications.tsx` a pay application's issue date, one day
behind what was stored.

**In a server component it is right for a reason nobody chose.** Vercel runs
UTC, so the same bare call happened to be correct — and nothing in this repo
pins `TZ`. No `vercel.json`, no `next.config` setting. One environment
variable or one differently-configured host moves nine dates at once, on
invoices, dispatch slips, time entries and retainage forecasts, with no
error anywhere.

Issue #101 asked for one shared formatter rather than nine edits, and the
reason is in the repo's own history: this exact bug had already been fixed
twice, in `components/fieldReportWeeks.ts` and
`components/equipmentDeployment.ts`. Both fixes are still there, still
correct, and neither stopped the next one — a fix at a call site protects
that call site and nothing else.

So `lib/render-date.ts` has two functions and the choice between them is the
whole point. `formatCalendarDate` is for a plain calendar day, written at
UTC midnight by a `<input type="date">`; "due the 15th" means the fifteenth
wherever you stand, so it renders in UTC and the reader's zone is not a
factor. `formatInstant` is for a real moment with `@default(now())`, where
UTC is its own day-early bug pointing the other way — a payment recorded at
18:00 in Los Angeles is already tomorrow in UTC — so it takes the reader's
zone from `viewerTimeZone()`. Prisma spells both `DateTime` and has no
opinion, which is why the distinction had to be made somewhere a reader
could see it. Sixteen call sites converted, ten calendar days and six
instants, classified one at a time from how each column is written rather
than from its name.

`lib/dateRenderCensus.test.ts` is what makes it hold. Every
`toLocaleDateString` and every `new Intl.DateTimeFormat` in the app must
state a zone, and there is no allowlist — the rule is total, which it could
only be because the four `Intl.DateTimeFormat` sites already passed one.

Two things the census does that the cheap version of it would not. It
resolves an options object held in a variable — `fieldReportWeeks` shares
one `opts` between two calls, which is correct code a text search cannot see
into — and a declaration it cannot find is a FAILURE, not a pass, because
"assume an identifier is fine" turns one unreadable argument into a hole
anyone can drive a bare call through. And it strips comments with a scanner
rather than two regexes, because `//[^\n]*` deletes the second half of every
`"https://..."` in the file: mutation M8 puts a bare call after a same-line
URL and the regex version reports clean while the scanner catches it.

Eight mutations, each one run: a reverted call site and a reverted
multi-line one (both caught), the match pattern broken so it finds nothing
(caught by the size cross-check, which counts the method names as plain text
a second way and requires the two to agree), an `opts` with its `timeZone`
removed (caught), an `opts` that cannot be resolved (fails closed), a bare
call quoted inside a comment (stays green — no false positive), and the URL
pair above.

One thing here is a comparison rather than a render, and it is the one a
person would have noticed. `expirationStatus` measured a UTC-midnight column
against `Date.now()` — a calendar day against an instant — and floored the
gap. **A certificate expiring TODAY therefore read "Expired" in red all day,
in every timezone**, because from 00:00 UTC onward the gap is already
negative and floors to minus one. This was first written up here as an
evening-west-of-UTC edge case; that was too generous. It is not conditional
on where you are or what time it is, and a COI is normally good through the
end of its last day.

The same page said both things at once. `renewalUrgency`, which feeds the
renewal alerts above the list, documents the opposite rule in its own
comment — "a date expiring TODAY counts as due, not expired ... telling
someone their still-valid COI has already lapsed is the kind of wrong that
makes people stop believing the warning" — so the banner said due and the
row underneath it said expired, about the same certificate. Both sides are calendar days now,
compared with `daysUntil` from `lib/compliance-expiry.ts` — the same
function the renewal alerts on that page already use, and the page now
computes its `today` once and hands it down, so the rows and the alerts
above them cannot give two answers for the same fact.

`formatSignedDate` (#106 finding 7) is a `formatInstant` in every respect,
so it is one now, with a test asserting the delegation changed no output
across three zones — that is the date a signature dispute turns on.

Preflight: 123 files, 2111 tests, no migration.
