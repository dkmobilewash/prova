### Send: the proposal the GC gets says the scope, the clauses and the terms

The guided flow's last step hands the GC a signing link (`/esign/<token>`), and that page
was the line items and a total. It now also shows what a sub's proposal says:

- **Scope by wall type**, with the takeoff's linear feet, height and square feet —
  `wallScope`, beside the estimate-line sync in `takeoff-item-lines.ts`, from the same
  items, heights, sides and opening rule the lines are priced from, so the scope and the
  price cannot disagree. Walls with no type yet are one row of feet.
- **Inclusions, exclusions, clarifications and alternates**, the job's own clauses.
- **Terms on file**: the GC's payment terms and the retainage, the job's own over the
  GC's default. Nothing is invented when none is on file.

All three are frozen into the signature's snapshot when the GC signs, so the signed copy
keeps showing what was agreed when the job changes later; a signature made before this
renders as it always did. The job's proposal page shows the same scope and terms.

The stepper's Send asks for the clauses first: with no inclusion and no exclusion on the
job, its Next is "Add inclusions and exclusions" and opens the proposal's clauses. A
nudge, not a lock — a link sent without them still counts as sent.

`gc-proposal.spec.ts` walks it: Next asks for the clauses, they are added, the link is
made, the GC reads 50 LF and 1,000 SF, both clauses, $5,130.00 and the terms signed
out, signs, and the signed copy keeps the clauses after one is added to the job.
