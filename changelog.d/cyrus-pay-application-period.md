### A pay application that says which period it covers (Cyrus)
`cyrus/pay-application-period`

A G702 states **PERIOD TO** at the top. It is the field a GC's accounting
department keys on, and this app did not have it. The pay application
printed `Invoice.issuedAt` instead — `@default(now())`, the moment somebody
clicked Submit — unlabelled, in the position a reader takes for the period.
An application covering August, prepared on 4 September, headlined
4 September. A construction manager reviewing the product called that a
rejected pay application and a 30-day delay on a job worth $400K-$2.4M.

`issuedAt` could not be quietly reinterpreted as the period, and an earlier
branch was right to refuse to try. It is the submission timestamp in three
places that matter: the 10-second duplicate-submission guard measures
against it, `findFirst` orders by it, and nothing ever sets it. So this adds
`Invoice.periodTo` — nullable, additive, migration
`20260916210000_add_invoice_period_to`.

**Entered, never stamped.** `submitPayApplication` refuses a blank or
malformed period with a sentence rather than defaulting one, because a
default computed on the server is a stamped date wearing an entered date's
clothes and this is the field a GC keys on. The form pre-fills the end of
last month — the usual convention — from `localToday()`, the USER'S calendar
date, and only in the collapsed form, which is mounted by a click. The
parser refuses anything that is not `YYYY-MM-DD`: `new Date("8/31/2026")`
parses as LOCAL midnight, which west of UTC stores the previous day.

**The report now shows both dates, each named** — Period to, and Application
date. They are genuinely different dates and the document showed only one of
them, with no label.

**An application submitted before the column existed reads "Not recorded".**
Deliberately not backfilled: nothing in those rows records what period they
covered, so `periodTo ?? issuedAt` would print a confident wrong PERIOD TO on
a document a GC keys off — which is the original defect, re-shipped. The
test for that is mutation-tested by reintroducing exactly that fallback; it
goes red.

The checks, all executed: six mutations, each red then restored — the
`issuedAt` fallback on display; a blank "Not recorded" label; dropping
`periodTo` from the insert; stamping `issuedAt` into the insert; parsing the
typed day in the running timezone; and defaulting a blank period to today.
`test` 3201 passed across 188 files, `typecheck` clean, `build` clean, `lint`
warnings only and none of them new.

`retainage-single-source.test.ts` caught the one thing that would otherwise
have slipped: the lifted insert names `retainageWithheld`, so it had to be
declared in that census with a reason rather than silently joining the set of
files that touch the column.

Not done, and said out loud: a plain lump-sum invoice (`createInvoice`) gets
no period. It is not a G702 and has no billing period to state. The
duplicate-submission guard still does NOT use the period as a natural key —
a GC rejects an application and the sub re-sends a corrected one for the same
period, which is routine, and refusing that would be a worse bug than the one
being prevented.
