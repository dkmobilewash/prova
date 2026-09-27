### A measured wall arrives priced, like one typed on the Wall types page (Diego)
`diego/takeoff-wall-type`

Issue #515. **No schema change, no migration** — `WallRun` already had every
column this needed, which is the tell that the seam was a wiring gap rather than
a missing feature.

**Two measurement paths into the estimate, two behaviours.** A wall run typed on
the Wall types page produced lines carrying description, quantity, labour hours,
unit price, budgeted unit cost, craft classification, catalog link, production
rate and — since #513 — cost category. A plan takeoff produced description, unit
and quantity. So **the newest and most impressive way to get quantities into a
bid was also the one that dropped you back into hand-pricing every row**, while
the path that needs no PDF at all arrived complete.

Picking a wall type at posting time now creates a real `WallRun` — length from
the traced geometry, height from the type's default or typed per run — and
`syncWallScheduleLines` does the rest. Because it is a real run and not recipe
output, the takeoff **inherits `refreshWallSchedule`**: a recalibration or a
corrected height re-derives the lines through the same reconcile every other
wall run uses, instead of stranding a second set beside the first.

**Nothing was added to the capture layer**, which `takeoff.prisma` argues for at
length and is right about: a wall is a LINEAR measurement somebody elected to
treat as a wall at posting time, so the decision belongs at posting and not in
the geometry.

**A wall type with no layers is refused, at the picker and again at the action.**
It produces no schedule lines, so posting against it would record a run and add
no line items — a takeoff that looks posted and changed no number on the bid,
which is strictly worse than the bare quantities it replaced. The form offers
only types that have layers; the action refuses one anyway, because a form can
send anything.

**Three inputs disappear when a type is picked**, and that is not tidiness: the
type owns `sides` and `studSpacingIn`, and each component owns its own
`wastePercent`, `factor` and `roundUp`. Left on screen they would be inputs that
look like they matter and are ignored — the same defect as a rate nobody can
set, wearing the opposite face.

**#515's open question, answered on screen rather than in a migration.** Only the
wall recipe has something to point at; ceilings, paint, flooring and counts have
no equivalent and still land unpriced. The alternative was mapping each recipe's
output to catalog entries the way `WallTypeComponent.catalogEntryId` does — a
real feature, a larger one, and guessing it here would put a price on a bid
nobody chose, which is what `bid-recap.ts` refuses to do. So the absence is
NAMED on the form: an estimator learns it at the takeoff, with the measurement
in front of them, rather than discovering it in the recap with the bid built.

**And the smaller thing #515 found alongside is now stated.** `syncWallScheduleLines`
writes `quantity`, `laborHours` and `productionRate` on an existing line and
deliberately not the price: a re-sync happens whenever a run's length or a type's
layers change, and an estimator who has adjusted a price on this bid must not
lose it to a recalibration. The quantity and the labour are geometry and the
schedule's to own; the price, once it exists, is the estimator's. It read as an
omission and is a choice.

**Where the tests are, and what each can prove.** The decision is pure
(`lib/estimating/measured-wall-run.ts`) so every refusal can be read without a
database — which type, whose height, and what is said when the answer is no.
Six mutations, all red: a layerless type allowed through, the layer check moved
after the height, the typed height no longer winning, a zero height allowed, a
blank label left nameless, and `sides` no longer narrowed.

The consequence — that a posted line actually carries a price, a cost, a
category and a component link — is a claim about ROWS, so it is a `.dbtest.ts`
that CI's `dbtest` job runs against postgres:16, with the unpriced recipe path
kept beside it as a control. **It was not run locally**: an agent container has
no Postgres and no Docker. Typecheck validates every model, field, enum value
and required column against the generated client, which is real but is not the
same as having run it, and this file's whole subject is the difference between a
line that looks complete and one that is.
