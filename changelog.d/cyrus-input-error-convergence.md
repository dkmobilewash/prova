### What actually changed, in plain English (Cyrus)
`cyrus/input-error-convergence`

Saving a licence on `/settings` whose jurisdiction or status is a value the
picker did not offer — a stale tab, a restored form, a dispatched submit —
produced a blank screen with a reference number. It now says which field is
wrong, under the form. That is the only user-visible change in this PR; the
rest is what stops the class of bug behind it coming back.

**This branch opened before #414 and was rebased onto it. #414 took the
headline.** The bug this started from was `2,800` in a quantity: the shared
decimal parsers threw a bare `Error`, which production redacts. #414 fixed
that far better than this branch was going to — one parser in
`lib/numeric-input.ts`, tolerant of `2,800`, `$12,500.00` and a spreadsheet's
non-breaking space, strict about `12,50`. The two-line change here was
DROPPED on the rebase rather than re-applied: re-applying it would have been
a second convention in the very file this PR exists to make have one.

**Sixteen files held a private `class InputError`. None of them was broken.**
The number is the misleading part and the correction is the useful part. Of
the fifteen modules outside `shared.ts`, exactly one (`changeOrders.ts`)
called a shared parser at all — and it had already worked around the whole
problem by hand, with local `decimal()` / `nullableDecimal()` wrappers that
caught the bare `Error` and rethrew it as its own class. The other fourteen
were traps waiting for the first person to reach for `enumFromForm`.

All sixteen now import the one class and the one boundary.
`changeOrders.ts`'s workaround is deleted. `unionCompliance.ts` had the
identical arrangement under the name `SetupError` and converged with them —
no grep for `InputError` would ever have found it.

**The cost of the private class arrived while this branch was open, which
beats the hypothetical it was argued from.** #414 wired
`unionCompliance.ts`'s numeric parsing to the shared `numericReaders`, and to
keep the private catch working it had to hand that shared helper a callback
throwing the PRIVATE class. That is a second convention growing a second
branch rather than the first one being removed. With one class the callback
needs no such thought.

**The live bugs were never in those sixteen files, and #414 proved it.**
Counting files that declare the class finds the traps. Counting BOUNDARIES
finds the bugs. The defect is an action that declares `Promise<ActionResult>`
— a promise its refusals are legible — and calls a throwing parser with no
boundary, so the rejection escapes and is redacted. None of those actions
declares a local class, so the grep that found the sixteen could not see them.

When this branch opened there were four. **#414 fixed two of them
(`billing.ts::logPayment`, `jobs.ts::addCostEntry`) without touching a single
one of the sixteen files** — the sharpest available demonstration that the two
counts measure different things. The remaining two are `compliance.ts`'s
`createCompanyLicense` and `updateCompanyLicense`, fixed here. Run against
`origin/main` today the rule reports exactly those two; after this PR, none.

**The guard: `lib/actionErrorBoundaryCensus.test.ts`.** Three rules — one
`InputError` class; no file converting an error by testing a class it declared
itself; no action promising a legible refusal while calling a throwing parser
outside a boundary. Scope from `git ls-files` over the whole repository, every
derived set size-asserted against a count reached a different way, and a
header stating what it reasons about and what it therefore cannot catch.

**Three ways it was wrong before it was right — all found rather than
anticipated, and all the same shape: a set the check failed to build, then
asserted over confidently.**

1. **It could not see itself.** `git ls-files` lists TRACKED files, so while
   the census was being written it was absent from its own scan — and its
   closing assertion that `shared.ts` still declares the class reads, to its
   own rule, as a second declaration. One declaration locally, two in CI, on
   identical content. The set grew by one file at `git add` time, a moment no
   local run observes. Fixed by anchoring a declaration to a statement start,
   plus a test that the census is in its own scan.
2. **Its list of throwing parsers fell from seven to two under #414.** The
   derivation looked for a literal `throw new InputError` in each parser body.
   #414 moved the raise into a callback, so `decimalFromForm` became one line
   with no `throw` in it. The roll-call assertion is what went red — before
   rule C could report a clean repo over a set five parsers short. It follows
   the callback now.
3. **Rule B skipped the one file it was written for.** Its precondition was
   "does this file call a shared parser", and `unionCompliance.ts` calls none:
   it raises the shared class through its own `numericReaders` callback.
   Restoring that module's private class and private catch left the rule
   GREEN. Found by mutation, not by reading. The precondition is now "can a
   shared `InputError` reach this file at all", with two arms — calling a
   parser, or importing the class. `lib/field-reports-core.ts` stays correctly
   unflagged: its own vocabulary, no shared throw.

**The two known-unconverted actions are gone from the ratchet, and the ratchet
is how.** It held `logPayment` and `addCostEntry`; #414 fixed both; the test
went red on the rebase because two listed names no longer offended. An
exclusion list that is only ever added to becomes the permanent state of the
repo, and a stale entry is a claim with an expiry date. The list stays, empty,
as the place the next one goes.

Twelve mutations, twelve red. Two first reported GREEN and both readings were
false: one had never applied, and one had applied and was exposing the rule B
gap above. Every mutation asserts its anchor was found before its result is
read, which is the only reason the second was believed rather than dismissed.

No schema change, no migration, and no refusal anywhere changed its wording.
