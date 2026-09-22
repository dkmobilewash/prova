### Seven pages stopped loading in the browser, and the server log said nothing (Cyrus)
`cyrus/diagnose-500s`

A pilot tester opening **Punch lists**, **Settings**, **Import**,
**Integrations**, **Team**, **Catalog** or a job's **Estimate** tab got
"This page didn't load" and nothing else. Reported as "two routes are
500ing on main". It was seven routes, and it was not a 500.

**The server was rendering those pages perfectly.** The HTML arrived. Then
the browser evaluated the page's own JavaScript bundle, which contained
`PrismaClient` — the database client, which throws the instant it is
evaluated anywhere but the server: *"PrismaClient is unable to run in this
browser environment."* React caught that, and the error boundary replaced
the finished page with the "didn't load" card. So there was nothing in the
server log to find, because nothing went wrong on the server. Anybody
grepping application code for a bad database read, or checking the schema
for a missing column, was looking in a place the fault could never be.

**Two ordinary constants put it there.** `RESPONSIBLE_PARTIES` — the six
labels in the punch-item "who caused it" dropdown — lived in
`lib/delays-core.ts`, which also queries the database. `TRADE_SCOPES` —
the five trade names — lived in `lib/actions/shared.ts`, same story. A
component that runs in the browser imported one label array, and the
bundler correctly brought the whole file along, database client and all.
Neither component ever mentioned Prisma; on `PunchItemFields.tsx` it was
four files down the import chain. No amount of reading either file would
have shown it.

Both constants now live in modules that import nothing from the database
(`lib/delay-options.ts`, and `lib/trade-scopes.ts`, which already existed).
The old modules re-export them, so every server caller — including the
Ask command in Diego's lane — is untouched.

**`lib/trade-scopes.ts` is the part worth reading.** Its docstring already
said, in so many words, *"deliberately its own module rather than living in
lib/actions/shared.ts: that file imports prisma, and this is rendered by
client components."* Somebody hit this exact hazard before, understood it,
wrote it down — and moved only the labels, leaving the value list behind in
the file they had just finished warning about. A correct explanation
sitting next to a half-applied fix reads, to the next person, exactly like a
finished one.

**The specific check.** `apps/web/lib/client-prisma-boundary.test.ts` walks
the transitive imports of every `"use client"` module and fails the build if
any of them reaches `@prova/db`. It is the mirror of the existing
`client-boundary.test.ts`, which guards the opposite direction. It has to be
a whole-graph walk rather than a grep, because no offending file named
Prisma.

It asserts two things about itself, both of which this repo has paid to
learn. Its **scope** comes from `tsconfig.json`'s `@/*` mapping — the same
source the compiler resolves `@/` with — so a census that has stopped being
able to see part of the app fails instead of finding nothing in a directory
it never walked. And its **machinery** is run against a synthetic graph
built to contain a violation, so a regex that has quietly stopped matching
goes red on that while the real app still looks clean. Absence of a failure
is not a pass.

Three separate proofs, none of them a green check:

- **Mutation.** With the fix reverted, the census names 10 client modules
  and prints both import chains; the two self-checks stay green, so the
  failure is the real assertion and not the instrument.
- **The bundler itself.** A production `next build` before the fix emits one
  client chunk containing the string "PrismaClient is unable to run in this
  browser environment" — `2129-6e3761a5fc74ace2.js`, **the same chunk hash
  named in the browser stack trace from the failing run**, so this is the
  same defect and not a lookalike. `app-build-manifest.json` lists the seven
  routes that load it. After the fix: **0 of 163 client chunks** carry it.
- **The database was eliminated first, not assumed innocent.** Every query
  both pages run was executed against a scratch Postgres with every
  committed migration applied: all fourteen succeeded. `PunchListItem` has
  no trigger of any kind, and no dropped column is read anywhere.

**One stale comment removed while in there.** `lib/actions/punchLists.ts`
said `isDone` and `completedAt` "are NOT written here — a trigger derives
them". Those columns were dropped by `20260920030000_punch_item_verification`
and there is no such trigger; `information_schema.triggers` on a
freshly-migrated database lists none for that table. A comment describing
machinery that no longer exists is the thing this project keeps paying for,
so it says what is actually true now.
