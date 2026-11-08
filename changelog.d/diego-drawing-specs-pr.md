### Specs printed on the drawings: Division 09/07 notes found from the plan set's own text, no AI, shown with their sheet

A small tenant-improvement set has no project manual. Its specification is the general notes, the partition notes and the spec sheets printed on the drawings. The Specs page now has **Look for specs on the drawings**. It reads the job's plan sets with no model call, so it costs nothing and needs no switch (`lib/specs/drawingSpecs.ts`):

- **Notes are rebuilt column by column from the text positions.** Read row by row, two side-by-side columns glue into nonsense.
- **A note is kept only if it is this trade's requirement and has something measurable in it.** It needs:
  - a trade word: gypsum, stud, ceiling, fireproofing, EIFS, a finish level;
  - a requirement word: shall, provide, use, U.N.O., or a bound like MIN. or MAX.;
  - a measure: a gauge, a thickness, Type X, a finish level, a UL design, a spacing, deflection.
- **Dropped:**
  - abbreviation tables;
  - wall-legend assembly lines and detail labels that only say TYP.;
  - carpentry, roofing and code analysis;
  - demolition;
  - runs of keynotes glued together;
  - every structural, MEP, civil and telecom sheet.
- **Facts are read out of each note by code** into the spec-book reader's own shape, with the note as the quote.
- **Each sheet's notes are filed like a spec book's section**, with the sheet as the source. So the wall-type check and Add as inclusion/alternate work on them unchanged, and a wall's line says where to look, e.g. `09 22 16 (sheet G001, also on A101): 25 ga min, 16" o.c. max`. A note repeated on several sheets is kept once, with every sheet named.

Measured on nine sets in `real-plans/new`, Baker, Bunkie, Green Bay and E Street among them, with `drawingSpecs.eval.ts`:
- **45 notes kept, and reading each, 43 are real trade requirements.** Examples: "ALL INTERIOR STUD WALLS TO BE 3-5/8" 20GA. @ 16" O.C." (Gen-BBQ) and "ALL DRYWALLS SHALL RECEIVE LEVEL 5 FINISH, U.N.O." (Darrington).
- **Recall is not measured:** there is no answer key for printed specs. Clerk of Courts gave nothing.

No migration. The plan set is stored as the "book" these sections hang from.
