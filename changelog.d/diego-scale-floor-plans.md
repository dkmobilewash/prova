### Confirm scales says the floor plans are still to do, and the stepper names them

Found on the new-customer run on Baker: "Confirm 4 scales" confirmed the RCP, roof and foundation plans, while both floor plans that matter stayed "Printed only", each needing its own press. The stepper's Next kept saying "Confirm the scales", and nothing said the floor plans were the ones left.

- **The plan set panel** (`PlanSetScales.tsx`):
  - When floor plans need a look, a line under Confirm says what it covers and that the floor plans need their own.
  - Its message after confirming counts the floor plans still to do.
  - When nothing sure is left, the header is a link, "N floor plans still to do ↓", in place of a disabled Confirm scales.
- **The stepper's Next** names the floor plans whenever the set has any ("Scale 4 floor plans", then "Scale 1 more floor plan"). "Confirm the scales" is only for a set nothing has sorted.
- **Not done: a bulk "use the printed scale"**. `confirmSheetScales` refuses `usePrinted` on more than one sheet on purpose (#982): nothing on the sheet confirms a printed-only scale, so it stays one press a sheet.
