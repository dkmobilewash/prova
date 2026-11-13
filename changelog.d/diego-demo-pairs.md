### Renovation sheets pair with their demolition plan when the titles tie: the new plan of the same extent (Diego)
`diego/demo-pairs`

The second found that `autoPairs` paired none of Round 22's renovation sheets. Two of the three had a demolition floor plan the pairer could see and still dropped: past the title filters it kept every plan of the right kind and refused any tie.

- **UCCS:** AD2.1 "DEMOLITION FLOOR PLAN - OVERALL" tied A2.1.1 OVERALL with three AREA sheets.
- **Macon-Bibb:** AD-1 tied A1-1 "NEW WORK" with A1-0 "FLOOR PLAN - EXISTING" and a canopy plan.

Now a whole-floor demolition plan keeps the whole-floor plans, a plan only of what EXISTS drops out, and a plan that says NEW wins. Each step only narrows, so a tie it cannot break still pairs nothing.

UCCS A2.1.2 itself stays unpaired, deliberately: its area sheets are 1/8" and the demolition plan is the overall drawing, and comparison reads a demolition plan at the new sheet's scale. Aspen A1.1 has no architectural demolition plan at all; its AD0.1 is a saw-cut plan.

Check: `pairDemoPlans.test.ts` ("Round 22: … the new plan of the demolition plan's extent") fails on the old pairer. Sweep of all 38 training sets, the old pairer against the new: 2 new pairs (UCCS A2.1.1 ← AD2.1, Macon-Bibb A1-1 ← AD-1), 0 lost, 0 changed.
