### The Plans and Scale steps: the set sorted, each sheet's scale and how sure it is, and one Confirm scales

The guided flow's Phase 2. Built only from what the inventory and the scale reader already store (title-block number, title and page type; the scale reading per page). No model is asked anything.

- **"Your plan set", at the top of the takeoff tab.**
  - The set is sorted: floor plans, demolition, reflected ceiling plans, elevations, details and sections, schedules, cover and index, then anything else (`lib/takeoff/planSet.ts`).
  - Each sheet shows its scale and a mark, in words and colour:
    - **Sure:** read off dimensions printed on the drawing, which agreed.
    - **Printed only:** the title block's scale, with nothing on the sheet confirming it, or a reduced print whose correction must be read.
    - **No scale:** with the reader's own reason.
    - **Confirmed:** a scale is saved.
- **Confirm scales** saves every sure sheet in one press (`confirmSheetScales`).
  - Only page numbers come from the browser. The rows are rebuilt on the server from the stored readings, and a page is saved only while it is still sure.
  - Each is saved exactly as a hand-set scale is, through one shared `writeCalibration`: the dialog's refusals, the provenance in the note, and the wall finder started on the sheet.
  - A page that already has a scale is never saved twice.
- **Floor plans that need a look** are listed first, each with a one-click fix:
  - **Use the printed scale** (only where the title block is all there is);
  - **Set it by two clicks ↗**, which opens the workspace on that sheet with Set scale already armed (`?page=N&open=scale`).
- **The stepper:**
  - Plans and Scale both land on this panel.
  - Scale is done when **every floor plan** has a scale. With no sheet recognised as a floor plan yet, any sheet with a scale counts.
  - Next reads "Confirm the scales", then "Scale N more floor plans".

Check:
- `planSet.test.ts`: each kind of sheet named from invented titles; a floor plan carrying elevations is still a floor plan; the order; each confidence and its reason; the printed fix only where it applies; a reduced print not sure; the Scale rule.
- `confirm-sheet-scales.dbtest.ts`, against a real Postgres:
  - asked for every page, it saves only the sure one and starts the wall finder on it;
  - it never saves twice;
  - the printed fix is one page at a time, and only where it applies;
  - another plan set is refused.
  - Loosening the gate to "anything not yet set" turns three of them red.
- `plan-set-scales.spec.ts`: a seeded five-sheet set (the reader cannot run in CI) reads sorted with Sure / Printed only / No scale. The stepper lands on it. Confirm saves page 1 at its 72 ft line with the provenance note; the printed fix saves page 2; the two-click fix opens the workspace with Set scale armed. Scale waits for the last floor plan, then is done.
- `job-stepper.spec.ts`: Plans and Scale go to `#plan-set`.
