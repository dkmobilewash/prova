### The phone could add a punch item and never take one back (Cyrus)
`cyrus/phone-punch-delete`

#592 and #593, both found on build 11 driving a real device. A punch-list item
created on the phone could not be removed from the phone: the row's only action
was `toggle()`, cycling OPEN → READY_FOR_REVIEW → VERIFIED forever. No delete,
no swipe, no detail screen. `deletePunchListItem` existed only on the web. In
the issue's own words, *"a crew member who typos an item, or logs one against
the wrong job, is stuck with it… on a phone-first app for people in gloves,
'go find a computer' is the failure."*

And the row drew a **chevron that toggled status instead of navigating** — it
is not in the screen at all, `GroupedRow` renders one whenever `onPress`
exists, even with `role="checkbox"`. So the gesture a person makes to INSPECT
an item was the one that CHANGED it, and `READY_FOR_REVIEW` is the status a
foreman acts on. Dropped on this row only; `GroupedRow`'s default is untouched
and other screens still rely on it.

**OFFLINE DELETE NEEDED A THIRD OP KIND, which is the part that was bigger than
the issue.** `sync-queue.ts` was `CreateOp | UpdateOp` — no delete shape at
all. The case that had to be decided rather than discovered: an item created
offline and then deleted before syncing. `cancelledByDelete` pairs them and
drops both, because sending a delete for a server id that never existed is
nonsense and leaving it queued strands the outbox forever. It removes the pair
from disk BEFORE the drain, so a pass that dies halfway cannot resurrect a
cancelled op. A 404 from the server settles a delete as DONE, not refused — the
row being already gone is the success case from the person's point of view.

**TWO QUESTIONS ARE DELIBERATELY LEFT OPEN AND ARE IN THE PR BODY**, because
both are product calls and neither is a patch. The server's DELETE is
owner-only, word-for-word the refusal the web row renders — so **this does not
fix #592's own example**: the crew member who typo'd still cannot remove it.
The control is gated on the same predicate so the phone never draws a button
whose only outcome is a 403 in "needs attention". And #593 says "two ways out,
your call": the chevron is dropped rather than given a detail screen, because
once the row has an explicit delete a chevron promising a destination is
strictly worse, and dropping is reversible while inventing a screen is not.

**The tests had to stop measuring a mock, and that is the transferable part.**
`screens/setup.tsx` mocks Ionicons to `() => null`, so "the chevron is gone"
was TRUE of a row that still had one — the vacuous shape this repo keeps
paying for. The screen test overrides that mock to render a real glyph, and
every chevron assertion carries a positive control (`checkmark` found in the
same row) plus a control-for-the-control (a chevron IS asserted present
elsewhere in the document, so a query that forgot to scope to the row would
have found it). Separately, `queued()` cannot prove a successful write at all:
`sync()` drains the queue the moment the server answers, so an empty queue is
what SUCCESS looks like and is indistinguishable from never having queued. The
online cases assert the API spy; only the offline case reads the queue's bytes
off disk.

Six mutations, each confirmed landed before its result was read and each revert
proved. The one that matters is the expo-router mutation — **make it render
nothing** — which reds six screen tests; CLAUDE.md records three PRs that
shipped green asserting a screen RECORDED an option while the framework threw
the real one away.

**A census hole found on the way past, not fixed here:**
`touch-targets.test.ts` scans `components/` and **not `app/`**, so nothing
enforces the 48pt floor on any screen file. The new controls declare
`minHeight: hitTarget` and are correct by construction, but no guard is
watching. That is "nothing is ever missing from a directory you do not walk",
in the suite written to enforce that floor. Widening a shared census belongs in
its own PR.

**Unproven by construction, and this is the one piece nobody can click
tomorrow.** happy-dom does no layout and returns zeros from
`getBoundingClientRect`. The ordering test asserts DOM order — the order a flex
column paints, but not a measurement. That Cancel is full width, sits above the
confirm in pixels, covers the pixel "Remove" vacated, and that the 48/56pt
heights render are all declared, not measured. The visual half needs a
TestFlight build.
