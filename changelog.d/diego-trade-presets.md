### A new company picks its trade in one tap, and is asked its own markup

Guided flow Phase 5. `/welcome` now opens on **What's your trade?**: framing and drywall,
acoustical ceilings, plaster and EIFS, fireproofing, or something else. The tap sets
starting values, every one editable afterwards:

- the company's trade scopes;
- starter wall types and assemblies;
- the takeoff switches;
- one starter estimate template.

It sets **no price and no percentage** (Diego, 2026-11-05). The next step asks for the
company's own material markup, labor markup, overhead and profit, in empty boxes, and saves
them to the company's bid defaults. "Later" leaves them blank. Until all four are set, the
estimate shows a **Set your markup** banner and the job stepper's Estimate step is not done.

Switches by trade, as Diego decided: ceilings turn doors and windows off; plaster and EIFS
turn rooms off; fireproofing turns whole-set walls and doors off and keeps rooms on, because
deck fireproofing is priced by floor area. Scanned sheets and plan comparison stay off for
every trade. Plaster, EIFS and fireproofing got starter assemblies of their own (PL1, EIFS1,
FP1, FP2), kept out of the Wall types page's own "Add starter wall types" button so it offers
what it always has.

**Existing companies are unchanged, by construction.** The new column
`Company.tradePresetAskedAt` is null for every company that predates it, and the banner and
the stepper rule read it. The preset action also refuses any company whose onboarding is
already behind it; a database test pins that and was mutation-checked. The trade step's
**Skip for now** is today's skip, with nothing preset and no markup owed.
