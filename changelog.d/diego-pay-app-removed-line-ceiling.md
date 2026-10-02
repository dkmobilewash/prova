### A pay app could bill against scope the GC had already deducted (Diego)
`diego/pay-app-removed-line-ceiling`

**No schema, no migration.** Issue #567, raised by Cyrus's agent in the
billing lane. One query field, one shared function, two guards.

**What was wrong.** `submitPayApplication` checked the over-billing ceiling
against a scheduled value it computed itself:

```ts
scheduledValue: line ? Number(line.quantity) * Number(line.unitPrice ?? 0) : 0,
```

under a comment reading *"Same expression the job page and the report use
for a live line"* — and the qualifier was the defect. Its query selected no
`isDeleted`, so a removed line had no second branch and was measured against
its **pre-deduction** value. A $40,000 line with $10,000 billed, then removed
by an approved deductive change order, accepted another $25,000: money
claimed against scope the GC had already taken back, on the document they pay
against. `pay-application-query.ts` had closed exactly this hole on the READ
path (#98) and the write path kept its own copy.

**THE OBVIOUS FIX WAS WORSE THAN THE BUG, and that is the part worth
reading.** The issue's framing — two expressions for one money figure, make
them one — is right about the diagnosis and a trap on the remedy. The
canonical `scheduledValueFor(lineItem, floor)` returns `max(0, floor)` for a
removed line, and the render side's floor is total completed and stored to
date **including the period being entered**. But `payAppEntryError` compares
`totalCompletedAndStoredToDate` against `scheduledValue`, and that total *is*
the render side's floor. Share the function and its argument and the
comparison becomes `x > x` — false for every input. **A removed line would
have accepted any amount at all**, where the shipped bug at least capped at
the original value.

So the function is shared and the FLOOR is not: submit passes prior earnings
only (`previousBilled + previousMaterialsStored`), excluding the period being
submitted. That is also the right rule rather than merely the safe one — a
deductive change order takes back the unbilled remainder, so there is no
scope left to bill NEW work against, while work already performed and
certified stays billed. A downward correction still works, bounded
separately by the can't-un-bill-what-was-never-billed guard.

Diego's call, since it is a decision about what a deductive CO permits
rather than a mechanical fix.

**Two guards, and the mutation matrix is the argument for both.** The unit
test (`pay-application-submit-ceiling.test.ts`) is pure — the defect is
entirely in which NUMBER reaches `payAppEntryError`, and both halves are pure
functions, so it needs no database. The census
(`scheduledValueCensus.test.ts`) is the "is there a second one" kind: it asks
whether any site derives a `scheduledValue` from `quantity` without the
shared function, and whether any priced line-item read in `billing.ts`
neither selects nor filters `isDeleted`.

| mutation | census | unit test |
| --- | --- | --- |
| ctl nothing changed | green | green |
| M1 #567 reverted to a local copy | **RED** | green |
| M2 `isDeleted` dropped from the select | **RED** | green |
| M3 the form's `isDeleted` filter removed | **RED** | green |
| M4 shared fn stops checking `isDeleted` | green | **RED** |

**Neither guard alone is sufficient and the table proves it rather than
asserting it.** M1-M3 are invisible to the pure test, because a pure test
cannot see its own call site — the "written, documented, and never called"
shape, and a one-line revert to a local multiplication reads like a
simplification. M4 is invisible to the census, which checks structure and
not arithmetic.

**One site is still allowed to multiply directly, and its exception is
conditional.** The pay-app FORM (`jobs/[id]/(tabs)/billing/page.tsx`) holds
only live lines — its query filters `isDeleted: false` — so the raw
expression there IS the live branch. But that correctness lives in a `where`
clause sixty lines from the arithmetic, so the allowlist entry asserts the
filter as well as naming the file: M3 above is that assertion firing.

**Two things the census got wrong first, both caught by its own checks
rather than by reading it.** Its size floor counted sites that DERIVE a
scheduled value and demanded three — but after the fix only one does, since
the other two now call the shared function, so the floor was satisfied only
by the bug it was written to prevent. It now takes its size from a second
pattern that shares no sub-expression with the first and does not shrink as
sites adopt the function. And its query check anchored on "the
`jobLineItem.findMany`" in `billing.ts` and matched a different one two
hundred lines away; there are three, and it now checks every read that
fetches a price.
