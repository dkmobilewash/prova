### Confirm scales says the floor plans are still to do, and one press uses the printed scale on all of them

Found on the new-customer run on Baker: "Confirm 4 scales" confirmed the RCP, roof and foundation plans, while both floor plans that matter stayed "Printed only", each needing its own press. The stepper's Next kept saying "Confirm the scales".

- **The plan set panel** (`PlanSetScales.tsx`):
  - When floor plans need a look, a line under Confirm says what it covers and that the floor plans need their own.
  - Its message after confirming counts the floor plans still to do.
  - When nothing sure is left, the header is a link, "N floor plans still to do ↓", in place of a disabled Confirm scales.
- **"Use the printed scale on all N"** sits on the "Floor plans that need a look" box whenever two or more of them offer it. It is one press, with the same `confirmSheetScales(…, usePrinted)` as each row's own button.
- **The stepper's Next** names the floor plans whenever the set has any ("Scale 4 floor plans", then "Scale 1 more floor plan"). "Confirm the scales" is only for a set nothing has sorted.
