### A brand-new company's takeoff reaches the estimate: plain walls file under "Walls — untyped" and its line is written in the same add

The new-job walkthrough's biggest gap (steps 15–16). A company with no wall types adds every found group as "plain measurements". Those were written with no item, under Unassigned, and Send to estimate exists only on an item, so the takeoff stopped one step short of the estimate and nothing said so.

- **`saveTakeoffMeasurements`, plain LINEAR adds only:**
  - The runs file under **"Walls — untyped"** (`UNTYPED_ITEM`), the item the whole-set run already uses for walls nothing names.
  - That item's estimate line is written by `syncTakeoffItemLines`, scoped to that one item, in the same transaction.
  - The line sync already decided what an untyped line is (Diego's call, 2026-10-31): priced as the company's default partition and labelled assumed, or else the footage with no price, "Walls — untyped (no type: check)". A brand-new company gets the second.
- **A contracted job** files the walls and does not touch the estimate, which changes by change order.
- **Priced adds** (with a wall type) and **AREA adds** are unchanged.

Check:
- `takeoff-found-walls.dbtest.ts`:
  - Three plain runs give one "Walls — untyped" item and one line of 60 lin ft, unpriced. A second group adds to the same line (80), not a second item.
  - A contracted job files the walls and writes no line.
  - With the filing switched off, both tests go red.
- `job-stepper.spec.ts` 4–5: after one plain group on a brand-new company, the item panel shows "Walls — untyped", the bar reads Estimate done and "Next: Send it for signature", and the estimate tab shows the footage line with more than 0 lin ft.
