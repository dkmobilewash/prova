### Deleting a plan updates the estimate, and says exactly what it will do first

**What was wrong.** "Delete plan" removed the drawing and every run and count traced on it, and left the estimate as
it was. A job kept pricing walls and doors from a drawing that no longer existed. The old confirmation even said so:
"Line items already added to the estimate are not changed." The next Send then retired those lines, including any
price a person had typed into them, without a word.

**What changes.**
- **The estimate moves in the same transaction as the delete.** Every item that had runs on the plan re-syncs
  through #1253's batched sync. An item with runs on another plan keeps them and recomputes. An item the delete
  empties goes, and so do its lines.
- **Nothing priced by hand is lost by surprise.** A takeoff line whose price or cost was typed is listed in the
  confirmation, with "Keep … as typed lines", on by default. Lines typed by hand from the start are never touched.
- **A job past estimate keeps its estimate.** It is the contract and changes only by change order. The plan still
  deletes.
- **The confirmation states the impact in plain words** ("This removes 1,240 ft of walls, 18 counted doors and windows
  and 6 estimate lines ($14,380.00) from this job"), with lines that change, a signing link out with the GC, and one
  primary button and Cancel.
  - Its numbers come from the delete itself, run in a transaction that is rolled back.
  - It is a native modal: focus moves in, Escape cancels, the page behind is inert.
- **The toast after the delete** gives the delete's own figures.
- **Not in this change:** Undo. A plan delete cascades through 14 tables and deletes the drawing from the store. An
  honest undo needs a soft delete (a migration), proposed separately.

**Checks.**
- `planDelete.dbtest.ts`: 7 of 8 cases failed on main; all 9 pass. 6 of 6 mutations red.
- `deletePlanDialog.test.tsx`: 5 of 5; 3 of 3 mutations red.
- Latency at Milk Prep size (144 runs, 80-line estimate, 60 ms per query): the preview and the delete are 36 queries
  each.
