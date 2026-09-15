### The first ten minutes of a brand-new account stop being dead ends (Cyrus)
`cyrus/empty-states`

Every contractor given a login starts with zero data, so the empty state IS
the product until they have typed something in. Nobody had ever looked at
these screens with an empty database — a seeded laptop, the demo project or
the operator's own company always had rows — and several of them were dead
ends or said things that were plainly false.

`/cash-flow` was the worst, and the numbers here are measured off the
rendered markup rather than eyeballed: on an account with no invoices it
produced **28** instances of `$0.00`, **five** AR aging buckets coloured in
the amber it uses for overdue money (so an empty account read as behind on
payments), two "Total outstanding: $0.00" lines, and a fully populated
**seven-row** forecast table of zeros — because `calculateCashFlowForecast`
seeds Overdue plus every month in its window unconditionally and the page
mapped them with no length check. `forecast.months.length` is seven whether
or not a cent is in it, so the length of that array was never the test; the
money in it is. It now explains what the page will show once there are
invoices and links to where invoices come from. An account with anything
outstanding renders byte-for-byte as before.

Two more zero states came out of the same reading, both of them real
answers rather than absences: an account whose invoices are ALL PAID was
also getting five amber zeros, and now gets a sentence saying it is paid in
full; and the aging buckets no longer paint a zero amber next to a
non-zero, since amber is a warning and zero is not one.

The rest, each verified by rendering it: `/bids` said "No bids match this
filter" when no filter was set, and had no path to the only place a bid
invitation is created (a GC's own page) — both fixed, and the filter
sentence is kept for when a filter really is on. `/schedule` said "No jobs
scheduled yet" on an account with no jobs, naming the wrong missing step,
and hid its Unscheduled section entirely when empty — that section is now
always rendered once a job exists, because "every job has a start date" is
the thing you go there to check and a section that vanishes when its answer
is "none" cannot confirm it. `/alerts` showed four 0/$0 tiles and a
sentence with no way out; the tiles go when nothing is derived at all and
the sentence now offers the two places a new account can record a date the
engine will watch. `/punch-lists` and `/field-reports` both refused with a
bare "Create a job first" where `/photos` handles the identical case with a
real link; they now use that link. `/deployment` distinguished no jobs from
no RUNNING jobs, which it did not before — its old sentence blamed
estimates on accounts that had none. `/closeout` explains what a closeout
package is before there is one, and links out.

On `/settings`, three of the four compliance sections — Locations,
Insurance, Bonding — wrapped their list in `length > 0` with the add-form
inside a closed `<details>`, so a new contractor saw a heading and a
collapsed triangle and nothing else. Each now carries one sentence in the
voice Licences already used (the only one of the four that explained
itself). Deliberately insertion-only edits, three separate blocks, so the
Company section another branch is adding to the same page merges without a
conflict.

**The `/settings` Trailer bug, and the decision.** The location-type
dropdown offered "Trailer", `LOCATION_TYPES` in `lib/actions/shared.ts` did
not accept it, and `enumFromForm` throws BEFORE the insert — so choosing it
lost the entire typed address. TRAILER was added to the list, not removed
from the dropdown: the Prisma `LocationType` enum has had it since
migration `20260826043651_add_trailer_location_type`, written for exactly
that value, so the database accepts it and the validator was the one copy
that was wrong. A jobsite trailer is the location a specialty sub is most
likely to add. This file's own comments cite `LOCATION_TYPES`, by name, in
four places, as the example of a second copy of an enum drifting from its
Prisma original — and it was still drifting.

Quick wins in the same spirit: the Sandbox connector — "a test connection
to nothing", holder of the only working Connect button on
Settings → Integrations — is hidden outside development, though a company
that already connected it keeps the card, since its Disconnect button is
the only way to undo that. And `ReceivablesPanel` told an account that had
raised no invoices "Every invoice raised has been paid in full", which is
true and absurd; zero has its own sentence now, decided from a count of
invoices raised, because an empty list has two causes needing opposite
sentences and the list alone cannot tell them apart.

**The specific checks.** 35 new tests, all four files mutation-tested.
`app/(app)/empty-states.test.ts` (20) RENDERS seven pages against an empty
database and asserts both the new copy and the absence of the old — the
`EquipmentRow.test.ts` precedent, and for its reason: an empty state is
output, and a grep for `href="/jobs/new"` cannot tell a link that renders
from one inside a branch that never runs. Every case carries an
anti-vacuity assertion, because otherwise each `not.toContain` would pass
just as happily on the empty string. Mutating the cash-flow guards back to
their original form turned all five of its tests red; with only the
early-return disabled, three still passed, which showed the zero
suppression is guarded in two independent places rather than one.
`components/empty-state-links.test.ts` (7) renders the three refusing
forms. `lib/company-location-types.test.ts` (5) reads the `LocationType`
enum out of the schema file and requires `LOCATION_TYPES` to be the same
set — restoring the three-member list turns three of them red — and checks
the dropdown's own third copy offers nothing the action will refuse; it
asserts the parse found a non-empty enum first, since a regex matching
nothing is never missing anything. `lib/integrations/registry.test.ts` (6)
covers the visibility predicate, which takes the environment as an argument
rather than reading `NODE_ENV`, so it is pure.

Not done, and worth knowing: `/deployment`'s "Nobody on the team yet" is
unreachable — the signed-in viewer is themselves a `User` row in the
company, so that list is never empty — so it was left alone rather than
given copy no one can see.
