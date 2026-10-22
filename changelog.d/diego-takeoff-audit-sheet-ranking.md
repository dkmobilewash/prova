### Sheets are ranked by what they say they are, not by how much is drawn

The real-plan report chose its sheets by STROKE COUNT, and on one set that
picked four LIFE SAFETY plans and dropped every architectural floor plan. Not
bad luck: a life-safety plan carries the egress paths, occupancy tags and
rated-wall hatching *on top of* the same walls, so it is denser than the plan
it is drawn over. Ranking by how much is drawn prefers exactly the sheets that
repeat the plan.

`takeoffRank` ships in `sheetSuitability.ts` — product code, not the eval. It
reads the TITLE, because a drafter writes what a drawing is across the bottom
of it, and that is more reliable than the number (an office convention) or
anything a model infers. The discipline letter only breaks ties.

**A demotion beats a promotion**, which is the whole difficulty: every sheet
that should sink also says PLAN — "LIFE SAFETY & OCCUPANCY PLAN", "UNIT
NUMBERING PLAN", "REFLECTED CEILING PLAN". Taking the best match would let each
of them argue its way up on a word it shares with the drawing it covers.

What the product now picks on its own, against the fixed list:

| set | its top picks |
| --- | --- |
| Camp Bow Wow | **A102** (105, a dimensioned floor plan), **A101** (95, a floor plan) |
| ELEVEN03 | all eight `A4.B.*` **FLOOR PLAN** sheets at 95 — the life-safety plans no longer surface |

**And the eval's sheet list is fixed by sheet NUMBER**, so "measured X of N" means
something: the old self-selection moved whenever the title reader improved, which
is why one run reported six sheets and a later one two. Neither was wrong about
the pipeline; they were about different sheets.

Measured on the fixed list: **8 of 9**, with A101 2,776 ft, A102 2,255 ft,
A120 577 ft, A4.B-Y2 1,458 ft, A4.B.1 2,603 ft, A4.B.2 2,722 ft, A4.B.3
2,538 ft, A103 29 ft. Only A2.20 (unit numbering, no readable dimensions and
no view caption) does not measure.

**One defect this exposed and did not fix:** A120 scores 5 rather than 70,
because its title block reads as "RR 107 - NORTH ELEV." — `nameSheet` picked up
a detail caption instead of the sheet title. The ranking is right about the
words it was given; the words are wrong. It is on the fixed list, so it still
measures.
