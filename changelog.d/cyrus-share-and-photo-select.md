### "Share" instead of "Show client", and picking more than one photo (Cyrus)
`cyrus/share-and-photo-select`

Two things a construction manager said almost in passing on a recorded
walkthrough, both right, both small.

**"Maybe instead of Show Client, I'd just make it share. So you can share
with anybody, right?"** He is describing an accuracy problem, not a tone
one. The control does not send anything to a named party: it puts one
capture behind the job's portal link, and that link goes to whoever the sub
sends it to — the GC, the architect, an owner's rep. "Client" named one
audience and made people stop to wonder whether the button was the right
one.

The button is **Share**. The state it produces is **"Shared by link"** — on
the badge over the thumbnail, on the line under the caption, on the
`/photos` filter chip and in the printed report's header and page notes.
"Shared" on its own will not do, and the badge's own comment has said so
since it was written: every photo in this gallery is already shared with the
team, so the bare word invites exactly the wrong reading. Naming the
MECHANISM is the only thing true of every reader — holding the portal link
is precisely what the state confers.

**The confirmation paragraph is untouched, word for word.** It was the best
sentence in the feature before this branch and it still is; it also never
contained the word "client", which is its own small argument that it was
written more carefully than the button above it.

**Premise correction, and it is the reason to read this paragraph rather
than the one above.** The brief said to grep `Show client` case-insensitively
across `app` and `components` and change every user-visible occurrence.
There is **exactly one** — `JobMediaCard.tsx`. Changing only that would have
left a button reading "Share" whose confirm step said "Share with client",
above a badge reading "Client can see this", beside a filter chip reading
"Shared with client" and a printed header saying "Only captures already
shared with the client". The word is spread across strings the grep cannot
find, because they name the STATE rather than the control. Sixteen strings
changed, in `JobMediaCard.tsx`, `/photos/page.tsx`,
`/jobs/[id]/photo-report/page.tsx` and `lib/photo-report.ts`; no prop,
action, column or migration was touched, and `sharedWithClientAt` /
`setJobMediaClientSharing` are deliberately still called that.

Counted off the diff rather than remembered — an earlier draft of this
entry said eight, which was the number of strings somebody had in mind
before going through the empty states and the printed page notes.

**"Is there a way you could put a check box, so you can do multiple and,
like, export photos? So I can say, pick these three photos and…"** Every
card in both galleries now carries a tick box, and a sticky bar appears with
the count and the one thing you can do to a selection.

**Which bulk action, and why it is not sharing.** His literal word was
*export*, and this app's export for photographs already exists and is good:
`/jobs/[id]/photo-report` is a printable document with the marks drawn on
the pictures. What it could not do was "these three" — it took a RULE
(everything the portal link shows, or everything, or neither) and never a
list. So the half that was missing was the picking, and the tick boxes are
exactly it. `?ids=…` on that same document is the whole of the new surface:
no new route, no new action, no new capability gate, no migration.

Bulk sharing was the other reading and was deliberately not built. Sharing
is the one irreversible act in this feature — "you cannot un-show it" — and
its confirmation is per photo because the DECISION is per photo: this one
shows a GC their own delay, that one shows them the crew's mistake, and each
confirm names that photo's marks and its playback warning. A bulk share that
kept that honest would have to put every capture in front of the person one
at a time, which is the card they just came from; one that did not would be
the single worst change this feature could take. The reversible bulk action
goes first.

**What a picked report does that a selection report does not.** It replaces
both filters rather than composing with them — one question per URL, because
`?ids=…&include=shared` prints fewer captures than were ticked with nothing
on the paper to say which went. It is **always** internal: the ids sit in a
URL somebody can bookmark and open a week later, by which time any of those
captures may have been unshared, and a banner that comes and goes on data
the person printing is not looking at is what `photoReportIsInternal`
already refuses. And it states on the paper when it holds fewer captures
than were picked, covering both causes in one sentence — deleted since, or
past the 100-capture limit.

**A selection spanning two jobs is told so, not disabled.** Ticking photos
across jobs on the company-wide gallery is a reasonable thing to have done;
it just cannot become a report, because a report is one job's document with
that job and its contact in the printed header. The bar says which jobs are
in the way and that the job chips above it are the fix.

**The checks, and the mutations that make them mean something.** The
selection rules are a plain module (`components/jobMediaSelection.ts`)
rather than state inside the gallery, because nothing in this repo's unit
environment renders React. Every assertion states the SIZE of the set before
its members — a bulk action carrying four captures out of five is the defect
worth catching, and `toContain` cannot see it.

**A crash found while reviewing this branch, and fixed on it.** `?ids=a&ids=b`
is a URL anybody can type, and Next hands a repeated key through as
`string[]`. `parsePhotoReportIds` is the FIRST parser in this app to read a
search parameter as a string rather than compare it, so it was the first that
could throw on one — `raw.split is not a function`, which production redacts,
so the report would have rendered as the bare error boundary with nothing on
it to say why. Every other page here declares its `searchParams` values as
`string`, which is a narrowing of what actually arrives rather than a
guarantee; TypeScript therefore could not catch this and did not. The other
two parameters on this page survive an array by accident rather than design —
`parsePhotoReportSelection` asks `includes(raw)` and the tag is compared with
`===`, so both fall through to their safe default. The parser now flattens an
array (each element read as its own comma list) and this page types `ids` as
what really arrives. Proved by mutation, not by argument: restoring the bare
`raw.split(",")` fails three assertions with exactly that message.

**Fourteen mutations, each applied, watched RED and restored, with the
suite re-run green afterwards.** The figures are the failing-assertion
counts the runs actually printed, not estimates: pruning removed from
`pruneSelected` (7), `toggleSelected` made add-only (4), `selectEveryVisible`
dropping the last capture (2), `bulkReportTarget` trusting the caller
instead of pruning (3), a two-job pick accepted as one job (1), the id
dedupe removed (1), `photoReportHref` writing a selection and tag beside
the ids (1), `include` allowed to beat the ids (1), the picked ids aliased
rather than copied (1), a picked report reported as not internal (1), the
printed header counting the ids asked for rather than what is on the paper
(1), `photoReportPickedNote` silenced (2), and the selection label reverted
to "shared with the client" (1 — the copy has a test of its own). 13 of 13
red; none went green, which is the result worth stating, because a mutation
that leaves a suite green has found a vacuous assertion rather than proved
one.

An earlier draft of this paragraph said ten mutations and gave a breakdown
that did not match any run — the kind of tally this repo has learned to
re-derive rather than inherit.

**What is NOT covered by a test on a laptop**, said plainly: the `ids`
clause is ANDed into `loadJobMediaForReport`'s existing company-and-job
`where`, so an id from another job or another company matches nothing — and
that is the one claim here a unit test cannot execute, because it needs a
database. It is a two-line diff in a query whose scoping was already there;
it is not a new trust boundary, but nothing on this branch proves it by
result.

The tick box is the one control on a capture card that is NOT a child of
`RowActions`, and that is deliberate rather than a lapse of issue #152's
rule 1. That rule empties a row of ordinary ACTIONS while a delete is armed,
because a mis-tap beside an armed confirm is a mutation; ticking a box calls
no server and discloses nothing. What it must not do is live in the cluster
— `RowActions` unmounts its children while armed, so a selection in there
would silently untick every card whose delete somebody opened and cancelled.
