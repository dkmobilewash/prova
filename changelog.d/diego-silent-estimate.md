### A price typed by hand never leaves the estimate unsaid, and changing a run or an item updates the estimate at once

**What was wrong (Diego's order (e), 2026-11-25; reproduced on main d41ab48c).**
- **Every action that re-syncs the estimate could retire a line someone priced by hand, without a word.** Clear type took a
  $7.00 line off on the spot ($210 → $0). Send did the same.
- **Deleting a run left its feet on the estimate** until somebody pressed Send again (60 ft priced for 20 ft of walls).
  Moving runs to another item, editing a run's points and cutting an opening did the same.
- **Deleting an item left its lines live, unlinked and still charged** ($200 for walls with no item).

**What changes.**
- **A sync never retires a line priced by hand.** It takes it to 0 ft, linked, with its price. The total is right, and when
  the walls come back the same line takes their feet again. A line with no hand price retires exactly as before.
- **The person is told.** The takeoff tab, the takeoff workspace and the estimate say which priced lines are at 0, read from
  the database on every load, so it covers every syncing action, including the background ones. Send's result names them.
  On the estimate, such a row reads "0 — its walls are gone; your price is kept for when they come back", and its own
  Remove takes it off.
- **A GC never sees one.** The signing page, the signed snapshot, DocuSign's contract summary, the proposal and the portal
  leave out takeoff lines at 0. A line typed at 0 by hand (an allowance) is still shown.
- **Deleting, moving or editing a run, or cutting an opening, updates its estimate line in the same write**, on a job
  still at estimate.
- **Deleting an item retires its lines.** A line priced by hand is a choice in the confirmation: "Keep the line you priced
  by hand (…, $X) on the estimate as a typed line", ticked by default.
- **A plan delete with that box unticked** now retires those lines itself, since the sync only takes them to 0.

**Checks.**
- `silentEstimate.dbtest.ts`: 17 cases on real Postgres. 14 failed on main, each for its stated reason. The other 3 are
  two controls, plus C2's default, which main's SetNull already did by accident.
- Mutations: one per rule. Each turned its rule's cases red, with the totals counted (PR body).
- Latency: the five changed actions stay inside half their transaction limit at 60 ms a round trip (32–35 queries of
  the 41 allowed).

**Found, and NOT changed here (named for Diego).**
- `rescaleTakeoffMeasurements` also does not re-sync. Its docstring keeps posted measurements behind deliberately.
- A ceiling with no assembly (a plain sq ft line) ignores its cutouts.
