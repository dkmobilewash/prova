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
