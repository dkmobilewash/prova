### The hours a crew member put in survive the phone being force-quit (Diego)
`diego/handover-hours-survive`

Issue #482. Mobile only — **no schema change, no migration.**

**What happened on a borrowed phone.** A foreman hands the phone across, the crew
member enters 8 hours, and it goes to the durable queue. The phone is then
force-quit — which `app/_layout.tsx` explicitly expects, and handles by putting
them straight back on the handover screen. On relaunch the rows were **component
state**, so they were empty: the hours were invisible, `Sign and finish` is
disabled until one row exists so it was dead, and the only thing the screen
offered was entering the hours again — a second `time:create` with a fresh
`clientOperationId`.

A duplicate day's pay, on the one screen whose entire purpose is that the hours
are right, in front of somebody using another person's phone who has no way to
know the first entry landed and no reason to doubt the screen.

**Reading the pending queue back is NOT enough, and the issue proposed exactly
that.** `useQueueDrain` flushes every 20 seconds while the app is foregrounded
and has no exclusion for a handover, so on a phone WITH signal the op is gone
from the queue within seconds of being written and a relaunch finds nothing
there. That fix would have repaired the basement and left the yard broken — the
worse half, because the basement is where the queue is visibly doing its job and
the yard is where it looks like nothing happened. Established by reading
`use-queue-drain.ts`, not assumed.

So the receipt lives beside the handover flag, which is already the thing that
exists to survive a relaunch. `Handover.entries` carries each set of hours with
the `clientOperationId` it was queued under — a pointer at the queue entry, not a
second record of the work. `recordHandoverEntry` dedupes on that id, so a
double-tap cannot render one entry as two.

**Two details that are the fix as much as the writer is:**

- `getHandover` rebuilds its record field by field, so a field it does not name
  is dropped on every read. `entries` is carried through explicitly; without that
  line the receipt would be written, never come back, and this would look fixed.
- A malformed receipt row is **dropped**, not allowed to fail the parse. A null
  parse reads as "no handover open" in `app/_layout.tsx`, which would hand the
  foreman's whole app to whoever is holding the phone. Losing one receipt line
  costs a re-entry; that costs the company.

**And one of my own assertions was vacuous, caught by mutation rather than by
reading it.** The test that `Sign and finish` is live looked for `[disabled]`.
react-native-web renders that state as `aria-disabled="true"`, so the selector
could never match: forcing the button dead left the test green. Found by probing
the real DOM — and the first probe was itself wrong, querying before the async
`getHandover` had resolved, so the screen was still `null` and no button existed
at all. A failed probe is the instruction to fix the harness, not a result.

Six mutations, all red: mount stops seeding from disk, the receipt is never
written, `getHandover` drops `entries` again, the dedupe is removed, a malformed
row fails the parse, and the button is forced dead.

295 unit and 67 screen tests pass, typecheck and lint clean.
