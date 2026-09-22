### What actually changed, in plain English (Diego)
`diego/offline-notes-everywhere`

Round three of the same report, and this time it is pinned by tests that
mount the screens.

**What was reported.** With no signal, Home, Jobs, drawings and the
schedule said "Showing what this phone last loaded — no connection". The
punch list, field reports, time, photos, materials, safety and T&M said
nothing at all — no rows, no note.

**Why.** Those seven are the screens that queue writes, and their shared
`useSync` did this: fetch a token, flush the queue, and only then refresh
the list. So the read a foreman is standing there waiting for sat behind
two network operations aimed at a server that was not answering — and
`flushQueue` hands every caller the SAME in-flight promise, so one queued
write that has not come back holds every one of those screens at once.
The read never waits on the write now. `lib/sync-order.ts` owns the order,
`syncOnce` is tested against a flush that never resolves, and a flush
costs nothing at all when the queue is empty (no token, no wait).

**And six screens still claimed emptiness they had not established.** "No
photos yet", "No time logged", "Nothing on order", "No T&M tickets", "No
reports yet", "No jobs yet" — each said when the truth was that the phone
had never loaded them and could not now. That is the sentence this whole
layer exists to kill ("Nothing outstanding on this job.", read on a
jobsite as a clean punch list). `lib/empty-state.ts` derives it from the
load in one place, and the three screens that had already been fixed by
hand now share it rather than wording it themselves.

**The part worth more than either fix: the screens are rendered in tests
now.** `vitest.screens.config.mts` mounts the real screen files with
react-native-web in happy-dom, with the API rejecting the way a phone with
no signal does, and asserts the sentence on the page. It is what three
rounds of reading the code could not do. Turning the old ordering back on
reproduces the exact device report — `Pending sync: 1 · No T&M tickets` —
and turning an `emptyFor` back into a hardcoded empty state fails the
screen that owns it. 24 screen cases across every list screen in the app,
~1 second.

**Also, on the web, one control that did not exist.** A planned crew day
in the PAST could not be removed anywhere in the product: Remove lived
only on the next-two-weeks list, and `unscheduleCrewDay` is excluded from
Ask on the grounds that removal belongs on /schedule, where the day is
visible. A day in the gap report IS visible on /schedule, and had no
control — so a plan entered by mistake, or for a job that was called off,
was permanent. It has a two-step Remove now, gated the same way as every
other change on that page. The objection is answered in the confirmation
rather than by leaving people stuck: this is a gap report, so the sentence
says removal unmakes the PLAN and does not record the HOURS.
