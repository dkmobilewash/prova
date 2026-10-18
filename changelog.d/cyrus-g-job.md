### A job reads as five stages now, not nine tabs (Cyrus)
`cyrus/g-job`

The job page opens on what a sub actually asks: contract, billed to date,
left to bill, and where the job is — Estimate, Contract, Crew, Billing,
Closeout, each step with one real line ("Signed · 2 COs", "14 on crew",
"Pay app #4 due Oct 17"). The nine old tabs are not gone; each one is filed
under a stage and appears as a small row of links when that stage is open,
and every tab URL still works because the stages are only a navigation
layer over the same routes. `components/job/jobStages.test.ts` checks the
stages' links against the old rail for all 32 viewer/job-stage combinations,
so a tab cannot quietly fall out.

The Billing tab opens on the latest pay application — this period, retainage
held, what you'll be paid, and a billed-before / this-period / left bar —
read off the same certificate its Review page prints (`loadPayApplication`),
so the two cannot disagree. With no pay application it says so and offers
to start one; it never shows a number it does not have.

The Paperwork panel (RFIs, submittals, punch list, drawings, material
orders, change orders) sits beside the open stage on a wide screen and below
it on a phone, already filtered to the job. On a phone the stages become a
sideways row of pills that scrolls the open one into view.

Not here because the data does not exist: the header has no trade, job
number or PM (the Job model stores none of them), and the Estimate step says
"Won" without a date (no award date is recorded). "Edit line items" became
"Start pay app #N": a submitted pay application is not editable, and the
schedule of values sits behind a capability some billing users lack.
