### The clerkId race was already handled. The invite race next to it was not (Diego)
`diego/invite-race-p2025`

**No schema change, no migration.** One condition, one helper, two tests.

**READ THE CORRECTION BEFORE THE FIX, because it is worth more.** The
`User_clerkId_key` violations in the CI Postgres logs — twelve in one run,
three backends on one key inside twelve milliseconds, raised in
`#prova-build` three times as the "green-while-broken" shape — **are not a
bug. They are the recovery working.**

`adoptCompanyContext` already catches a unique-constraint collision and
re-reads what the winner created, under clerkId and then under email.
`isUniqueConstraintError` duck-types `err.code === "P2002"` rather than
using the `instanceof` that CLAUDE.md records as dead under Next's bundling,
so the guard is LIVE. `auth.raceRecovery.test.ts` has pinned all three arms
since it was written. So the sequence is: three requests miss, three insert,
one wins, two collide, two recover, nobody sees a failure. Postgres logs the
violation because a violation genuinely happened; Prisma logs it for the
same reason. **No test failed because nothing was broken** — which is a
different sentence from "a test should have failed", and the two have been
confused for a week.

Nested `company: { create }` rolls back with its parent, so the losing
inserts leave no orphan Company either. The cost of the herd is two wasted
INSERTs per concurrent burst and two lines of log noise. That is worth
knowing and not worth restructuring security-critical adoption logic for.

**WHAT WAS ACTUALLY BROKEN IS THE ARM THE CATCH DESCRIBED IN WORDS AND
COULD NOT REACH.** The invite path runs

```ts
prisma.$transaction([invite.delete({ where: { id } }), prisma.user.create({ … })])
```

and the DELETE goes first. `Invite.email` is `@unique`, so an invite belongs
to exactly one address — which makes a concurrent consumption **the same
person in two tabs**, not two people. The loser's delete hits a row the
winner has already consumed, and that is **P2025, not P2002**. The guard
admitted only P2002, so the error escaped and a recoverable double-click
left as a 500.

Three lines above that guard, its own comment says *"or someone else
consuming the same invite first."* The case was named and unhandled — this
repo's most repeated shape, and the second instance of it this week.

**The fix** is `isMissingRecordError` (P2025) beside its P2002 sibling in
`shared.ts`, and one `||` in the catch.

**Widening the entry condition is safe because the recovery is
EVIDENCE-BASED, not blanket.** It returns only if a re-read actually finds a
row and rethrows the original error untouched otherwise — so a P2025 with
nothing behind it still escapes exactly as before. That is not an argument,
it is mutation M3 below.

**Mutation-tested three ways:**

| | mutation | result |
| --- | --- | --- |
| ctl | nothing | green |
| **M1** | the fix reverted — guard blind to P2025 | **RED on the new test ONLY**; the other four still pass |
| M2 | helper checks the wrong Prisma code | RED, same test |
| **M3** | helper returns `true` for everything | **green — and that is the right answer** |

M1 is the proof the new test catches the real defect without dragging the
existing ones along. **M3 is the proof of the safety argument**: even with
the guard admitting every error, the control still escapes, because the
recovery needs evidence before it returns.

**Not claimed:** that the log noise goes away. It will not, and it should
not — the herd is real and the recovery is what handles it. Anyone reading
`User_clerkId_key` in a CI log after this should read it as the system
working, and go look at the invite arm only if they see an actual 500.
