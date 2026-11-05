### "Set type": an estimator names an untyped wall group in one press, from the set's legend (Diego)
`diego/set-type-picker`

A wall group the drawing does not settle (no tag, no U.N.O. note, more than
one type that thick) now shows a "Set type" chip for each code the set's
legend read defines. One press puts every run in the group onto that type's
takeoff item. Runs the WALLS stage had posted to "Walls — untyped" move, and
runs not posted yet are written. The choice is saved with the job and priced
by "Send to estimate". A code the library lacks is added from the legend read
as read, through the review screen's own `addWallTypeFromLegend`, with its
"check against the drawing" note. Runs that are already typed, or held off the
estimate, keep their decision.

The choice is remembered for the job: the item takes the group's thickness, so
detection matches later groups at that thickness to it, and `wallItems.ts`
posts them as the type, labelled "(set for this job)". It never overrides a
tag.

`setWallGroupType` (`lib/actions/wallGroupType.ts`):
- `wallGroupType.dbtest.ts`: move, remember, write, refuse;
- `takeoffSetType.test.tsx`: rendered; the press sends the group's runs and the group leaves the list.
Three mutations (no remembering, no move, render nothing) each turn a test red.
