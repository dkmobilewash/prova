### Plan reading off: sheet titles without the title block's boilerplate, and no details in the floor plans to scale

From the no-AI renovation walk, 2026-11-08 (Green Bay, E Street).

**Junk titles.** The keyless reader names each sheet by its title block's largest
lettering, one page at a time. Green Bay read "ROGUE NO.: DRAWN: ARCHITECTURAL
INFORMATION SCL ROGUE" and "MECHANICAL FLOOR PLAN JCAA ERK".
- A word ending in a colon ("NO.:", "DRAWN:") is never part of a title (`nameSheet`).
- Once every page is read, `cleanKeylessTitles` strips any word that recurs across
  the set's titles: the firm name and drafters' initials. A word is stripped when it
  is on 10% or more of the titles and at least three, unless it is a drawing word
  (`CAPTION_WORDS`: PLAN, FLOOR, DEMOLITION…).
- It runs when the free pass closes, and when `ensureSheetNames` backfills names.
- Measured: 14 of Green Bay's 27 titled sheets read clean ("ARCHITECTURAL
  INFORMATION", "MECHANICAL FLOOR PLAN"). E Street's ten engineer's stamps
  ("PERMIT SET") become no title. Baker is unchanged.

**Details counted as floor plans.** With no page type read, the A-series
tie-break alone made "GUARDRAIL ATTACHMENT", "OFFICE 7 - NORTH" and "SKYLIGHT
PERFORMANCE" floor plans to scale, so the scale step never finished.
- A keyless title that names no plan, floor, level, unit, suite, wing or enlarged
  part is now "other".
- No title is no evidence, so an untitled sheet stays a floor plan.
- Measured: 6 non-plans leave E Street's list and 5 leave Green Bay's. A1.2, A2.1,
  A4.1 ENLARGED PLANS and Baker's three stay.
