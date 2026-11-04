### The takeoff workspace is a full screen in its own tab: the plan gets three quarters of the window

- The job's **Takeoff ↗** button (and the estimate's workspace link) opens `/takeoff/[id]` in a new tab. The C-Stream tab stays where it was. The route was already outside the app shell, and only its layout changed.
- **Top bar (48px):**
  - Left: back to the job, then the job and sheet name, then a `← 3 of 24 →` stepper whose count is a dropdown of every sheet.
  - Middle: **Take off | Compare** tabs. Compare is the existing revision compare, and it says why it is grey on a sheet with no earlier issue.
  - Right: one main action, a solid green **Run takeoff** (Find the walls, renamed in the workspace only; white on emerald-700, 5.5:1). Its arrow holds Find the rooms, Review walls, Check these are walls, Find demolition and Read this sheet. Run anyway stays beside it. Then Quantities, PDF (the file at this sheet, in a new tab) and Export (the Excel/CSV download).
- **Tool rail (44px, icons):**
  - Select, Area, Rectangle, Line, Count, Edit and Set scale, each with a key (V A R L C E S) in its tooltip.
  - Then undo/redo, then a "⋯" menu holding Count like this, Cut out, Exclude like this, Split area and Work area. No tool was dropped.
  - At its foot: Sheets, Items, Sheet facts, Overview and Shortcuts.
- **Canvas:**
  - The canvas runs the full height under the top bar.
  - The mouse wheel or a trackpad pinch zooms about the pointer, and a two-finger scroll pans.
  - Zoom sits bottom-right and the scale badge bottom-left; clicking the badge picks Set scale. Messages stack top-left.
- **Layer panel (about 300px, collapsible with Quantities):**
  - All, Area, Line and Count chips, a search box, and the Legend.
  - One row per found wall group, plus Rooms and Doors and windows. A row has an eye, a swatch, a name, a count and a total in ft, sf or ea.
  - Clicking a row lights that layer and pins its length on the drawing. Double-clicking renames the row, for this viewer in this browser only. Diego asked for a team-wide name saved with the job and used in Quantities and Export; the job has no settings field for it, so that is a follow-up (a model and a migration), logged.
  - Held walls are a "Needs review" row in the layer list (swatch, count, ft), opening in place.
  - The "Check this is the right sheet" caution is a banner above the rows, folded to one line.
  - Nothing in the panel runs past its edge; the group detail wraps inside it.
  - Layers are the groups the finder returns today. There is no exterior/interior/corridor classifier, and no row claims one (Diego's call).
- **Colours:** the workspace draws the groups in a stronger six-colour palette at 3px (`LAYER_COLOURS`), with the same mark in the swatch. The takeoff tab keeps its palette.
- **Defaults:** the sheet and items rails start closed, because three rails open put the drawing under 75%. Their remembered state moved to `.v2` keys so nobody's old "open" brings them back.
- Everything else is untouched: saving, the 0.55 hold, grey-out, not-counted, rooms, doors, scans and export are the viewer's own state. The new layout portals that state into the shell instead of copying it.

Check:
- `pnpm test:e2e -- specs/takeoff-workspace.spec.ts`. Step 2b clicks Takeoff, gets a new tab and measures the canvas at ≥75% of the window. Step 11's chrome budget is now 52px (was 170) and it asserts the 75% at 1280 and 1440. Steps 13c/13d cover the layer row, readout, eye and rename.
- The local click spec at 47/48 or better.
