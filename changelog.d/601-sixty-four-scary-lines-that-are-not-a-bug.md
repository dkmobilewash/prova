### The 64 `clerkId` errors in every green e2e log are a handled race, not a defect (Cyrus)

**DOCS-ONLY, under the audit exception** (working agreement rule 1): it records what an
investigation ELIMINATED, so the next person does not spend the hour.
`cyrus/sales-signals`

Every `e2e` run on this branch prints **64 lines** of

> `prisma:error … Unique constraint failed on the fields: (clerkId)`

from `[WebServer]`, interleaved with passing specs. I flagged this twice as an open item
for Diego, on the strength of the count and the word "error". **It is not a defect, and the
flag was wrong.**

`adoptCompanyContext` (`apps/web/lib/auth.ts`) creates a `User` row on a first sign-in. The
e2e suite runs specs in parallel against one signed-in persona, so the first requests race
and all but one lose on the unique `clerkId`. The loser is caught and **re-reads what the
winner created** — and the recovery is reachable rather than decorative, which is the part
worth checking rather than assuming:

- it keys on `isUniqueConstraintError(error) || isMissingRecordError(error)`, which test the
  Prisma error CODE. That is deliberate: the same file records that an earlier version read
  `error instanceof Prisma.PrismaClientKnownRequestError`, **false at runtime under Next's
  bundling**, so the whole recovery was unreachable and a concurrent first sign-in 500'd;
- the recovery is evidence-based — it returns only if a re-read actually finds a row, and
  rethrows the original error untouched otherwise;
- `auth.raceRecovery.test.ts` pins all three arms, including that a P2025 with nothing
  behind it still escapes.

**And it demonstrably fires in those runs**, which the code alone does not prove: every spec
running alongside those 64 lines passes, `expectHealthy` asserts no error boundary on each
navigation, and the suite reports `verdicts: collected 102, returned 102` with the only two
failures being the known #510 hydration assertions. A failed recovery would 500 the page and
fail the spec.

So the line is Prisma's client-level log of a constraint violation the application then
handles by design. **Nothing to fix, and nothing for Diego.** The reason to write it down is
that a count of 64 beside the word `error` in an otherwise green log is exactly the shape
that gets re-investigated — this is the third time it has been noticed on this branch, and
the first time anyone read the catch block.

Worth keeping as a general note: a logged error is not a failed request. The question is
always whether something catches it, whether that catch is REACHABLE, and whether anything
proves it ran.
