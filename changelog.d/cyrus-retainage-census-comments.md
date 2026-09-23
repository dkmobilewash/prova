### A census stops charging people for documenting the column it protects (Cyrus)
`cyrus/retainage-census-comments`

`retainage-single-source.test.ts` enumerates every file that reads
`Invoice.retainageWithheld`, and demands each one be declared with a reason.
It scanned **raw source**. A bare-token match on raw source cannot tell a
query from a sentence, so a file that merely MENTIONED the column in a
comment was counted as a file that reads it, and the census demanded it be
enrolled in the allowlist.

**On 2026-09-21 that cost three people time in one afternoon,
independently, none of them aware of the others.** A comment added to
`components/landing/PayApplicationPanel.tsx`, explaining why a field had
been removed, turned the suite red with no code change whatsoever — on a
hotfix that was unblocking a red `main`. The agent on #434 hit the
identical thing and reworded rather than edit another lane's census. #431
hit the neighbouring version of it in `hoursRenderCensus`. All three
responded the same way: **they reworded prose to get past a grep.**

That is the failure worth naming, and it is not the census being too
strict. The column is genuinely dangerous — it is snapshotted at creation
onto a document the GC has already been sent, and #97 was two live
formulas disagreeing by a cent. Strictness is correct. But a guard that
taxes people for DOCUMENTING the thing it protects trains them to stop
documenting it, and every expensive bug in this repo's scar list is
"a sentence nobody wrote down". A comment cannot produce a duplicate
query. Only code can. So the scan now reads code.

The fix was already sitting in the same file: `withoutComments()`, 130
lines below the scan that needed it, used correctly by the arithmetic
assertions and nowhere else. It has moved to the top, next to the pattern,
with the reasoning written at the scan site so this is not re-derived a
fourth time.

**Three allowlist entries dropped out, and that is a finding rather than
an obstacle.** `lib/retainage.ts`, `lib/pay-application.ts` and
`lib/billing/retainage-amount.ts` stopped matching the moment comments were
stripped, because **not one of them had ever contained a code occurrence of
the column.** Every hit was a doc comment — and the notes they carried in
the allowlist said so in their own words: *"documentation only, no query"*,
*"names the column in its header"*. The list had been carrying three
phantoms, each enumerated as a file that reads a column it does not read.
`retainage-amount.ts` is the one that looks alarming to drop and is not: it
is THE FORMULA, its guard was never this list, and it is still pinned by
`it("is defined in exactly one file")`.

The distinction the list now draws is the right one: naming the column in a
**type field** is code and stays enumerated (`cash-flow.ts` and
`gc-reliability.ts` declare it as an input so the AR balance can be net of
it). Naming it in a **sentence** is not.

**The same file had the hazard pointed the other way too, and nothing had
noticed.** #185 is the scar where a census was disarmed by a comment
quoting its own pattern. Four assertions here were POSITIVE — "this file
must contain `loadRetainageHeld`", "must contain
`retainageWithheld: invoice.retainageWithheld`" — and read raw source, so a
comment quoting the literal would satisfy them in a file where the wiring
had gone. Those read stripped source now, for the opposite reason to the
scan. And `company-financials-query.ts`'s "does not name the column **at
all**" is now "not in code": "at all" was forbidding the single most useful
comment anyone could write in that file — *"the column is deliberately not
read here; ask loadRetainageHeld"* — in the one place a reader most needs
to find it.

**Mutation-tested, and the middle two are what stop this being a
weakening.** A fix proving only "the comment no longer trips it" has not
shown the guard still guards.

| mutation | result |
| --- | --- |
| comment naming the column, undeclared file (the real incident) | **green** |
| real CODE read, undeclared file | **red**, names the file |
| raw-source scan restored, comment present | **red** — the fix is load-bearing |
| genuine reader removed from the list | **red**, names the file |
| stripper made a no-op | **red** |
| stripper made to eat code | **red** |

The last two matter because a stripper that ate code would empty every scan
below it and pass everything — the scratch-cleanup scar exactly. Three
assertions now pin the stripper itself.

**The `//`-inside-a-string hazard was checked, not reasoned about.** A naive
`//` strip eats the rest of any line whose `//` sits in a string or regex,
which here could hide a real read. Of the nine lines across 1,351 files
containing both the column and a comment opener, every one has only
whitespace before the delimiter — all genuine comments, so the case does
not exist today. The fix does not rest on that staying true: the helper
adopted this repo's house form, `(^|[^:])`, which refuses to read the `//`
of a `https://` as a comment. Eight sibling censuses already spell it that
way; this file had a bespoke variant without the guard.

**The sibling censuses were surveyed, one verdict each, rather than one
rule applied to all twelve.** Nine already strip comments and are right to.
`import-mapping.census.test.ts` compares imported VALUES and never reads
source — immune by construction, which is the strongest form.
`exportCompletenessCensus.test.ts` parses `.prisma` and is immune by
anchoring: `/^model\s+(\w+)\s*\{/gm` cannot match a line starting `//`, and
the one schema comment containing the word "model" was checked against both
of its parses.

**`onboardingGateCensus.test.ts` has the identical defect and is filed
separately.** Reproduced, not argued: a comment reading *"we deliberately do
not call `redirectToOnboardingIfUnasked()` on this page"* added to a job tab
makes the census report that the page DOES call it. It is not fixed here
because its cross-check is an independent `git grep`, which also sees
comments — so both halves agree while sharing a blind spot, and fixing it
properly means restructuring a cross-check that is otherwise good. That is
a change worth making on purpose, not as a rider on this one.
