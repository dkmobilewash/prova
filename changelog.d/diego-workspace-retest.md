### The workspace after Chrome's re-test: the wheel zooms smoothly about the cursor, Select picks one run, Esc puts a tool down

- **The wheel (Togal/Bluebeam style).**
  - A mouse wheel zooms about the cursor. A trackpad's two-finger scroll pans; a pinch (or Ctrl/⌘ + wheel) zooms. Hand, the middle button and Space still drag to pan.
  - A mouse is told from a trackpad by whole 120-unit notches with no sideways part.
  - **No jumps or flicker:** during a gesture the sheet is scaled with a CSS transform about the point under the cursor, with no re-render. 160ms after the wheel stops the zoom is committed.
  - The sheet is now drawn off-screen and swapped in. Resizing the visible canvas used to clear it, so every zoom step showed a blank sheet until pdf.js finished.
- **Select picks ONE thing.** Order of preference:
  1. a drawn shape's own line;
  2. the nearest single found run;
  3. the inside of a room.

  The pick is outlined on the plan, and its length is pinned beside it. The strip reads "A run in <layer>", its length, and "1 of N runs". It no longer lights the whole group. Esc, a click on nothing, or another sheet lets go of the pick and closes the strip.
- **The walls total never lands loose on the plan.** "Walls on this sheet: N ft" docks in the panel, or in the notice corner with the panel collapsed. Before, it rendered unstyled at the plan's top-left whenever the panel's slot was not mounted. A new hint docked in the panel is scrolled into view.
- **Esc steps back to Select:**
  - a half-drawn shape goes first;
  - with none, Set scale or any "⋯" tool is put down;
  - Set scale is left in one press, even mid-line or from its distance box.
- **Baker A001 is "a demolition drawing", not "an elevations sheet".** `takeoffRank` had ELEVATION and not DEMO, and the sheet was named after its first view, "…DEMO ELEVATION". DEMO now ranks below every other kind.
- **The PDF page's header says "<job> – <sheet>"**, with Download (saved under that name) and Print. Chrome's viewer printed the file's own Title ("ESC1") in its toolbar, which is now switched off (`#toolbar=0`). Rewriting the Title would mean re-encoding the whole set on every open.

Check: `takeoff-workspace.spec.ts`, real wheel events in real Chromium.
- 13e: three mouse notches zoom past 1.3×. The point under the cursor stays within 3px, and a per-frame canvas sampler sees no blank frame. A sideways-carrying stroke pans without zooming; a ctrl + small-delta pinch zooms by less than 1.2×. One click outlines exactly the run clicked, with no layer lit; Esc and an empty click let go. The PDF page's header, toolbar-off frame and Download name are checked.
- The two-sheet test: j lets go of a pick and the strip.
- 13h: the walls total is never outside the panel or notices, with the panel open or collapsed. A Split-area hint arrives in view in a panel scrolled down. Esc leaves Split area, and Set scale mid-line.
- Mutations, each red with its message: drawing onto the visible canvas ("the sheet went blank while zooming"), Select lighting the layer ("a click picked more, or less, than one thing"), and Esc not putting the tool down ("Esc left Split area on").
- `takeoffSheet.test.ts`: a demolition plan beside a demolition elevation is a demolition drawing.
