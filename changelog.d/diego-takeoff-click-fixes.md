### The full-screen takeoff, after Chrome's click test on Baker A101

1. **Select selects.**
   - With the arrow, a click on a drawn shape selects it; its item fills the bottom strip.
   - A click on a found run lights its layer and pins its length on the plan.
   - The 104px bottom strip shows only while something is selected. It used to be remembered open forever after the first item somebody picked.
2. **A highlight lets go.**
   - Esc, a click on empty plan, or hiding the lit layer with its eye clears the highlight and its length label.
3. **A mouse moves around the sheet.**
   - The plain wheel scrolls up and down, and Shift+wheel sideways.
   - Ctrl/⌘+wheel and a pinch zoom about the pointer, about 11% a notch (it used to be a whole zoom step).
   - Space+drag and a middle-button drag pan.
   - There is a Hand tool (H) on the rail. The arrow is now called Select (V).
4. **Rectangle draws by dragging**, as well as click-click. It reads "Rectangle · N sq ft", like Area does, and no longer says it "needs 3 points".
5. **Quantities is a section of the layer panel.**
   - The top bar's Quantities scrolls the panel to it and never closes the layers, so the plan no longer moves sideways.
   - The panel collapses from its own header (›) and comes back from the canvas edge (‹ Layers).
   - "This sheet shows existing work…" sits in the panel, not over the plan.
6. **Find the rooms names the rooms**, and the table fits the 300px panel.
   - The cause: a sheet whose walls the whole-set run stored opens with them drawn, but nothing has read its lines or its words in that browser. Those live in refs only Run takeoff fills.
   - Find the rooms therefore worked from nothing and named none of Baker A101's 8 rooms, though `readRoomTags` reads 14 tags off it (CALL CENTER 111, CONFERENCE 105…).
   - It now reads the sheet first, quietly, when the walls came from storage.
7. **Export and PDF.**
   - The Export menu closes on Esc and on a click outside it.
   - PDF opens `/takeoff/<id>/pdf?page=N`: the same file, in a tab titled "<job> – <sheet>" rather than the file's own "ESC1".
8. **The orange dash-dot across Baker A001–A101** was the scale.
   - "Use the printed scale" stores the title block's scale as a line the full width of the sheet at mid-height (`scaleFromPrinted`). That is a number, not two points anybody chose, so it is no longer drawn.
   - A scale set by clicking is still drawn. It now says what it is on hover and has a "Scale line" row with an eye.
9. **Nothing docks over the drawing.**
   - Messages and the draft/save card (the set-scale prompt among them) dock at the top of the panel, or small at the bottom-left when it is collapsed.
   - Zoom sits bottom-left beside the scale badge, clear of the title block.
10. **Hints use the workspace's names**: "After Run takeoff" and "After ▾ Find the rooms".
11. **The rail's ⋯ wears the icon of the tool from its menu that is on**, highlighted.

Item 12 of the click test arrived cut off at "Needs review:" and is not in this change.

Check:
- `takeoff-workspace.spec.ts` 13e walks items 1–5, 7, 8, 10 and 11 in a real browser on S15.
- Click-list C0 opens Baker A101 off its stored walls, presses Find the rooms without Run takeoff, and requires the printed names.
