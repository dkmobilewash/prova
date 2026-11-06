### Chrome's queue re-test: groups first with a count per part, every item zoomed to its walls, E Street opens on A2.1

1. **The review queue leads with what saves the most time.**
   - Wall groups (type and height), then windows, then single held walls, sheet by sheet, then scales and prices.
   - The bar shows each part's progress: "Groups 3 of 8 · Held walls 0 of 34".
2. **Every item is zoomed to with its walls lit and in view, the first one too.**
   - **What happened:** the first item opened at 194% on empty paper.
   - **Cause:** the zoom set the scroll one frame later, but the canvas takes its new width only when the render at that zoom finishes, so the scroll was clamped to the smaller sheet.
   - **Fix:** the target now waits until the sheet is the width it was worked out for.
3. **"Where to open" takes the counted floor plans best-ranked first, for work and for Scale.**
   - E Street's list counted A0.4 (a paving detail) ahead of A2.1 FLOOR PLAN, and page order opened both there.
   - The same `takeoffRank` score puts A2.1 (95) over A0.4 (5).
