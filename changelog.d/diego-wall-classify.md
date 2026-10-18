### A countertop is also two parallel lines (Diego)

`diego/wall-classify`

The wall finder measures. This says what each measurement **is** — the question
geometry cannot answer, because a countertop, a bathtub, a cabinet run, a door
leaf and a dimension string are all two parallel lines a plausible distance
apart. They pass every test the finder has: parallel, overlapping, inside the
thickness window, long enough. Those tests describe a SHAPE and the difference
here is MEANING.

#### Measured on a real plan set before any of this was built

A 342 MB, 175-page permit set from a different architect, read locally. One
apartment floor plan, 82,799 segments:

| | |
| --- | --- |
| candidates in one crop | 98 |
| what the geometry got right | the exterior walls, the demising walls, the party wall, the corridor |
| what it also returned | **every kitchen counter, every bathtub, every refrigerator run, and five reference lines below the building** |

The same crop and the same candidate list, shown to a model: the counters, the
tubs, the vanities and all five reference lines rejected, the structure intact.
**200 ft of 774 removed, with no real wall among the removals.** Some casework
survived — this is a large improvement, not a solved problem.

Rules were tried first and this repo's history is the argument against more of
them: each was fitted to the drawings in front of it and broke on the next
office's conventions. "Reject a closed outline" deletes every wall on a plan
that draws walls as filled poché.

#### What it may not do

**It cannot change a quantity.** The reply is a label per run and nothing else.
Every run was measured before this is asked anything, a run it does not answer
about is left exactly as the geometry found it, and `UNSURE` is KEPT — the safe
direction for footage nobody has accepted is to leave it on the list. The worst
a wrong answer does is drop a wall or keep a countertop, both visible on screen
and both overridable. `readWallLabels` refuses an id nobody asked about, a
second answer for one run, and any label outside the four.

**A crop, not the sheet.** `planSheets.ts` works out why it never sends an
image: an ARCH D page fitted to a 2,576px long edge is about 65 DPI, which puts
1/8in lettering at eight pixels. So this sends the part of the sheet on screen —
at a readable zoom that is a readable image, and the room tags and fixture
outlines are what separate a kitchen from a corridor.

#### AND IT FOUND A LIVE BUG IN THE SWITCH IT HAD TO GO BEHIND

`CompanyAiSettings.disabledFeatures` is `AiFeature[]`. The database's enum had
**ten** values; the app's `AI_FEATURES` had **twelve**, each with its own toggle
on Settings → Assistant. `SCHEDULE_READ` and `PROPOSAL_DRAFT` had no member.

A missing member does not make a toggle do nothing — it makes the WRITE INVALID.
`aiSettings.ts` builds the array by casting (`AI_FEATURE_KEYS.filter(...) as
AiFeature[]`), so unchecking either box sent Postgres a value it does not have,
the upsert was refused, and **every other setting on the form went down with
it.** An owner switching one feature off could not save any of them.

Proved from the migrations, which is the only place that says what the database
enforces: `add_company_ai_settings` created seven values and three `ADD VALUE`
migrations brought it to ten. Both are added here with `WALL_CLASSIFY`,
additive, no drops.

`aiFeatureEnumParity.test.ts` is what stops it recurring. It reads the members
out of the schema and the keys out of `AI_FEATURES`, requires the two sets to be
equal, and separately requires every member to appear in a migration — because
the schema file says what Prisma INTENDS and the migrations say what Postgres
HAS, and this bug lived in the gap. Both ends derive their size from an
expression sharing no regex with the one that found them.

#### Every gate this had to pass, and one it could not

`aiFeatureGateCensus` (the switch), `aiSurfaceCensus` (a control on a real
screen), `pricingCensus`, `promptVersionCensus`, `action-capability-guards`
(`VIEW_JOB_COSTS`, the same capability the takeoff tab is behind) and the Ask
command coverage all pass.

**The surface census could not see this control, and mutation proved it.** It
asserts the file named for a feature contains a control; `TakeoffPlanViewer`
contains a dozen, so pointing at it is satisfied by any of them — the census
stayed green with the button deleted. #665 is the precedent: a control that
existed, called the right action, sat in the right branch and appeared on no
screen anybody used. A render test covers it now.

#### Checks

Preflight green, 10,157 tests. One migration, additive. **Eleven mutations,
eleven red** — including the two that reproduce the original enum bug, the
switch skipped, the capability dropped, the control deleted, the control shown
before there is anything to check, and three ways a label could move footage it
has no business moving.

A test written for the parser caught a real crash on the way: a `null` row threw
rather than being skipped, which would have turned one malformed reply into a
failed call and a marked allowance instead of one run left alone.
