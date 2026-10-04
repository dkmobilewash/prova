### A week of hours in the fixture, so the next check does not need production (Diego)
`diego/e2e-seed-payroll`

No migration, no product change. Test fixture, one spec, one CLAUDE.md entry.

**VERIFYING #596's FIGURES COST AN EVENING AND A PRODUCTION DOWNLOAD, AND IT
SHOULD NOT HAVE.** `payroll-export.spec.ts` could prove the route, the
content type, the filename, the header order and the 403 refusal. It could
not prove **one number in the file**, because `seedDatabase.ts` created a
company, a contact and a job and nothing else — no crew, no classifications,
no time entries. That is not a weak spec; it is the boundary of what an empty
database can be asked.

The seed now carries a fixed week: a union local, a craft classification, a
fringe rate in force, and **one employee in TWO classifications** — the
smallest shape that catches all three mistakes the export exists to prevent.

| mutation | result |
| --- | --- |
| control | green |
| an unknown wage written as `0` | **RED** |
| per diem repeated on every classification row | **RED** |
| the seed writes no rows at all | **RED** — "the seed did not land" |

**THE FIRST VERSION OF THAT THIRD MUTATION WAS A FALSE RED and is worth more
than the other two.** It was `if (true) return;`, which does not compile
cleanly — the run died before Playwright started, and a build break reported
itself as a caught regression. The rewritten mutation (`createMany({ data: []
})`) compiles, lints, and fails on the size assertion by name. **A mutation
has to be checked for having RUN, not merely for being red** — the same rule
this file already applies to green.

**Two things this branch broke on the way, both mine, both worth recording.**

`seedDatabase.test.ts` mocks Prisma model-by-model, so adding models to the
seed made four unrelated tests fail on `undefined.findFirst`. The new models
are stubbed there with a comment saying why they are stubbed rather than
asserted: that file is about the onboarding-gate shape of the seeded users,
and a stub that does not exist fails every test for a reason that has nothing
to do with what it tests.

And the figures test first looked for an **empty** Classification on the
untagged row. It is labelled **"No craft tag"** (`certified-payroll.ts:68`) —
exactly what production had shown hours earlier. The test was wrong about the
product, not the reverse, for the third time in one session.

**ESTABLISHED BY CONTROL, NOT BY ARGUMENT: a full LOCAL `pnpm test:e2e` run
fails ~21 specs with `Unique constraint failed on (clerkId)` from
`prisma.user.create()`, and it does so WITH THIS BRANCH REVERTED TOO.** It is
a concurrent sign-in race in the local parallel run, pre-existing and not
this change. CI runs the same suite without it. Recorded so the next person
who sees that wall of red locally does not spend the afternoon on their own
diff — reverting and re-running is a five-minute control and answers it.

559 files / 8700 tests, typecheck and lint clean; the three payroll specs
pass in isolation.
