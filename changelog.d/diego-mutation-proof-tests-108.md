### Nine of #108's ten mutants were already dead; the tenth was hiding behind a confounded fix (Diego)
`diego/mutation-proof-tests-108`

Issue #108 ("ten tests that cannot fail") turned out to already be fixed
for nine-tenths of it — `cyrus/fix-vacuous-tests` (#132, merged
2026-09-03) landed all eight of the issue's named findings, to the exact
standard the issue asked for: real value assertions in `export.test.ts`
instead of a key-name check, a real file in `db-env.test.ts` instead of an
empty list, isolated one-sided fixtures in `fringe-remittance.test.ts`,
independent cost/hours refusal cases in `catalog-import.test.ts`, an
asymmetric fixture with `dueSoon` asserted in `alerts.test.ts`, the real
guard called instead of re-implemented in `ask/tools.test.ts`, and the
memo/fallback value asserted in `quickbooks-sync.test.ts`. #132 just never
said `Closes #108` — it said `Addresses #108` — so GitHub never closed the
issue and it sat open for eight days looking unfixed.

Re-verified all eight by hand rather than trusting the diff: mutated each
described defect back into the current source, watched the current test
suite go red, reverted, watched it go green again. All eight hold. None of
the eight was ever a live production bug — `periodIsFiled` already used
`&&`, `parseCatalogImport` already guarded cost and hours, the QuickBooks
`Description` fallback already used `||` correctly, `byCompany` already
bound the real id. Every one of them was test blindness with correct code
underneath, now actually proven rather than assumed.

**The eight-vs-ten count, re-derived rather than inherited.** The issue's
own title says ten and its body names eight. #132's PR carried the same
unreconciled "ten" without saying why. Mutation-testing each bullet by
hand resolves it: `catalog-import.test.ts`'s bullet already killed *two*
independent mutants (the cost arm and the hours arm survive or die
separately, proven above) — that's nine. The tenth was in
`bid-pipeline.ts`'s `rankGcs`, one rung below the mutant #132 fixed.

#132's own fix for the `overdue` rule's confound ("the fixture also
differs on `outstanding`, which already produces the asserted order") was
real and correct. But the isolation test it added one rung down —
`"falls to outstanding only once overdue is equal"` — used two fixtures
that were *also* tied on `invited`, since every bid in them was live. So
deleting the `outstanding` comparison from `rankGcs` entirely and falling
straight through to the `invited` tie-break still passed the whole suite:
the exact same confound the issue was filed over, one level deeper,
introduced by the very test written to close the first one.

Confirmed by mutation, not asserted: deleted the `outstanding` branch from
`rankGcs`, ran `bid-pipeline.test.ts` — green, including the existing
"falls to outstanding" test. Added
`"falls to outstanding SPECIFICALLY, not to invited standing in for it"`,
which holds `invited` equal (3 vs 3: one GC with two decided bids and one
live, another with two live bids and one decided) while `outstanding`
differs (1 vs 2) — reran the same deletion, now red; reverted the source,
green again.

This is the one line of actual test code in this PR. Everything else was
already on `main`; this closes the mutant that was still standing behind
it. No source-code bug found anywhere in the ten — the count above is
ten distinct killed mutants, zero of them a live defect.

Filed as an audit under the working agreement's docs-only exception: it
records what #132 already fixed (so nobody re-derives it), corrects the
open-issue status that outlived the fix, and resolves the eight-vs-ten
discrepancy neither the issue nor #132 settled. The one test added rides
along because it is the one real gap the audit found — not a separate
capability, so it stays in this PR rather than waiting for one.
