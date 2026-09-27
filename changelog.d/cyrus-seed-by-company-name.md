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

Each refusal points at the read-only `list-companies` operation, which comes
from `cyrus/seed-counters-zzbqtu` and landed while this was being written — a
refusal that leaves the operator with nowhere to look is only half a refusal,
and there is nowhere else to look: no page in the app renders a company id. A
listing was written here too and then deleted rather than reconciled, because
that one had already been run against `ep-patient-lake` and this one had not.
Two implementations of one thing is worse than either.

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
