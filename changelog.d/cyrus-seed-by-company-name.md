### What actually changed, in plain English (Cyrus)
`cyrus/seed-by-company-name`

The demo seed could only be pointed at a company by its id, and **nothing in
the app has ever shown anybody their company id** — not a screen, not the CSV
export (which leaves it out on purpose, because every file is already one
company's rows), and the only place it reaches the DOM is a Procore option
value that needs Procore connected. So the one input `seed-demo.yml` needed
was the one value its operator could not obtain, and the fallback made it
worse rather than better: with no id given the seed takes the OLDEST company,
and the company somebody actually wants to seed is the empty one their first
sign-in just created, which is the NEWEST row on the database. Cyrus signed in
to a preview as an address `ep-patient-lake` had never seen, got a brand new
empty "Cyrus's Company" from `requireCompanyContext`'s create branch, and had
no way to put data in it. A live run of the workflow on `main` confirmed the
shape exactly: the oldest company there is "My Company" and it already holds
the whole demo set, so the default answer was never going to be his.

So the workflow takes a **`company_name`** now — the value that is on the
screen while you type it. It matches on the whole name, case-insensitively,
with whitespace runs and typographic apostrophes folded (a name built from
what somebody typed into Clerk can carry a U+2019 that reads identically and
does not compare equal). It never matches a substring, and that boundary is
the design rather than laziness: every difference it does fold is two
spellings of one name, so the worst case of folding is a collision it reports
with both ids. A substring match has no such backstop — "Cyrus" matching
exactly one company called "Cyrus Drywall Inc" is indistinguishable from a
correct answer, and would seed the wrong company with every check green.

**It refuses in three places rather than guessing**, because `Company.name`
carries no unique constraint and "My Company" is exactly the kind of
auto-generated name that repeats. No match prints every company on the
database with its id, which is the recovery path. Two matches print both
candidates and stop. And giving both `company_id` and `company_name` is
refused outright, neither one quietly winning: the realistic way that happens
is a name typed into a form that still held an id from the previous run, so
"the id wins" means a stale id chooses the target while the log reads as
though the name had.

Each refusal points at the read-only `list-companies` operation, which arrived
on `cyrus/seed-counters-zzbqtu` while this was being written and rides in on the
same PR — a refusal that leaves the operator with nowhere to look is only half a
refusal, and there is nowhere else to look: no page in the app renders a company
id. A second listing was written here and then deleted rather than reconciled,
because that one had already been run against `ep-patient-lake` and this one had
not. Two implementations of one thing is worse than either.

**And running it proved the feature was not enough on its own.** Pointed at a
second company on a database that already held a demo set, the seed wrote the
jobs, the GC contacts, six crew, 49 time entries and eight equipment items and
then died on `Unique constraint failed on the fields: (providerMessageId)` —
CI run 36358650969. That is issue #180's shape: a company left holding a
PARTIAL set, and the reseed guard then refuses the retry because it counts
tagged rows per family and finds some. So "seed a company other than the oldest
one" was broken past the equipment stage on any database that had ever been
seeded before, and a name input that resolves correctly and then leaves a
half-seeded tenant behind is worse than no input at all.

The cause is one line and the reason nothing caught it is the interesting part.
`providerMessageId` was `demo-[demo]-<address>-<day>`, and that column is
`@unique` with NO company in the key — correctly, since it holds a provider's
own id. Every other tag this script writes is scoped by a `where: { companyId }`,
so this is the only value the DATABASE requires to be globally unique. Nobody
had ever run the seed against two companies on one database; the demo project
grew a second and a third the moment people began signing in to previews, so
the assumption stopped holding without a line of the script changing.

`apps/web/lib/seedGlobalUniqueScope.test.ts` is the part that lasts. The
intersection that found the bug — every single-field `@unique` in the schema
against every model the seed writes — was a one-off, and a one-off rots the day
somebody seeds a new model with a globally unique tag. It is now derived and
pinned: six pairs, five of them never written and one carrying `company.id`, and
a seventh appearing fails by name. Built to CLAUDE.md's three rules for a
deriving check, because all three failure modes are live here — both sets are
size-checked against plain string splits that share no regex with the patterns
that built them; the schema folder comes from `packages/db/package.json`'s own
`prisma.schema` rather than a hand-written list, and a folder that is not there
throws "NOTHING WAS SCANNED" instead of passing over an empty set; and comments
AND string-literal text are blanked length-preservingly first, which is not
decoration — the fix's own docblock names `providerMessageId` four times, so a
raw-text census answers about prose, and three `https://` URLs in the script
would otherwise open line comments that swallow the code after them. Preserving
length pays for itself twice: a failure quotes the real expression back from the
original source rather than the blanked one.

Mutation-tested six ways, each confirmed applied before its result was read:
the fix reverted (red, naming the field, the line and the expression), the fix
present only in a comment (red), the schema folder pointed at nothing (red on
the scope, not green), a new seeded model with an unscoped globally unique field
(red, naming it), the `@unique` pattern drifted so it matches nothing (red on
the count), and the comment stripping removed (red).

Nothing about the seed's safety moved. `SEED_EXPECT_HOST` is still compared
against the host the connection string resolves to and still refuses before a
single write; the second-seed refusal still counts tagged rows per family,
untouched, in the same place — `seed-reseed-guard.test.ts` pins that block by
position and caught an earlier version of this change that had lifted it into
a function; `--undo` still finds rows by the `[demo]` mark; and the workflow
still maps `DEMO_DATABASE_URL` / `DEMO_DIRECT_URL` and nothing else, so
production is not in scope for this button at all.

The check: the resolution is a pure module (`packages/db/scripts/
company-target.mjs`) that takes the candidate rows as an argument, so
`apps/web/lib/seed-company-target.test.ts` proves all of it without a database
— including the two cases that matter most and cannot be produced on demand,
two companies sharing a name and a one-match substring that must still be
refused.
