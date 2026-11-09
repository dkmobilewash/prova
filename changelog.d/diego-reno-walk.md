### A renovation customer without plan reading: what the walk found, and what is fixed

Walked Green Bay and E Street as a new renovation customer with AI off (preset
types, printed scales, no model key anywhere): upload → plan set → demolition
pairing → Run takeoff → existing walls → queue → estimate → GC proposal. Notes
and shots are in `coordination/refs/new-job-reno-noai-*`.

**With plan comparison off (a new company's default)**
- Nothing named the sheets.
- Nothing paired a demolition plan or set existing walls aside.
- E Street opened on **FP2-3, a fire sprinkler plan**, and bid its pipes as
  276 ft of wall.
- Both proposals excluded "work on existing walls to remain" while pricing them.

**With plan comparison on**
- The sheets get names without a model, and E Street opens on A2.1 FLOOR PLAN.
- Run takeoff sets 26 walls (486 ft) aside against A1.1 DEMOLITION - FLOOR PLAN,
  on the server, and **the screen never said so**.

**Fixed**
- **The comparison is shown.** The server's result is stored per page
  (`TakeoffPlanTextRead` kind `prior-plan`, no migration). The pairing bar shows
  it: "Compared with demolition plan A1.1 (paired by title). 26 walls, 486 ft,
  set aside as existing to remain". The wall total reads "632 ft new (486 ft
  existing set aside)".
- **Top of the panel.** The pairing and exclusion bars moved from below every
  layer to the top of the side panel.
- **The switch is pointed to.** A set whose pages show existing work, with plan
  comparison off, now says so on the takeoff tab and links to Settings →
  Estimating (it uses no AI). Sheets already read get their names when the
  workspace next opens (`ensureSheetNames`).
- **Plan reading off.** The reading panel says so instead of offering "Read the
  title blocks", which would refuse every sheet.
- **Sheet number.** The workspace header and sheet list show the number the
  viewer read off the title block ("A3.1", not "Sheet 9").
- **Height notice.** "No height from the drawings… turn it on" shows once, not
  on every group.
- **Walk script.** It names the job after the set, and gains WALK_NO_AI,
  WALK_RENO and WALK_PLAN_COMPARE.

**Logged, not fixed here**
- **Default.** Should plan comparison (no model) be on by default, or whenever
  plan reading is off? That is Diego's call.
- **Junk titles.** Keyless titles are sometimes junk ("ROGUE NO.: DRAWN: …").
- **Non-plans in the scale list.** "Floor plans that need a look" includes
  details, elevations and site sheets, so the stepper keeps asking to scale them.
- **One type for all.** With preset types nothing matches by thickness, and "Pick
  a type for all" puts every group on one type.
- **Home page.** It has no link to start a job.
