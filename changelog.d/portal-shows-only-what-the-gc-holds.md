### The GC portal was showing bids we hadn't won, and our own overhead lines (Cyrus)
`cyrus/seed-counters-zzbqtu`

Found while a seven-agent sweep of the whole UI was looking for something
else. Three live disclosures on the one surface a general contractor ever
sees, all verified in the code rather than taken from a report.

**One — jobs at ESTIMATE status were listed, with a running total.** The
portal's job query had no status filter at all: `contact.jobs` with only an
`orderBy`, and `money(total)` rendered beside every row. `enablePortalAccess`
mints **one token per contact, permanently**, so a link turned on for a live
job in March is still open when a bid for the same GC is entered in
September. And ESTIMATE is the one state where the number *moves* —
`assertEditableDirectly` permits direct line-item edits only there — so a GC
who reloaded watched the pencil sharpen and learned the floor.

Filtered on `status: { not: "ESTIMATE" }` rather than a rule of its own,
because the way out of ESTIMATE is already the guarded transition:
`markJobContracted` refuses without line items **and** evidence of an
executed contract. "Not an estimate" therefore already means "this GC signed
something, or we hold their executed subcontract" — the same evidence the
rest of the client-facing surface leans on, rather than a second definition
free to drift from it.

**The per-job read got the same filter, and that is not belt-and-braces.**
Closing only the index removes the link and leaves the page — and estimates
*were* listed until now, so a GC who opened their portal last week has the
URL of a bid in progress in their browser history. A job id is a cuid and
unguessable; a visited URL needs no guessing. Nothing legitimate is lost:
signing happens at `/esign/<token>`, and no proposal flow routes through the
portal (checked, not assumed).

**Two — cost-only budget lines printed on the GC's contract.** The line-item
read had no price filter, and `ContractSummary` renders every row with `"—"`
where the price goes. `jobs.prisma` says what a null `unitPrice` is: *"a
cost-only budget line (general conditions, overhead, contingency) has no
client-facing sale price."* So "General conditions", "Overhead" and
"Contingency" — plus whatever the estimator typed after them — were itemised
rows on the document a GC reads as the contract.

Two harms, and the second is the one nobody would predict. It publishes how
this company structures a bid. And **`"—"` in a price column reads as
free**, which invites "you're not charging for that, so do it."

The total cannot move, and that is checked rather than asserted:
`ContractSummary` sums `unitPrice != null ? … : 0`, so these lines already
contributed zero. This removes rows, never money. Printing them on the sub's
own proposal stays exactly as it was and is right — a proposal is chosen and
sent; this page renders whenever somebody opens a link.

**Three — a credential over-fetched, and this one is LATENT rather than
live.** `company: true` for `name` alone fetched the whole row, including
`intakeEmailToken`, which company.prisma calls *"the unguessable half of this
company's inbound intake address… The token IS the routing"* and says to
regenerate if it leaks. Anyone holding it can inject documents into the
company's intake tray.

**It was not disclosed, and the first write-up of this said so too loosely.**
Diego's review narrowed it correctly: both portal pages are pure server
components, nothing hands `company` or `contact` to a client component, and
only `company.name` is ever read — so the token never reached the browser or
the RSC payload. Calling it "in the page's props" reads as *it is in the
browser*, and would send the next person hunting a payload it is not in.

Closed anyway, for the shape rather than the severity: the next person to add
one client component taking `contact` or `company` wholesale turns it into a
real disclosure with no visible change at the call site. The same `include`
pulled `ChangeOrderLineItemEdit` (the before-and-after pricing of every
approved change), the full contact row, and four unused fields on every
payment.

**Four — two formulas for contract value, agreeing by coercion.** Found by
Diego's review while checking the second finding. The index reduced
`Number(item.quantity) * Number(item.unitPrice)` with no null test while
`ContractSummary` checks explicitly; they matched only because `Number(null)`
is 0. That is a coercion standing in for a rule, in the one place a GC sees a
total, and in the copy that did not document it. Both selects now exclude
those rows so neither total depends on the coercion, and the reduce states
the rule out loud.

**The fix is a module, not three `where` clauses, and that is the point.**
`lib/portal-query.ts` now holds both loaders and every clause in them.
`lib/job-media-query.ts` already made this argument for the photo half and
made it well — the boundary belongs in "the module the page imports", so
widening it is a visible deliberate edit rather than a forgetful one. The
contract half simply never got the same treatment.

It also makes the claims **testable**, which matters more. A Server Component
cannot be called from a test; a loader can. `portal-query.dbtest.ts` runs
them against a real Postgres, because every claim here is a claim about a
`where` clause and a pure test structurally cannot see one.

**The last case in that file is the one that will catch the next
regression.** Three of them assert behaviour a reviewer could also spot in a
diff. The fourth reads the KEYS that came back — because the defect this
module was written after was not a wrong filter, it was a whole row fetched
for one field, and no behavioural test can notice that. Neither can a type:
widening a `select` widens the derived type with it and everything still
compiles. Only counting the keys does.

The selects are module constants and the exported types are derived from them
with `GetPayload`, so the type and the query cannot drift — adding a field to
the type without adding it to the select is not expressible.

**One thing improved on the way past.** `contactId` is now part of the
`where` instead of a `job.contactId !== contact.id` check after the fetch.
Same answer, smaller window: a row that is not this contact's never leaves
the database, so there is nothing in memory for a later edit to render by
accident.

**And a guard caught me mid-change, which is the system working.**
`retainage-single-source.test.ts` went red the moment the module named
`retainageWithheld`, because it holds a literal roll-call of every file that
reads that column. Registered with its reason. Worth noting separately that
`gc-surface-tokens.dbtest.ts`'s header still says *"CI has no database"* —
true when written, and `ci.yml` has had a `dbtest` job with a `postgres:16`
service since.

**Not verified here:** no Postgres exists in an agent container, so the
dbtest has not been executed — CI's `dbtest` job is where it is either proved
or not. Typecheck, lint, build and the full unit suite are clean (8,321
passing; the 7 `xlsx` failures are the container's blocked `cdn.sheetjs.com`
tarball, identical on `main`).
