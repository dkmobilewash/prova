### Door and window features for the learned scorers, one row per found opening (Diego)
`diego/opening-features`

METHOD v2's opening half, in the second's wall-table format. On every door- or window-keyed sheet,
`zzOpeningFeatureTable.eval.ts` writes one row per door the finder draws (every swing `doorSymbols`
keeps, before `onlyMarkedDoors`, whose drop is a column) and per window frame (plus a counted tag
placed with no frame), with `openingFeatures.ts`' columns and real/false from the key: inside the
swing or within 2 ft, one to one. Doors: leaf length, single or pair, sweep, arc fit, distance from a
standard width, on a wall, wall thickness and exterior, the gap in the wall (wall lines across the
doorway), mark distance and kind, the sheet's marked share, arcs and lines in the swing, room and
existing words nearby. Windows: frame and glass lines, width, on a wall, wall thickness and exterior,
tag distance and kind, counted by tag, the sheet tagging every window, a window schedule in the set,
windows and doors nearby. Calls no model; one command: `scripts/opening-model/table.sh <held 0|1> out.jsonl`
(per set, resumable). Check: `lib/takeoff/openingFeatures.test.ts` (the key match and the doorway gap).
