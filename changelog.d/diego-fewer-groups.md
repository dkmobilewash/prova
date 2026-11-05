### The new-customer walk's S1–S3: fewer groups to confirm, no walls on roof or ceiling plans, and how much of a renovation count is existing wall (Diego)
`diego/fewer-groups`

From the fourth session's walk (new-job-walkthrough-v2.md).

**S1. Baker A101 came in 20 groups to confirm.** The whole-set run grouped walls
by the finder's 1/2" thickness bins, and drafted thickness wanders more than
that. The stage now groups at 1-1/4" (`STAGE_CLUSTER_INCHES`); the finder still
pairs faces at 1/2". Purity is the share of each group's keyed footage that is
its commonest type, on the type keys:

| width | training groups/sheet | training purity | held-out groups/sheet | held-out purity |
| --- | --- | --- | --- | --- |
| 1/2" (before) | 21.0 | 92.0% | 17.7 | 89.3% |
| 1" | 15.7 | 90.7% | | |
| 1-1/4" (now) | 14.4 | 90.7% | 12.1 | 86.9% |
| 1-1/2" | 13.0 | 89.6% | | |

Training tuned on 42 sheets, held-out measured once. Suggested types are the
same at every width (2,553 ft right on training). Baker A101: 16 → 8 groups.

**S2. Walls were found on the roof plan, foundation plan, roof framing plan and
ceiling plan.** Saving a scale starts the wall finder on that sheet, and
Confirm scales saves every sure one. The whole-set run has always skipped those
sheets by `takeoffSheetVerdict`; the scale save now does too. A person can still
press Find walls on one.

**S3. A renovation sheet's count includes existing walls, and nobody said how
much.** With plan comparison off, a sheet paired with a demolition plan now runs
the comparison dry and keeps what it would have set aside (a
`takeoffPlanTextRead` row, keyed to the scale). The whole-set panel says
"A2.1: about 420 ft of the 1,100 ft counted is existing wall, by comparing with
D2.1" and links "Turn on plan comparison". The figure needs sheet names (plan
reading or plan comparison on), which stay behind the owner's switch; without
them the panel still offers the switch. On round 11's training keys plan
comparison set aside 3,168 ft of junk for 84 ft of real wall.
