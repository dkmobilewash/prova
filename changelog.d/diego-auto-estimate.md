### A confirmed wall type turns into its whole material list, priced only from the company's own book

**The assembly is complete.** A type added from the legend used to buy studs, track, board and insulation, and nothing else. It now also gets:

- drywall screws, per thousand;
- joint tape;
- joint compound, plus a skim allowance where the spec calls for Level 5;
- deflection track, where the legend runs the wall to the deck or the spec names it. The top track becomes deflection track and the bottom stays plain.

**Board is counted in 4x8 sheets.** Every material carries waste.

**Filled from the spec, never over the legend.** The spec fills only what the legend leaves out: a gauge, Type X, Level 5. Each filled value names its section. A legend lighter than the spec keeps the legend and writes the conflict into the type's notes.

**Quantity factors and waste are the company's own.** They are under Wall types → Quantity standards, stored on `CompanyBidDefaults.assemblyStandards` (an additive migration). They start from the published drywall figures. Board waste follows the company's existing waste figure.

**Prices come only from the catalog.**
- A part takes a catalog entry only when it is the same material in the same unit. Two candidate entries price neither.
- Everything else shows once in **Price these N materials** at the top of the estimate. A cost typed there becomes a catalog entry, prices every line of that material through the markup, and teaches the wall-type parts.

**Not computed: corner bead.** The takeoff does not measure outside corners, so the type's notes say so.

**Screws are counted per thousand on purpose.** Unit prices hold cents, so a $0.022 screw stores as $0.02 and loses its markup.

**Checked by hand on four types,** Baker's S6B, C8B and S6A and USU's PS2a, line by line. All were within 0.0% (`autoEstimate.eval.ts`, keyless). USU is held out and was used only as arithmetic input.
