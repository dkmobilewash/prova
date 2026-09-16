### Catalog labor hours: what the field means is now written on it, and the decision behind it is NOT made (Cyrus)
`cyrus/catalog-labor-hours-meaning`

A catalog entry carries a `defaultLaborHours`. `addCatalogLine` copies it onto
the new estimate line **flat**, at every quantity, while `defaultUnitPrice` and
`defaultBudgetedUnitCost` are per-unit figures the job page multiplies out. So a
600 SF line and a 6 SF line built from the same entry carry identical labor
hours, and `estimateBurdenedLaborCost` prices both the same. The form said
"Default labor hrs" and the catalog row rendered a bare "8 hrs" directly beside
"$2.85/unit". Nothing anywhere said which of those two scaled. An estimator
could not tell, and neither could the person who checked after them. This
company bids 6-10 jobs a month off that number.

**The behaviour is unchanged. The labels are not.** Changing the arithmetic here
re-scales the labor burden on every catalog-sourced line already estimated, and
the evidence does not support doing it on this branch — see below. So the field
now states plainly what it does:

- `/catalog` add-entry form: **"Default labor hrs — whole line"**, with help text
  under the input — "Copied onto the line unchanged — a 6 SF line and a 600 SF
  line both get this many hours. Not a per-unit rate."
- `/catalog` entry row: `8 hrs/line`, deliberately the same `/…` shape as the
  `$2.85/unit` beside it, so the two read as the different things they are.
- The import screen's preview column is `Hrs/line`, and the help text says hours
  are for the whole line, will not scale, and store two decimals.
- The import's **"Show me an example"** sample no longer contains an Hours
  column. It used to hand people `0.012`, `0.03`, `0.02` — the per-unit
  productivity factors a real price list carries — which is the reading the code
  does not implement. Hours still import and are still previewed; the example
  just stopped teaching the wrong one.

`lib/estimating/catalog-line.test.ts` pins the behaviour at **quantity 1 and
quantity 100 explicitly**, asserting the same hours both times. That pairing is
the whole test: at quantity 1 flat and per-unit are indistinguishable, so a
single-quantity test cannot see this defect at all. Proved by mutation —
multiplying hours by quantity leaves the quantity-1 case GREEN and turns the
quantity-100 case red.

## OPEN QUESTION FOR A HUMAN — which reading is right is not settled

**The two writers of `defaultLaborHours` disagree with each other**, and neither
was ever documented. This is the finding, not the label:

| Writer | What it puts in the column |
| --- | --- |
| `saveLineItemAsCatalogEntry` | a line's TOTAL hours, copied in without dividing by quantity — flat |
| `importCatalogEntries` | a price list's hours column, which is a per-unit productivity factor |

Evidence for **flat**: `JobLineItem.laborHours` is documented in `jobs.prisma` as
"Estimated labor hours for this line"; `estimateBurdenedLaborCost` multiplies it
by a burdened hourly rate with no quantity anywhere; save-as-catalog round-trips
losslessly only under this reading; the field is named `defaultLaborHours` while
its two siblings are explicitly `defaultUnitPrice` / `defaultBudgetedUnitCost`,
so the missing "Unit" is a choice; and `Decimal(8, 2)` plus the form's
`step="0.01"` cannot represent a per-unit rate at all.

Evidence for **per-unit**: a catalog entry has no quantity, so a flat hours
default cannot be meaningful across the lines it creates; every other number on
the template is per unit; and the import path, its column aliases ("man hours",
"hours") and its own sample data all assume a productivity factor.

Two things follow that a person should decide:

1. **If per-unit is intended, it needs a migration.** `Decimal(8, 2)` silently
   rounds 0.012 hrs/SF to 0.01 — a 17% error before anything multiplies it.
   Migrations are announced before the push, so that could not happen here.
2. **Either way one of the two writers is wrong today.** Under flat, the CSV
   import is importing a per-unit rate into a per-line field (and truncating it).
   Under per-unit, save-as-catalog is failing to divide by quantity.

Nothing here touched the parser, the arithmetic, or the schema. What changed is
that the screen no longer hides which of the two it is.

## Coverage

This covers the catalog→estimate path only: `addCatalogLine` (the "Add from
catalog" form and the Ask command), and the labels on `/catalog` and its import
screen. It does NOT cover `draftEstimateLines`, which copies
`entry.defaultLaborHours` onto AI-drafted lines through the same flat path and
has no pinning test here, nor `saveLineItemAsCatalogEntry`'s flat copy in the
other direction — both are named above and left alone deliberately.
