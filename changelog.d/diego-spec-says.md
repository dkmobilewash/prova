### Specs on the drawings, measured against a hand key and fixed for what they missed; "spec says" beside the wall type in the review queue and the estimate

**Measured, not guessed.** Every Division 09/07 requirement printed in the notes of Baker, Bunkie and Gen-BBQ was read by hand: 72 items, kept with the plans and off the repo. The scorer is `lib/specs/drawingSpecsScore.eval.ts`.
- **Main (#1073):** found 23 of 72, 1 false hit.
- **Now:** found 49 of 72, 8 false hits. On six sets never tuned on, 42 notes are kept instead of 17, about 36 of them real.

**The biggest miss class was a requirement with nothing measurable in it** (20 of 49), for example "ALL GYPSUM BOARD CEILINGS TO BE TEXTURED AND PAINTED" or "A HEAVY DUTY T-BAR GRID SYSTEM SHALL BE USED".
- Such a note is now kept when it is an obligation about this trade's own element, and shown as a plain requirement.
- Letting a numbered note qualify on a broad word (stud, grid, partition) was measured and refused: false hits went from 11 to 35.

**Three layouts that cut notes short are fixed:**
- a column heading swallowing every continuation line;
- a note number set wide of its text;
- dash bullets.

**Also:**
- A building-code citation no longer drops a requirement.
- Prefinished metal panels and other trades' fixtures are excluded.

**Spec says.** The items that change a wall type's price (Type X, abuse- or impact-resistant board, Level 5, studs heavier than 25 ga, deflection track) now show beside the type:
- in the **review queue**, for the suggested type, e.g. "A1 · Spec says: Type X board (09 21 16); 20 ga studs minimum (09 22 16, sheet A100)";
- on the **estimate**, under each line of that type: board lines get board items, stud lines get framing items.

Every item names its section, or the sheet it is printed on. Rated walls get Type X; a 25 ga legend under a 20 ga spec is said ("the legend says 25 ga"). No migration.
