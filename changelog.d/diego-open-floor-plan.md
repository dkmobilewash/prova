### "Run the takeoff" never opens on a sheet where Run takeoff is off (Diego)
`diego/open-floor-plan`

With plan reading off no title block is read, so the workspace's own choice of sheet could
be a reflected ceiling plan, where Run takeoff switches itself off once the drawing
captions are read. On Baker the new-customer walk opened on A111 and a new customer would
have been stuck there. Now, when the workspace chose the sheet itself (no `?page=`, not
Review's item) and that sheet refuses the run, the viewer reads the other sheets the same
way, with no model, and opens the first sheet that is surely a floor plan: a drawing
captioned as a plan, or an architectural sheet titled FLOOR PLAN. It says what it did. If
no sheet is sure, it lists the sheets under "Pick your floor plan". A sheet somebody asked
for stays. Checked on Baker with plan reading off (`takeoff-opens-floor-plan.local.spec.ts`):
opened on A111, moved to A100 OVERALL FLOOR PLAN, and `?page=14` stayed on A111.
