### One scale question per set, only for the floor plans the takeoff needs; Confirm scales waits until the set is read (Diego)
`diego/scale-queue-set`

The accept-job walks (2026-11-10, plan reading off) found two problems. Green Bay's review queue
carried 380 scale items, one per sheet its keyless titles called a plan. On Topeka, Confirm
scales was pressed at 52 of 137 sheets read; the floor plans (page 74 on) were read after
it, and the stepper called Scale done with 10 of them unscaled. It counted floor plans by
sheet names, and with nothing named there were none.

Now the queue asks one question for the set: "No scale · N floor plans the takeoff needs".
It has "Use the printed scale on all N sheets", which confirms the reader's sure scales and
applies the printed ones, plus the list with each sheet's own fix. It counts only the floor
plans the whole-set takeoff would measure (`floorPlansOfTheWork`: one plan per floor), and the
stepper's Scale count is the same one. Confirm scales stays off, showing "Reading the set (30
of 137)…", until the page inventory has read every sheet. Checked on Green Bay and Topeka
(`takeoff-scale-set.local.spec.ts`): Green Bay's queue holds one scale item; on Topeka
Confirm waits for the read, then one press set 18 scales and the item came back with the 5
that need setting by hand. Mutations: one item per sheet fails Green Bay; no read-wait fails
Topeka.
