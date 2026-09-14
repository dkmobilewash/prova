### Job pickers say which job, not just what it is called (Cyrus)
`cyrus/job-picker-rows`

Issue #65. Fifteen jobs on the live database, **seven of them named "Smith
kitchen remodel"** — the placeholder text from `/jobs/new` — and every job
`<select>` and filter row in the app rendered that string over and over with
nothing to tell the rows apart. What gets filed through those pickers is a
backcharge, an RFI, a submittal, a daily field report, a compliance document.
Those are evidence records: identity fields lock on creation and sent
correspondence closes rather than deletes, so filing one against the wrong job
is not a mistake anybody takes back cheaply. The issue's own example is a
$4,200 backcharge that looks equally correct on both jobs afterwards.

**Every picker now reads `name — GC · status`** — e.g. `Riverside Medical
Office Building — Brackett Construction · In progress` — from one shared
helper, `jobPickerLabel` in `apps/web/components/jobLabels.ts`.

**Why the GC, argued rather than assumed.** It is the strongest discriminator
this schema has, and the app already agreed with itself before anyone asked:
the dashboard's job list — the only real job list there is — has printed the
contact name under each job name all along. A sub's jobs cluster by builder,
and the expensive filing error is the one that crosses a GC boundary, because
that is the one that reaches a stranger's paperwork. Status is second because
the GC alone does not cover the issue's other case, "two phases for the same
GC": the demo seed is exactly that shape (Riverside and Lakeshore are both
Brackett, Northgate and Cedar Park both Halvorsen) and status separates each
pair. A job number would have been better than either and there is no such
column; a city is not a field at all, and `Contact.address` belongs to the
builder rather than the site, so it would read the same on every job where the
discrimination is needed. Start date is null on every ESTIMATE, which is
precisely the state a placeholder-named job sits in.

**What it still cannot do, said rather than glossed:** two jobs with the same
name, GC and status remain identical here. That is a naming problem, and #65
says explicitly not to answer it with a uniqueness constraint — two jobs may
legitimately share a name.

**The type is the guard, not the convention.** `JobOption` was declared FOUR
separate times (`RfiFields`, `PunchListForm`, `SafetyIncidentFields`, plus
`JobChoice` twice) as `{ id, name }`, which is how the bare label kept getting
copied: every new picker inherited a type that never asked for anything you
could tell two jobs apart by. There is one declaration now and its `clientName`
and `status` are REQUIRED, so a page that queries `select: { id: true, name:
true }` does not compile. Finding all twenty-two call sites was `tsc` listing
them, not a grep anybody trusted.

**Two tests, both mutation-checked.** `jobLabels.test.ts` pins the label
against the four ways two rows can collide, using the seed's real names and
GCs rather than invented ones — and pins that a missing GC reads "client not
recorded" rather than `undefined`, and that an unrecognised status is dropped
rather than printed raw. `jobPickerCensus.test.ts` is the half that stops the
next picker regressing: it scans every `.tsx` under `app/` and `components/`,
requires each of the 21 files in its hand-written inventory to call the helper
exactly as many times as claimed, requires nothing outside that inventory to
call it, and fails on any bare `{job.name}` row outside two read-only lists on
`/deployment` that carry their own detail. It counts the helper calls against
the inventory total independently, and tests its own pattern against a control
string — a scan whose regex stops matching finds nothing and passes
everything, which is the `scratch-cleanup-order` scar in CLAUDE.md. It also
strips comments before scanning, because this repo has already shipped a
census that passed on the strength of its own documentation (#185).

**The cost, on the click-list for judgement:** filter chip rows are now much
longer, and on a phone a chip wraps to two or three lines. A taller filter row
that says which job you are picking beats a compact one that does not, but it
is a real change to how `/rfis`, `/submittals`, `/backcharges`,
`/material-orders`, `/drawings`, `/punch-lists` and `/photos` look.

Not addressed here, and still open on #65: the `/jobs/new` placeholder is
literally `Smith kitchen remodel`, which is presumably why seven jobs carry
it, and the test rows on the live database are somebody's cleanup rather than
a defect.
