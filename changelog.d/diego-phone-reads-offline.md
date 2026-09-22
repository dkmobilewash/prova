### The phone can be read with no signal (Diego)
`diego/phone-reads-offline`

Gap 5, first half. `lib/api.ts` was fetch-and-render with no caching
anywhere: nine screens, every one of which showed error text and an empty
list the moment signal went. The queue has protected WRITES since #382 —
a list that lies about reads offline is the other half of a field app.

**One policy, spent by every screen.** `cachedRead` returns the server's
answer and caches it, or the last answer this phone got with how old it
is, or — the case that matters — **nothing**, which is not the same as
emptiness. That distinction is the bug this started from: with no
connection the punch list rendered "Nothing outstanding on this job.",
its empty state, which on a jobsite reads as a claim that the job is
clear. Reported from site.

Screens that load two lists cache them together, because half a screen
fresh and the other half a week old is worse than either. One
`OfflineNote` component says it, so eight screens cannot word it eight
ways.

**The phone fills the cache before it needs it.** Home is the screen the
app opens on, so while there is signal it quietly refreshes the current
job's other sections — Materials, Safety, T&M. By the time somebody opens
Materials in a basement it is far too late to fetch it. Photos are
METADATA only: a job's photos are tens of megabytes and this runs on
somebody's cellular plan.

**The guard is the interesting part, because both failure modes here are
invisible.** A prefetch that writes `punchlist.<id>` while the screen
reads `punch-list.<id>` does nothing at all and looks perfect in review;
a screen that fetches without the cache is a blank page in a basement.
So `cache-parity.test.ts` derives what the screens read from the screens
themselves, asserts the prefetch fills exactly that set, and fails the
build on any screen that calls `api.list*` without a cached read — with
an exception list that must name a reason and is itself checked for
staleness.

It found two on its first run, both mine and both already written: Home
fetched four lists raw, so offline it rendered a day of zeros — "no
photos today" is a claim, and it was wrong every time the fetch failed —
and the punch list was still on its own older copy of the policy rather
than the shared one.

**Drawings and the schedule reach the phone at all**, which they never had
— `DrawingSet`/`DrawingRevision` and `CrewScheduleDay` were web-only, with
no `/api/v1` route between them and a foreman.

Drawings answer the question that is actually asked in front of a wall:
**is what I am holding still current, and do we even have the current
one?** The governing revision is the latest ISSUED, received or not, and
when those differ the set says so and names what the crew is actually
working to. Derived on read, never stored — a "current" flag somebody
forgot to move would be precisely the failure it claims to prevent.

**There are no SHEETS in this product.** The teardown asks for a per-sheet
download badge; a set here has revisions, and a revision may carry one
file. So keeping a drawing is per REVISION, and it is deliberate rather
than automatic: rows are cached behind your back because they are cheap,
and a drawing file is megabytes on somebody's cellular plan. A held file
says so on its row, opens with no signal at all, and the screen totals
what it is using.

The schedule carries the plan and the gap in one list. `CrewScheduleDay`
has no `attended` column on purpose, so "worked it" is derived from
whether hours exist — a planned day with no hours against it IS the
missing timecard, and it now shows up on the morning it still costs
nothing to chase. A future day says nothing, because `false` there would
read as an accusation.
