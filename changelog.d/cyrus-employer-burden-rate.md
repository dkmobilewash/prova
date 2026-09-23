### Employer burden: the screen stops saying "burdened" when it isn't, and there is now a way to make it true (Cyrus)
`cyrus/employer-burden-rate`

**Nobody's existing numbers move.** Until an owner records a burden
percentage, every job's cost to date, percent complete, earned revenue and
WIP line comes out exactly as it did before this branch — the same float
sum in the same order, not an approximation of it. That is pinned by
`employer-burden.test.ts` ("with no rate recorded, nothing moves"), and the
mutation that makes the no-rate default 7.65% instead of nothing turns it
red with `expected 75.74 to be +0`.

**What was wrong.** `lib/labor-cost.ts` prices a logged hour as base wage ×
pay-type multiplier + the four CBA fringes and stops. No employer FICA, no
FUTA/SUTA, no workers' comp. That file was always accurate about it and so
was `lib/wip.ts` ("base plus fringes"). The SCREEN was not: the job-cost
caption read "logged hours costed at the craft's **burdened rate**", and to
a contractor "burdened" means fully loaded. So `actualCostToDate` was
understated and, because percent complete is cost-to-cost, it was
OVERSTATED — the direction that hurts, on a figure that feeds the WIP
schedule a surety reads. On 1,000 straight-time hours at a $48 base,
employer FICA alone is $3,672 that was not in the number, before comp.

**The wording fix stands on its own and is true today.** Where no burden
rate is in force the job-cost screens now say "wage and fringes". The
sentence is generated from the data (`laborCostBasisLabel`), so it names the
percentage once one is recorded and goes back to "wage and fringes" if it is
removed. It cannot drift from the arithmetic, because it is computed from
the same rates.

**The real fix.** `EmployerBurdenRate` — company-scoped, effective-dated,
owner-only, recorded on Settings. Copied from `ExperienceModRate`: no stored
"current" (which rate applies is derived from the dates, per CLAUDE.md), the
effective date ENTERED and never stamped, inline row edit, two-step delete.
The rate is picked PER TIME ENTRY from the day the hours were worked, not
from today, so recording next year's percentage cannot silently restate a
figure already sent to a GC.

**The percentage multiplies the BASE WAGE only, not the fringes**, because
bona fide contributions to a benefit plan are generally outside the wage base
employer payroll taxes are computed on. **That is a modelling choice a CPA
should confirm, not a tax rule anybody here verified** — said in the file
header, in the schema, and on the screen where the number is entered.
Overtime follows automatically: the burden is taken on the multiplied base.

**Checks behind it.** 28 cases in `employer-burden.test.ts` — base-only,
overtime and double-time, a rate changing mid-year including the boundary
day itself, money accumulated and rounded once in cents, zero and an absurd
percentage. Three mutations were run and each went red with the message
named: burdening the fringes too (`expected 81.6 to be 54`), defaulting to
7.65% (`expected 75.74 to be +0`), and treating a rate dated today as not
yet in force (`expected 10 to be 20`). `employerBurdenCensus.test.ts` is the
other half: the burden parameter defaults to "none" so that no-rate
companies are safe, which makes forgetting to pass it silent — so the census
requires every job-cost surface to pass it and every file loading fringe
schedules to load the burden beside them. Dropping it from one call site
turns the census red naming that file. It also asserts the OPPOSITE for
`certified-payroll.ts`, `wh347.ts` and `fringe-remittance.ts`: an employer
payroll tax inside a WH-347 is a wrong federal form, so those modules must
not be able to reach the burden at all.

Migration `20260922120000_add_employer_burden_rate` is additive — one new
table, its index, two foreign keys and a `percent >= 0` CHECK. No backfill
and no default, deliberately: an empty table is what keeps every existing
figure identical.
