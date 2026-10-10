### A wall-schedule line somebody deleted used to come back (Diego)

`diego/wall-schedule-delete`

Reported from the app: delete a wall-schedule line and it reappears.

`syncWallScheduleLines` read only `isDeleted: false`, so a line somebody had
removed was invisible to it and the create loop built a fresh one — **at
catalog prices**, losing whatever had been typed on the old one. Any
recalibration, any posting, any `refreshWallSchedule` was enough to trigger it.

#### Telling the two kinds of deletion apart, without a new column

The problem is that a person's delete and the sync's own retirement both set the
same flag. But this function is the only other thing that deletes one of these
lines, and it does so in **exactly one circumstance**: the component is no
longer in the schedule.

So when it retires a line it now **releases the component link**, and the rule
falls out of that:

| | |
| --- | --- |
| deleted, still linked to its component | a **person** removed it — leave it alone |
| deleted, link released | this function retired it — build a new one if the component comes back |

No migration, no new field, and the distinction is a fact about who wrote the
row rather than a flag anybody has to remember to set.

#### What it means for an estimator

A deleted wall-schedule line stays deleted, through a recalibration, through the
run being removed, and through a run of the same wall type being added again.
**Their decision outlives a re-sync.**

A line they want back is added by hand, or by changing the wall type — which is
where a derived line's existence is actually decided.

One behaviour deliberately kept: the module's note that *"a line that should be
repriced is one somebody deletes"* no longer works as a reprice mechanism,
because the line does not come back. That was never written down as a feature
anybody uses, and silently rebuilding a line at today's catalog price is
indistinguishable from the bug being reported here.

#### Checks

- Seven cases in `takeoff-wall-run.dbtest.ts`, against a real Postgres.
  **Five mutations, four red** — including the original bug put back, a
  person's deletion being ignored, and the link not being released.
- **The fourth was found by mutation and is the subtle one**: without the
  `isDeleted` guard in the retirement loop, a person's deletion has its link
  released the next time the component falls out of the schedule, and is
  forgotten the moment a run of that wall type reappears.
- The fifth mutation is **equivalent**: a deleted line taking the update branch
  still stays deleted — the update writes quantity and labour and never clears
  `isDeleted` — so no test can tell it apart, and none pretends to.
- The four new cases each reset the job first. The suite above deliberately
  accumulates and `postTakeoffMeasurements` marks a measurement posted, so
  without that they post nothing and read an empty list — **which looks like a
  passing assertion about the wrong thing.**
