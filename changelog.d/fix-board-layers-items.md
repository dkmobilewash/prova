### Board layers reach traced walls in the same tap, and traced walls are asked about (Cyrus)
`fix/board-layers-items`

Found by an independent review of `feat/bid-wall-questions`. A wall type
prices two kinds of estimate line: wall RUNS (`syncWallScheduleLines`) and
traced TAKEOFF ITEMS (`syncTakeoffItemLines`), and both multiply a per-layer
part by `boardLayers`. The guide's tap answers re-ran only the first. On a job
with a W1 run and a traced W1 item, "2 layers each side" doubled the run's
board and left the item's at one layer, and the next unrelated press of "Send
takeoff to estimate" then doubled it silently. The question also counted only
runs, so a type used only through traced items was never asked.

**Now.** After either tap answer (`setBoardLayers`, `setWallHeight`), the job's
takeoff-item lines for that wall type are re-derived in the same press, under
the checks the action has already passed: VIEW_JOB_COSTS, this company's job,
and the job still an ESTIMATE. The question counts the type's takeoff items in
"whether to ask", in its words ("3 runs and 1 takeoff item of W1 (150 LF)") and
in its stale-refusal token. A type used only through items is asked too. It
appears in the guide's wall types with no runs, so the height question, the
measured footage and "add the walls to the estimate" never count it.

**The re-sync is SCOPED, and the db test is why.** The first version re-ran the
takeoff's sync job-wide, which is exactly what Send does, and Send CREATES lines
for every item with an assembly. The new db test caught it putting a
different type's traced wall onto the bid, one nobody had sent, in a press
that was about W1's board. `syncTakeoffItemLines` now takes an optional
`onlyItemIds`. With it, it reads only those items and compares only their
lines, so no other item's lines are created, changed or retired. The tap
passes the answered type's items that are ALREADY on the estimate. Send and
every other caller are unchanged.

**The height question stays runs-only, deliberately.** A takeoff item carries
its own `heightFt`, and `itemGeometry` never reads the type's
`defaultHeightFt`, so no height answer changes an item's quantity. The height
tap still runs the scoped item re-sync, so both answers leave the type's lines
re-derived the same way.

Checks: a db test with a W1 run plus a sent W1 item, where "2 layers" doubles
both sets of board in one press (run sheets 69 → 138, item sheets 35 → 69),
studs, track and finish don't move, an unsent item of another type stays off
the estimate, and a later Send changes nothing of W1's. A db test that the
scoped sync leaves another item's lines in place and creates none for an unsent
one. 14 mutations, each red.
