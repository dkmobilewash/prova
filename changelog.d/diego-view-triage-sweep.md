### A caption joined with underscores is read as words, so a unit sheet keeps its floor plans

Washington Village A.100 (held out) offered nothing: view triage found two drawings and kept
neither. Swept over every sheet the whole-set run measures on the 36 training sets, 233 sheets,
without looking at that sheet. The same failure is on training: ELEVEN03's unit, clearance and
trash-room sheets, and MHK A1.03. Their CAD export captions plans `UNIT FLOORPLAN_B3-M`,
`TRANSITION PLAN_C1-A`, `TRASHROOM FLOORPLAN_LEVEL 5`, `FLOOR PLAN_LEAN-TO`. An underscore is
a word character, so `\bPLAN\b` never matched and FLOORPLAN was not FLOOR PLAN. Every one read
"the caption does not say what kind of drawing this is", and the sheet kept no drawing.

`captionWords` reads underscores as spaces and FLOORPLAN as FLOOR PLAN before `takeoffRank`
and the level and subject readers see a caption. That alone LOST counted plans: ELEVEN03
A3.1–A3.2C had been measured whole and carry two or three units each, and once recognised
they fell into one level-less group, so all but one were dropped as "the same floor drawn
twice". So `keptPlanViews` now groups level-less floor plans by subject when a sheet carries
two or more different ones, and a level-less plan of another kind (the unit's transition
plan) joins the floor plan it shares the most words with. A sheet with one level-less floor
plan, or none, groups exactly as before.

Measured against main on all 233 sheets: 17 change, every one from no drawing kept to its
floor plans kept, and the transition plans stay uncounted. The four formerly whole-measured
sheets that grew went up 42–64 ft. The one that shrank, A3.1, went 1,522 → 1,485 ft (−37,
2.4%), because each unit is now measured inside its own frame. No labelled training sheet
changes. Ten training sets measure no sheet at all, because every page is skipped for no
usable scale (or as not a floor plan). That gap is separate and not touched here.
