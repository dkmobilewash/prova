### Two money defects on the document the GC actually reads (Cyrus)
`cyrus/retainage-one-formula`

Diego's lane, taken deliberately under the working agreement's live-money
exception; he was pinged before the push. The diff is kept to these two
defects so it is quick to review.

**Retainage was computed two different ways and they disagreed.**
`lib/billing/create-invoice.ts` said `(Number(amount) * (pct / 100)).toFixed(2)`.
`lib/actions/billing.ts` said `((amount * Number(pct)) / 100).toFixed(2)`.
Both IEEE-754, and they do not associate the same way. Bill $1,000.35 at 10%
as a lump-sum invoice and the snapshot is **$100.04**; bill the identical
figure as a pay application and it is **$100.03**. Across every cent from
$1,000 to $100,000 at 10%, **3.21%** of amounts came out different.
`Invoice.retainageWithheld` is snapshotted at creation and never recomputed,
so the wrong cent is permanent on a document already sent.

**Neither expression was the right one.** Measured against exact decimal
over 1.9M amounts, the lump-sum one was wrong 37,893 times and the
pay-application one 91,200 — two bad paths that happened to disagree, not a
good one and a bad one. There is now one implementation,
`lib/billing/retainage-amount.ts`, doing exact integer arithmetic with the
rounding rule **half-up** written down and argued: half-up is what a GC's
accounting and QuickBooks use, so half-even would make our snapshot
disagree with the certificate on the other side of the table for exactly the
amounts a person notices. It is also what already-stored snapshots were
computed with, so correct rows stay correct.

**Why not decimal.js, which was the obvious answer.** `@prisma/client` is
not a dependency of `apps/web` and does not resolve from it; the only route
to `Decimal` is `import { Prisma } from "@prova/db"`, and **119 test files
in that package mock that module with `{ prisma }` alone**. Ten of them
broke the moment the new module imported it — none of them about
retainage — and every future mock would break the same way. So the module
imports nothing and parses decimal strings into `bigint`. This is not the
`Math.round(x * 100)` cent math used elsewhere here: no float is ever
constructed. The test's oracle IS real decimal.js (a test file sits on no
mocked import path), so two unrelated implementations are checked against
each other across ~120,000 swept values.

**A pay application printed a NEGATIVE "less previous certificates for
payment".** `assemblePayApplication` treated any lower-numbered invoice as
an earlier one. `previousBilled` is summed from earlier invoices' LINE
ITEMS, which a lump-sum bill has none of; `previousRetainageWithheld` was
summed from their SNAPSHOTS, which a lump-sum bill does have. So the two
halves of the G702 came from different populations. Bill $10,000 lump sum at
10%, then submit a pay application: line 7 printed **-$1,000.00**, retainage
to date was inflated by the same $1,000, and balance to finish with it.
Reproduced before anything was changed.

**Be accurate about the size of it, because the obvious reading overstates
it.** `currentPaymentDue` cancels the term algebraically, so **the amount
asked for was right the whole time**. What was wrong is every line the GC
reconciles against their own ledger — and a negative on line 7 is what gets
the application handed back. There is a test asserting the requested amount
does NOT move, so a future "fix" that shifts it fails.

**What is correct on a G702, since this is a judgement and not a typo.**
Every figure on the form has to foot to the G703 behind it. A lump-sum bill
has no continuation-sheet row to appear in, so it belongs on both sides or
neither, never one. Giving it a synthetic row would claim scope against the
schedule of values that the SOV does not contain. So it is on neither, and
the certificate stays an exact statement about the SOV. Nothing is hidden —
the bill is still on the billing tab, in `/cash-flow` and in the retainage
figure. The reasoning is in the code, at length, because the next person
will meet this.

**The dead field is gone.** `PayAppSummaryInput.retainagePercent` was
supplied by every caller and read by nothing. That is the "written,
documented, never called" shape, in the version that costs money: a live
rate in reach of the function that computes retainage invites someone to
recompute a snapshot, which would restate every certificate ever sent the
day a job's rate changes.

**Why `retainage-single-source.test.ts` was green through all of this**, and
it is the part worth reading. It did not miss the two formulas. **Both files
were in its allowlist**, with notes saying in capitals "WRITES the
snapshot". Pattern right, scope right, nothing drifted. The QUESTION was
wrong: it asks "is any file naming this column undeclared", which is about
FILES, and nobody had asked "how does a declared file produce the value",
which is about EXPRESSIONS. Not the "matched nothing" scar and not the
"wrong scope" scar — a third one.

Three things were added, and each was mutation-tested:

- the declared writers are checked against a set **derived from the code**
  (who calls the formula), so it fails both ways;
- **no file in any workspace package** may use a retainage rate as an
  arithmetic operand, outside the one module — repo-wide, 1,273 files, not
  just the three known writers, because the likelier future is a fourth
  file nobody declared;
- the scan roots come from `pnpm-workspace.yaml` rather than three folder
  names typed by hand, which is the contrast-census scar answered before it
  arrives here.

**Nine mutations, all red, all restored.** Both original float expressions
restored as the formula (red on the sweeps); half-even for half-up (red on
the half-cent table, which is why that table asserts its own cases are
genuine halves); the number-only earlier-invoice filter (red on three G702
assertions); the unconditional this-period retainage (red); the second float
expression put back in `lib/actions/billing.ts` — the world exactly as it
shipped — (4 red); a brand-new undeclared file with a float formula (red); a
new undeclared file calling the shared formula (red); the scan narrowed back
to `apps/web` (red). One test caught a wrong expectation of mine on its
first run: $150.05 at 5% is $7.50, not the $7.51 I wrote by eye.

**No schema change, so no migration and no expand-then-contract window.**

**EXISTING DATA IS NOT TOUCHED, deliberately.** Some `retainageWithheld`
snapshots in production may be off by a cent. A migration that rewrites
money on a document a GC has already been sent is not an agent's call — see
the report for what is known and what is not.
