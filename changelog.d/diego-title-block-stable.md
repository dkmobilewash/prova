### A101 stays a floor plan: the title block's own title over a notes heading, and the read at temperature 0

**What happened:** walk v4 and walk v5 sent Baker's A101 the same title-block text, and the reading came back "FLOOR PLAN" once and "GENERAL NOTES" (OTHER) the next time. The sheet carries a notes block, so its text opens with that heading. With A101 out of the floor plans, the walk worked on A100 OVERALL.

**Fix, in two parts:**
1. **The read is asked at temperature 0,** so the same text gets the same answer.
2. **A deterministic guard** for when the reading gives a notes, legend, abbreviations or symbols heading as the title:
   - a plan title printed in the few lines just above the sheet's own number is the title field, and it wins as a PLAN, at MEDIUM, with the reason saying so;
   - a line opening with another sheet's number is a drawing index's entry and never counts.
   - Over both walks' stored reads it changes exactly A101 in v5. Over all 1,063 reads in prova_dev (24 notes-type titles) it changes none.
