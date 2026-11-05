### The stepper reviews before it sends, opens the right sheet, and does not call footage an estimate

From Chrome's re-test and Diego.

- **Review comes before Estimate and Send.** Plain walls now reach the estimate on their own (#974), so a job can have a line while walls still wait "to confirm". Once something is taken off, the bar stays on Review until nothing is left to accept, and only then moves on.
- **An unpriced line is not an estimate.** Estimate is done only when the estimate has lines and none of them has neither a price nor a cost. A cost-only line is priced through the bid recap's markup, so it counts as priced. A $0.00 bid now reads "Next: Price 1 line on the estimate" (to the estimate tab), not "Send it for signature".
- **Each step opens the right sheet** (`lib/takeoff/startPage.ts`, chosen from facts the workspace already loads):
  - **Scale** opens the workspace on the first sheet, in page order, with no scale and a title that does not say it is something else.
  - **Takeoff** opens on the sheet last measured on, else the best-ranked floor plan. The workspace used to open on the set's first page, which on a real bid is a cover sheet.
  - **Review** opens on the first sheet holding a wall to confirm, with Needs review open.
  - The same choice now applies to any link to the workspace without `?page=`.

Check:
- `job-steps.test.ts`: Review held ahead of Estimate and Send while walls wait, even with a line and a sent link; an unpriced line keeps Estimate current with "Price N lines"; Scale, Takeoff and Review hrefs.
- `startPage.test.ts`: the best floor plan over a cover, a demolition sheet and an elevation; the last sheet worked once there is one; Scale's first unscaled sheet; Review's first held sheet; the fallback to page one.
- `job-stepper.spec.ts` 3: Scale opens `/takeoff/<id>?open=scale` in a new tab, on the workspace. Spec 5: after one plain group, Estimate is current with "Next: Price 1 line on the estimate", which goes to the footage line.
- Local click list R5-3c (Baker): `?open=review` opens on the first held sheet with Needs review open; no `?page=` opens on the sheet last measured on.
