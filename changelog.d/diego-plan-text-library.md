### "Add these wall types to your library", off until a company turns it on (Diego)

`diego/plan-text-library`

Reading a plan set's partition legend has been measurable for two weeks
behind an environment flag; this is the customer-facing form of it, and it
ships OFF. `PLAN_TEXT_READ` is a per-company AI feature now and the first
OPT-IN one: a feature in `OPT_IN_FEATURES` is off for every company until
the account owner ticks it on Settings → Assistant, stored in
`CompanyAiSettings.optedInFeatures`, where every other feature stays on
until switched off. The environment flag is gone and every caller goes
through `aiGate(companyId, "PLAN_TEXT_READ")`.

A fourth ingest stage, `WALL_LEGEND`, reads the set's legend into
`PlanLegendProposal` — one task per page like every stage, a model call
only on the page or two whose own words legend the walls, metered as a
plan sheet — and stores the crop rectangle it placed for each type from
the page's own text and symbols. The review screen at
`/jobs/<id>/takeoff/legend` shows each type's crop beside the merged
reading, every flag in red, the fields editable, and an Add button that
creates the `WallType` and its quantity components from the fields AS
EDITED, so a corrected stud spacing changes the stud rule — never a price,
a catalog entry or a cost category. "Check these against the drawing"
renders the page and the crops in the browser (the server has no
rasteriser) and sends them for the sight read; the drawing wins a
disagreement and each one is flagged with both values. What plan-text
reading works out between detections now lives in `TakeoffPlanTextRead`
rather than a file under the OS temp dir, which did not survive a deploy.

The check that proves it: `wall-legend-library.spec.ts` seeds an INVENTED
legend as a stored proposal (no client's drawing text is in the
repository), follows the takeoff tab's link, counts one row per type with
a rendered crop each, edits a name, presses Add, and reads the `WallType`
and its components back out of the database with no price on any of them.
The same spec runs against a real legend read kept outside git when
`LEGEND_FIXTURE` names it. The migration was applied to a throwaway
Postgres and `migrate status` names it. The crop beside each type now
slides to where the type's assembly words are, so a legend that draws the
section BELOW its code box shows the section rather than whatever sat
above.

Not in this migration: the `PROPAGATED` proposal source. `wallProposal.ts`
narrows that enum to three members, so the value alone breaks the
workspace loader until the finder writes and reads it — one change, in
the finder's lane, with its own migration.
