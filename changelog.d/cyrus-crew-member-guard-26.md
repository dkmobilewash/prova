### Re-assigning a crew member already on the job is a no-op again, not a 500 (Cyrus)
`cyrus/crew-member-guard-26` — issue #26, reviving stranded commit `98329c8`

`assignCrewMember`'s duplicate-assignment guard read `!(error instanceof
Prisma.PrismaClientKnownRequestError && error.code === "P2002")` —
inverted, and built on an `instanceof` that measurement shows is FALSE at
runtime under Next's bundling (`isUniqueConstraintError`'s own doc comment
in `lib/actions/shared.ts` has the measurement). So re-assigning a teammate
already on a job's crew rethrew a raw Prisma error and 500'd the job page,
instead of the no-op the code's own comment already said it should be. The
logic was always right; only the class test was wrong.

This exact fix was written once already, 2026-09-05, in commit `98329c8`
("Three guards that could not do what they appeared to do") on branch
`cyrus/legible-guard-refusals` — but that branch never got a PR and never
merged. A sibling fix from the same commit, the identical defect in
`inviteTeamMember` (issue #25), reached `main` by a different route
(`2154f5e`) and has been correct for weeks; `company.ts` was the reference
for what the fixed shape looks like here.

**Kept as a no-op, not converted to `ActionResult`.** `assignCrewMember`
throws for its other failure modes too (`"Job not found"`,
`"Team member not found"`) and isn't wired through a form that reads a
returned refusal — converting it to `ActionResult` means changing its
return type and every caller, which is a larger, separate change from
reviving a three-week-stranded one-line fix. A duplicate assignment isn't
a user-facing refusal anyway; it's exactly the no-op the original comment
already promised.

**A third instance of the same dead-guard shape, found while checking
`jobs.ts`'s neighbours for the pattern commit `98329c8` fixed.** That
commit's title says "three guards" (#166, #25, #26); #166 (the `assertOwner`
throw → `ownerRefusal` return-value refactor) landed separately too, via
`adbd050` (#237). But the commit body also flags a FOURTH, unticketed
instance it found along the way, in `lib/auth.ts`'s
`adoptCompanyContext` — the concurrent-first-sign-in recovery — "in
neither issue". That one was never fixed on `main` until this PR: same
`instanceof` shape, same fix (`isUniqueConstraintError`, narrowed to P2002
specifically rather than admitting any Prisma error, exactly as `98329c8`
argued). Two tabs racing a first sign-in, or two people consuming the same
invite at once, got a raw 500 instead of the row the winner had already
created.

**The check.** `jobs.assignCrewMember.test.ts`: assigns cleanly, re-assigns
as a no-op (no throw, no duplicate row, mocked with a P2002-shaped error —
`.code`, not a class, matching how the error actually arrives), and a
non-P2002 failure still escapes. `auth.raceRecovery.test.ts`: same three
shapes for `adoptCompanyContext`, with the winner's row seeded only at the
moment the mocked `user.create` throws — not before — so the test can't
short-circuit through `adoptCompanyContext`'s own early `findUnique` and
pass vacuously regardless of the guard (the same trap CLAUDE.md's #61
watcher entry documents). Both suites mutation-tested: restoring each
original inverted/dead guard turns the new tests red, restoring the fix
turns them green again.

`auth.test.ts` already mocks `Prisma.PrismaClientKnownRequestError` as a
real class, which is why a Vitest test against the *original* `instanceof`
guard would have passed with the bug fully present (Node resolves
`@prisma/client` once, so `instanceof` is true under Vitest and false only
under Next's bundling — the same reason `98329c8` verified this against a
real scratch Postgres rather than trusting a mocked class). Both new files
mock `Prisma` as `{}` instead, so a test written against the broken guard
cannot pass by accident.
