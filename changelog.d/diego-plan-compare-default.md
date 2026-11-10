### Plan comparison is on for a new company

Diego, 2026-11-08: "Compare renovation sheets with their demolition plan" uses
no model, and without it a renovation set is priced as new work. The no-AI walk
on Green Bay and E Street named no sheet, paired no demolition plan, and bid
existing walls that the proposal's own exclusions leave out.

New companies are created with `planCompareOn: true` in `lib/auth.ts`, the same
place plan reading is switched on. The column default stays `false`, so no
existing company changes and **no migration** runs.
`planCompareWiring.test.ts` pins both.
