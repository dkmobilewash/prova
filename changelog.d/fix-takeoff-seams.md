### Takeoff says why a button won't go, stops saying "No walls found" after finding them, and offers the sheet's own scale (Cyrus)
`fix/takeoff-seams`

Three things a first-time wall sub hit on 19 Oct walking takeoff → estimate on
main, none of them a quantity bug. "Add to the estimate" was already disabled
with nothing ticked, but nothing on screen said so, so it read as broken. After
every detected group was added, the panel fell back to its empty-state sentence,
"No walls found… none of it paired up as a wall", directly after finding them.
And S03 prints 1/8" = 1'-0", the page reader already reads it (matched by 5
printed dimensions), but the offer to use it lived only inside the Set scale
tool while the toolbar said "Set the scale before measuring".

Now the button carries a visible reason ("Tick the lines to add — nothing is
ticked yet"), the emptied panel says "Every wall found here is on your
measurements — N groups added" (`lib/takeoff/noWallsMessage.ts`), and the
toolbar offers "Use scale 1/8" = 1'-0"", which pre-fills the scale form for the
person to confirm — never applied silently. Detection, geometry and quantities
are unchanged.

The check: `takeoffMeasurementList.test.tsx`, `noWallsMessage.test.ts` and
`takeoffSheetScaleShortcut.test.tsx`, each red with its fix reverted. Known gap
left open: on a freshly read set the offer appears only after one reload.
