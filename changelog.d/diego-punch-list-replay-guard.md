### What actually changed, in plain English (Diego)
`diego/punch-list-replay-guard`

The phone's punch-list replay guard was dead code, and it was mine.

`POST /api/v1/jobs/[id]/punch-list` catches the case where two queued
writes carrying the same key collide on the unique index and reads the
winner back, so a repeated offline write is a repeat rather than a 500.
It tested for `error instanceof Prisma.PrismaClientKnownRequestError &&
error.code === "P2002"`. Under Next's bundling the thrown error's class
and the re-exported `Prisma` namespace are different copies, so that
`instanceof` is false at runtime — the branch never runs and the raw
error escapes. This repo has paid for exactly this three times before
(#25, #26, and `lib/auth.ts`'s concurrent-first-sign-in recovery), which
is why `isUniqueConstraintError` exists in `lib/actions/shared.ts`. Found
by Cyrus in review, flagged rather than folded into an unrelated PR.

**Why the test beside it could not see it.** `punch-list-api.dbtest.ts`
runs the same race against a real Postgres and passes: it imports the
route directly, where the two copies of the class are the same one. So
the new test throws the error the way production delivers it — a plain
object carrying `.code` — and mocks `Prisma` with a *different* copy of
the class, so restoring the old guard fails the way production failed
rather than on a missing symbol. Mutation-tested both ways.

And the shape now fails the build instead of being found by eye a fourth
time: `lib/prisma-error-guards.test.ts` walks every non-test source file
in `apps/web` and rejects that `instanceof` outside a comment, asserting
the size of its own walk so an empty scan cannot pass silently.
