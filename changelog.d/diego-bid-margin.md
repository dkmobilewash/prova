### A bid that does not cover its own cost now says so (Diego)
`diego/bid-margin`

The 2026-10-04 workflow audit, stage 7: *"no margin-threshold check … nothing
flags an unusually low or negative overall margin."* Cost-base integrity checks
existed — `uncategorised`, `pricedWithNoCost` — and nothing anywhere said a bid
was priced under what the work costs to build.

**The obvious implementation would have been unreachable code with a sentence
attached**, and that is the whole design. `bidRecap()` derives `bidTotal` as the
direct cost plus markup, escalation, tax, overhead, profit, bond and
contingency; `rate()` turns a missing percentage into 0 and
`nullablePercentFromForm` bounds a typed one to 0–100. Every step adds
`base × percent / 100` with a non-negative percent, so **`bidTotal >= direct.total`
always** and `(bidTotal − direct.total) / bidTotal` is the sum of the rates
restated — positive by construction. A warning on it could never fire once.

So the check is the **prices on the lines** against the costs on the lines:
what the schedule of values prints and what a GC is asked to pay. That goes
under cost in three real ways — a price typed by hand below cost, a recap never
applied, and lines added after Apply. `bid-margin.test.ts` pins the vacuity
argument as a test rather than a comment, because the "simplification" onto
`bidTotal` looks like removing a duplicate and would silently switch the warning
off. A comment does not fail a build.

**The false positive it was nearly shipped with.** A cost-only line — general
conditions, supervision, cleanup — carries real cost and deliberately gets no
price back; `spreadToLines` filters it out because *"general conditions are
recovered through the billable lines"*. Before Apply that recovery is not on the
lines yet, so the prices genuinely total less than the costs **on an estimate
that is correct and merely unfinished**. Found while exploring, not while
testing. So `costOnlyLineCount` rides along in every state and the sentence names
those lines when they exist. Diego chose "warn on under-cost only" precisely so
this could not cry wolf, and a warning that fires on correct work is the one
people learn to ignore — after which the real one is missed too.

**Four states, not a number.** `NO_PRICES` (nothing priced — not 0%, not
negative), `NO_COSTS` (a `$0` cost base is the honest ordinary state of a
wizard-built, AI-drafted or QuickBooks-sourced job, and `bid-recap.ts` says so
itself — a margin there would be a fiction), `UNDER_COST` with the shortfall in
money, and `COVERED` with its figure. Every state carries both contaminant
counts, because a margin stated without them is exactly the *"real-looking
number that will be remembered and repeated"* `bid-outcome.ts` refuses to
produce.

**Advisory, never blocking**, which is this repo's standing convention —
`lien-waiver.ts`'s *"refusing the save would make the app wrong about the world
and teach people to route around it"*, `bid-responsiveness.ts`'s refusal to
stage a compliant verdict, `addenda-overlap.ts`'s *"names, never concludes"*. A
sub may bid under cost on purpose to keep a crew together through a slow month.
The sentence names the money and does not say what to do, because three answers
are right and the app does not know which.

**On the recap panel it is a table row under the bid total, not a fourth
notice** — that panel already carries three and its own rule is that *"a
permanent notice is noise that teaches people to stop reading notices."* Only
the under-cost case adds a sentence, in rose rather than the amber the two
fixable problems use: a bid that does not cover the work is not a field somebody
forgot to fill in.

**On the proposal page it is `print:hidden`.** That page deliberately shows the
GC no cost figure at all, and its existing warning carries the reason — *"A note
on the PRINTED page would be telling a customer our prices may be wrong, which
is a different and much worse sentence."* A margin on a printed proposal would
hand a customer our cost base, which is worse still. No new query: the page
already reads every live line's cost to compute `addedTotal`, and has simply
never rendered one.

**It is a BID-TIME margin and the module says so.** `company-financials.ts`
(`HEALTHY_MARGIN_RATE`, `marginIsHealthy`), `wip.ts` and
`conceptual-estimate.ts` each already mean something by "margin" — all three
post-award, on actual cost. This is the only one about prices nobody has been
paid yet, which is why it is a separate function rather than a fourth caller of
one of those. Naming the other three in the header is what stops it being read
as a competing definition of the same thing.

Mutation-proved both ways, which matters for a warning: make it never fire —
**6 red**; make it always fire — **4 red**. A check that cannot do both is
pinning one half of itself.

564 test files, 8,777 unit tests, and the 63-file/632-test db suite run locally
against a throwaway Postgres.
