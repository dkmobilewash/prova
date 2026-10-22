### Takeoff: ceilings in the Rooms panel (behind the room-finder switch, OFF)

When the rooms are found on a sheet, each room now shows its ceiling type,
height and area, with where the answer came from — a ceiling plan tag, a
finish schedule, the drawn pattern, a sheet note, or a guess from a finish
code, flagged as a guess — and both are editable; a change reads "typed by
you". Two summary lines give square feet per ceiling type for the rooms on
the sheet as they stand and for every room saved on the job, which is the
line an estimate needs. Saving the rooms stores the ceiling on each room's
area.

The reading happens in the browser from the open PDF: the current sheet's
text, strokes and notes, plus the plan's reflected ceiling plan and finish
schedule pages (named by their stored title blocks, or found by their own
text on a small plan).

The check: with the room finder on, Find the walls, then Find the rooms on
a floor plan whose set has a reflected ceiling plan. Rooms show a type and
height with "ceiling plan tag p<N>" beside them; pick a different type on
one and the sheet summary changes at once; save, reload, find again, and
"Saved on this job" lists the square feet by type. On a sheet with no
ceiling information every row says "nothing read" and the type is yours
to pick.

Migration `20261023120000_room_ceilings`: five additive columns on
`TakeoffMeasurement` (`ceilingFamily`, `ceilingCode`, `ceilingHeightFeet`,
`ceilingFrom`, `ceilingGuess`), applied only to throwaway databases so far.
`lib/takeoff/roomCeilings.ts` holds the per-room rule; the readers it calls
are the ceilings evals' (`ceilingTags.ts`, `ceilingPattern.ts`,
`ceilingSchedule.ts` over the second session's `tableRowsFromPage`).
