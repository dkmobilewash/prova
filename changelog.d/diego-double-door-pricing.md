### A double door prices as one frame and two leaves (Diego)
`diego/double-door-pricing`

Diego's ruling, 2026-11-16: a double door is one opening and two leaves. Behind the existing Doors and
frames setting, so nothing changes while doors are by others:

- **Frames** (`FRAMES` and `DOORS_AND_FRAMES`) count openings: one frame set and one opening's framing
  (king and jack studs, header) per double door.
- **Doors hung** (`DOORS_AND_FRAMES`) count leaves: two per double door.

A found two-leaf pair is posted as its own count, labelled "Double doors (auto, from printed mark)" or
"Double doors (confirmed, no printed mark)", one point per opening; `leavesPerPoint` reads two leaves off
that label. No migration: the pair's leaves ride in the label, and in the stored unmarked-door read as
`leaves: 2`. Re-posting a sheet, Undo on a sheet's auto-posted doors, and Undo on a door confirm all
take both counts. The review queue's per-sheet auto-door count counts openings.
Check: `doorLines.test.ts`, `doorSuggestions.test.ts`, `doorLines.dbtest.ts` (a single and a pair
posted: 2 frames, 8 studs, 8 ft of header, 3 doors hung; a re-post clears both counts),
`confirmDoors.dbtest.ts` (a kept pair is its own count; Undo takes both). 9 mutations red.
