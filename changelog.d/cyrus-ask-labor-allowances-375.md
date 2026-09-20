### Ask's labor-cost tool agrees with the job page again (Cyrus)
`cyrus/ask-labor-allowances-375`

Issue #375: `job_labor_cost` — the Ask tool that answers "what has the crew
cost us on this job" — hand-rolled its own total from
`calculateTimeEntryLaborCost` and never added `TimeEntry.perDiemAmount` or
`.travelPayAmount`. Every other money surface (`/jobs/[id]`, `job_margin`,
the WIP schedule, the catalog, `/phase-codes`) prices labor through
`calculateBurdenedLaborCost`, which adds those allowances behind the
`LABOR_ALLOWANCES_IN_JOB_COST` flag — so on a job with per diem logged, Ask
quoted a lower number than the page for the same job. It does not matter
much which figure was "right"; it matters that a contractor asking Ask a
money question got a different answer than the screen they could check it
against, and the two disagreeing silently is the failure a pilot with real
union subs cannot absorb.

Chosen: route through the shared helper (`laborCostForRows`, its
whole-job-list entry point) rather than keep a distinct wages-only figure
with a disclaimer. One number everywhere is how every other money surface
here already behaves, and Ask disagreeing with its own app is worse than
either number being debatable. The tool now also returns `wageCost` and
`allowanceCost` split out, and its description tells the model to always
read `shareOfHoursPriced` beside the total — a job can show a real nonzero
figure built entirely from per diem while its wage hours are still 0%
priced, and the total alone would misstate that as "labor is priced."

Also closes a blind spot #369 named on its way out: its job-cost census
only ever looks at a file that calls `calculateLineItemWip(` or selects
`CostEntry` rows, and `job_labor_cost` is neither (it is a labor-only
figure, not a WIP/percent-complete one, and it deliberately never touches
material/equipment/subcontract cost). `jobCostCensus.test.ts` gets a second
rule keyed on `calculateTimeEntryLaborCost` callers instead: any file that
prices individual entries must also add allowances (via
`calculateBurdenedLaborCost`/`laborCostForRows`) or handle
`perDiemAmount`/`travelPayAmount` itself for a documented reason. Two
legitimate exceptions checked by hand, not assumed: `estimate-labor-cost.ts`
(bid-time forecast — no `TimeEntry` row exists yet to carry an allowance)
and `certified-payroll.ts` (reports per diem/travel as their own WH-347
columns rather than folding them into wages, which the new rule accepts
because it references both fields directly).

The regression that mattered: `handlers.laborCostAgreement.test.ts` computes
"the job page's figure" through the same un-mocked `unassignedLaborCost` +
`calculateJobWip` the page itself uses, and checks it against Ask's own
`burdenedLaborCost` for a job with per diem. Run against the pre-fix
handler it fails for the right reason — $320 (wage only) vs $520 (wage +
per diem) — not a mock-shape crash.
