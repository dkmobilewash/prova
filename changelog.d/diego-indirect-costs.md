### Nothing could tell supervision from permits, so nothing could notice one was missing (Diego)
`diego/indirect-costs`

The 2026-10-04 estimating audit listed indirect costs — supervision, permits,
mobilization, cleanup, safety gear — as a missing capability. Exploring it found
something more useful than a gap.

**The mechanism was never missing.** #512 built and tested it: a `JobLineItem`
with a cost and `unitPrice: null` is in the cost base, receives no share of the
spread, and is recovered through the billable lines — *"$500 of GC cost on a
$3,000 job spreads $3,500 across the two billable lines."* Twelve files repeat
the rule and the GC portal has a test whose failure message is *"a cost-only
budget line reached the GC's contract."* General conditions have priced
**correctly** all along.

**What was missing is that nothing could recognise one.** Every indirect was
`CostCategory.OTHER` with a free-text description — and `OTHER`'s only
documentation anywhere was a UI hint string, *"Permits, testing, anything
uncategorised elsewhere."* No screen could tell supervision from permits, so
nothing could ever say "this bid has nothing for cleanup". A forgotten $2,500
mobilization is money off the bottom line and no surface said a word. Nothing in
the repo matched the word "mobilization" at all; a dumpster appeared only as
something to EXCLUDE in proposal prose.

So: `IndirectCostKind`, and two nullable columns — one on `JobLineItem`, one on
`LineItemCatalogEntry`. The catalog entry is where the company's own figure
lives, which is the mechanism `ARCHITECTURE.md` already sanctions (*"a template
for the same `jobLineItem.create` call"*) rather than a second defaults table.
The line column exists so a **hand-tagged** indirect counts as present —
without it, an estimator who typed "Mobilization — $2,500" would be told they
have no mobilization, which is the cry-wolf failure #616 was shaped to avoid.

**Deliberately not a sixth `CostCategory`.** That enum is a total `Record` keyed
by `RECAP_RATE_FIELDS`, so a new member forces a new markup rate column; it is
keyed on by the QuickBooks account mapping; and the EQUIPMENT/OTHER split of
2026-09-26 is documented as permanently un-backfillable. Indirect-ness and
markup treatment are different questions — supervision is LABOR that happens to
be general conditions — so it gets its own axis.

**And deliberately no derivation**, which exploration turned from caution into a
fact. Supervision as "weeks × rate" needs a duration: there is **no duration
concept anywhere in the schema**, no `JobSchedule`, no `JobPhase`, no crew size
at bid time, and `startDate`/`endDate` are nullable and *not written by job
creation at all* — the app's own labor pricing already assumes `startDate` is
absent. Both factors are missing, so a derived figure would be built on an
invented input, and `estimate-labor-cost.ts`'s rule applies: it never guesses a
rate *"because a wrong one gets bid"*.

**Present means TAGGED, never guessed**, the rule `jobs.prisma` already states
for `costCategory`, `craftClassificationId` and `phaseCodeId`. The
`IndirectLine` type carries no description at all, which is the strongest form
of that guarantee — the module *cannot* read one. And a tagged line with **no
cost** still counts as present: an estimator who added a cleanup line and left
it at zero has decided cleanup is free on this job, and saying "you have nothing
for cleanup" after that is arguing with somebody who already answered.

**It names what is absent and nothing else.** No verdict, no tick, no refusal —
`bid-responsiveness.ts`'s *"there is no 'compliant' verdict in this file"*,
`lien-waiver.ts`'s *"nothing here blocks a save"*, `addenda-overlap.ts`'s
*"names, never concludes"*. An estimate with no dumpster line is usually an
estimate that needs no dumpster. The copy says so: *"Add what applies, or leave
them out on purpose — they are not required and nothing here is checking up on
you."*

Each button prints the company's own figure **before** it is pressed, because
adding supervision quietly puts $2,400 on a bid. Where the company has
catalogued nothing it says "no figure yet" and adds a named line with no cost,
which is honest — and `bid-margin.ts` then reports the costless line rather than
this feature pretending to know what cleanup costs. The action is excluded from
Ask for the same reason: an assistant doing it on request would put a cost on an
estimate the person never saw.

Three censuses caught the registrations this owed and all three were right: the
export column census on both models, and the Ask command coverage census. A
fourth thing the compiler caught — `catalogLineFields` gaining a required field
broke the estimate-template path, which is exactly what a required field is for.

Migration `20261004120000_add_indirect_cost_kind`, purely additive, generated
`--from-schema-datamodel --to-schema-datamodel` and verified by comparison
against the generated SQL. Announced in `#prova-build` before the push.

565 test files, 8,800 unit tests, and the 63-file/632-test db suite run locally
against the new migration. Mutation-proved both ways — never report missing
(8 red), always report missing (6 red).
