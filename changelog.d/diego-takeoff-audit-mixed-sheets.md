### A mixed sheet measures its plan, and not its elevations or its hatching

Camp Bow Wow A120 is one enlarged restroom plan, eight interior elevations and
an accessories schedule on one page. Opened in the workspace it reported 542 ft
over 76 runs, marking the elevations, the schedule's ruled lines and two big
diagonal X patterns across the plan. None of those is a wall. It now reports
**121 ft over 11 runs**, the enlarged plan alone, with "Left out: 8 elevations"
in the caution.

Three separate mechanisms, each measured rather than argued:

**The caption finder knew `ELEVATION` and not `ELEV.`** All eight elevations are
captioned `RR 105 - EAST ELEV.`, so the sheet produced ONE view — and the viewer
only splits a sheet with two or more, so the plan's region grew to the whole
page. Finding a view and deciding what KIND it is are deliberately two steps: a
drawing that is never found owns no part of the page, so its geometry is adopted
by whatever caption is nearest. It has to be found in order to be excluded.

**A region holding several captions went whole to one of them.** A gutter is
half an inch of empty paper across the sheet, and a sheet that stacks its
drawings in packed rows has none — A120's nine views produced four regions, each
spanning the full page height. Such a region is now cut between the captions
inside it, on both axes. The orphan rule is untouched, because it is a scar: a
strip with no caption of its own still joins the nearest one, which is what
keeps a plan's dimension column with its plan.

**Hatch ticks assembled into diagonal walls.** The ±60° family is 41 strokes,
the longest 1.29 ft; `oneFacePerLine` joins them collinearly and the pairer
returns a 12 ft wall at 7-11/16in. The obvious rule — count the parallel lines
BETWEEN the two faces — is false in the dangerous direction: the phantoms have a
median of 2 and the real walls a median of 6, because a restroom plan is full of
fixtures and tile. What separates them is how much of the run has ink along it,
0.00-0.15 against 0.16-1.00. `drawnCoverage.ts` is blind to a run's ANGLE by
construction, so a 45° wall drawn as two continuous lines survives exactly as a
horizontal one does.

Only PLAN views are measured now, by `takeoffRank`'s own vocabulary rather than a
second copy of it. A caption nobody recognises is not measured either and is
named in the caution as something to check — measuring an unrecognised drawing is
how eight elevations reached a bid, and dropping one in silence is the same
failure with better manners.

Answer-key mode offers candidates only inside the measured plan views, and no
longer draws the calibration line: it is the one amber mark on the sheet that is
not the reviewer's to judge.

All three guards hold: the 20 fixtures at 15 of 17 within 2%, the bench at 111
walls missed and 17 of 60 type-totals outside 2% — both exactly their baseline,
with phantoms down on about twenty cases — and the real sheets at 8 of 9
measured. A102 and A4.B.1, both single-plan sheets, move by less than 1%.

A ruled schedule printed INSIDE a plan's region is still measured. A rule for it
was built and thrown away; `lib/takeoff/AUDIT.md` records what it cost and what
the next attempt should do differently, which is worth more than the rule was.
