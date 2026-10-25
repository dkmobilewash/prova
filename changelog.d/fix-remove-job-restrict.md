### An estimate somebody took off and priced can be removed again, and evidence still says why it can't (Cyrus)
`fix/remove-job-restrict`

Reported 19 Oct by a user walk on main: Overview -> Remove -> "Remove it" on
an estimate with an uploaded takeoff plan threw `TakeoffPlan_jobId_fkey`, and
with the plan deleted by hand, `JobBidRecap_jobId_fkey` — both redacted in
production to "This page didn't load". So any job somebody had measured or
priced could never be removed.

The cause was a hand-written list. `deleteEstimateJob` knew 19 kinds of
history and deleted only line items; derived from the migration SQL, Job has
50 RESTRICT children, and 33 were in neither half. The takeoff (plan, items,
wall runs), the bid recap, the proposal clause text, assignments, crew days
and the per-job counters are the estimate's own working papers and now go
with it in one transaction (`JOB_DRAFT_CHILDREN`). Sixteen evidence records
the list never named — lien deadlines and waivers, T&M tickets, backcharges,
DocuSign envelopes, WH-347s, warranty and closeout records, among others —
plus sent messages and costs recorded against the line items, now refuse with
a sentence naming them, as RFIs and invoices always did.

The check: `lib/jobRemoval.test.ts` derives every foreign key onto Job from
the migrations (count-asserted against the literal SQL) and fails unless each
one that can refuse a delete is in exactly one list. `jobDetails.dbtest.ts`
removes a fully taken-off estimate against a real Postgres — red with the
original `TakeoffPlan_jobId_fkey` before the fix, green after; dropping
`jobBidRecap` from the list turns both red. An unlisted table now produces a
readable refusal and a rolled-back transaction, not a digest.
