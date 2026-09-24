### main is red because `seed-demo.mjs` does not parse (Diego)
`diego/seed-demo-syntax`

One line. `#460` added a `del("jobProposalClause", …)` block and `#467` added
`del("wallRun", …)`; when both were on `main`, the first block's closing `);`
was gone and the second was spliced into its argument list:

```js
await del("jobProposalClause", () =>
  prisma.jobProposalClause.deleteMany({ where: { jobId: { in: jobIds } } }),
await del("wallRun", () =>            // <- the `);` belongs here
```

`node --check` on the file: `SyntaxError: missing ) after argument list`. The
script does not parse, so `seed-demo` and `seed-demo --undo` both fail
outright — which is what turned `dbtest` red, and it also means demo seeding
was broken for anybody who reached for it.

**The part worth keeping is what did NOT catch it.** `apps/web`'s unit suite
is 449 files and 7,114 tests, and every one of them passes with this file
syntactically invalid, because nothing in that suite imports it — only the
`dbtest` job ever executes it. A file can be unparseable on `main` while the
test count reads green.

So the red arrived in two layers tonight, from the same three-merges-in-ninety
-seconds window (#437, #471, #460, then #467). The first was FEATURE-AUDIT's
arithmetic, which `lib/plumbing.test.ts` caught and named precisely. The
second was this, which nothing caught until a job that needs a real Postgres
tried to run the file.

Checked while here, and both are fine, so nobody re-checks them: `wallRun` and
`jobProposalClause` are in `del(...)` in both cleanup scripts and in
`HANDLED_MODELS`. `WallType` is deliberately in neither — it is company-scoped
rather than per-job, and `scratch-scope.mjs` says so in place, the same call
`SafetyCaseCounter` gets in CLAUDE.md. `scratch-cleanup-order.test.ts` is 14
green.
