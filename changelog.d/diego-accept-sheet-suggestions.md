### "Accept all suggestions on this sheet": one press for every group the drawing names

- **Why:** the review queue was most of the new-customer walk's 15–18 minutes, at one key per wall group.
- **Now** one press confirms every group on the sheet whose type the drawing gives: a printed tag, carried or on a sibling sheet, or the legend's "unless noted otherwise". Each group takes the height Enter would take, its estimate lines are written, and the rest stay in the queue.
- A library guess by thickness alone is never taken this way (`Guess.drawn`).
- One line says what went in ("Accepted 12 groups on sheet A101 · 830 ft"), with Undo. Undo puts every run back on "Walls — untyped", removes the runs it wrote, restores the heights, and retires the lines (`undoSheetSuggestions`).
