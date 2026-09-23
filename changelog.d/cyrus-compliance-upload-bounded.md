### The compliance upload stops spending outside the allowance (Cyrus)
`cyrus/compliance-upload-bounded`

`uploadComplianceDocument` sent a whole document to the model on every
click — the most expensive single call in this app, $2.25-$4.50 by our own
audit — and it was not page-counted, not metered against anything, and not
capped. #465 shipped a hard monthly allowance for the Ask box and this path
sat entirely outside it, which on a product sold at a fixed $399/month is
the clearest way there is to lose money per customer. The gap was flagged
in #465's own "what is still open"; this closes it.

It closes it by REUSING that PR rather than building beside it. There is no
second ledger, no second page counter and no second cap: the pages come from
`lib/ask/pageCount.ts` (page trees including compressed object streams, and
the flat-10 rule for a PDF whose tree cannot be read), and the claim goes
through `claimAskAllowance` against the same `AskAllowancePeriod` row the Ask
box claims against. That is the property worth having and it is a test, not a
claim: upload a 40-page document and `allowanceSummary` — the function
`/settings/assistant` itself calls — reports 260 pages left, and the next Ask
question is claimed against the same row. One allowance, two surfaces.

**Counted, then claimed, then sent** — in that order, which is the whole of
it. Every money bug in this area is the same shape: the spend happens and
then the accounting is attempted. The pages come out of the bytes the store
served, never out of anything the browser said, so the cost is known before
the model is called; a refused claim means `extractComplianceDocument` is
never reached and nothing is written. A claim whose call then fails is
MARKED, not released — a unit you can get back by making calls fail is not a
cap — and the person is told where the pages went instead of getting a
digest.

**A ceiling on one document: 100 pages, a third of the month, derived from
the allowance rather than typed beside it.** Every compliance document this
product actually receives is tens of pages at most, so it refuses nothing
real; what it stops is one wrong file — a scanned drawing set filed as a COI
— eating a customer's whole month in a single click. A plan that changes the
allowance moves the ceiling with it, and that is pinned by a test.

**It is gated now, and it was not.** The endpoint asserted nothing beyond
"you are signed in", with `/compliance` refusing at the page and the action
answering whoever posted to it — a counted debt in
`action-capability-guards.test.ts` since that file was written. Any member
of any job function could spend the company's month from a phone. It asserts
MANAGE_COMPLIANCE now, before the URL is looked at and before a byte moves,
and the upload TOKEN mirrors it so a refused person never even transfers the
file. Nobody loses a screen they use today: an owner holds every capability,
and PAYROLL_COMPLIANCE and EXECUTIVE are who `/compliance` was always for.
The debt line is deleted and the refusal is now EXECUTED by that suite as
every job function that lacks it, with the control proving the ones that
hold it still get through.

**It fails CLOSED, and the distinction is kept visible.** The hourly and
daily limits in `lib/ask/usage.ts` still let a question through when they
cannot read themselves (#257 — the worst case there is our own bill). This
spends a ceiling somebody has PAID for, so when the check cannot run the
document is refused and nothing is sent. Proved against a real Postgres with
the table genuinely renamed away, not a mocked rejection, with the recovery
case beside it so the suite cannot pass by refusing everything.

**And the person is finally told what a document cost.** `pageCount.ts` has
always promised that an unreadable PDF charged the flat ten "is TOLD, on
screen, that it was charged that and why" — nothing told them, and
`pageChargeNote` had no caller anywhere in the app. The form now renders it
beside the pages left in the month.

Mutation-tested three ways, each restored green: charging one unit per
document regardless of pages goes red in 4 unit tests and 3 database tests
(`{ pages: 1 }` where the file has 23); claiming after the call instead of
before goes red in 5 and 2, the ordering assertion reading
`['fetch','model','claim','row']` where it wants
`['fetch','claim','model','row']`; making this path fail open goes red on
"an unreadable cap must not spend".

No schema change and no migration — the ledger already existed. No Stripe,
no plans, no prepaid packs, and the caps themselves are untouched.
