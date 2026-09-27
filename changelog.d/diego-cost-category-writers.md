### The more of the automation you used, the less of your bid got marked up (Diego)
`diego/cost-category-writers`

`bid-recap.ts` states its rule plainly, and the rule is right:

> AN UNCATEGORISED LINE IS NEVER MARKED UP… The alternative — quietly marking it
> up at some default — is how a bid grows a number nobody chose.

**Not one of the four automated line-creating paths set `costCategory`.** Not
`addCatalogLine`, not `syncWallScheduleLines`, not the AI drafter, not
`createLineItemRows`. And none of the three templates carried one to pass
through, so there was nothing to inherit even in principle.

So every line the product generated for you landed uncoded and was carried into
the bid at direct cost. **A bid built entirely from wall types, plan takeoff and
the catalog — the workflow the last three weeks went into — carried zero markup
until somebody hand-coded every row.** On every bid. Forever. Re-coding the same
catalog entry on the fourth job this month is exactly the retyping a price book
exists to end.

Issue #513. One migration, additive: **two nullable columns, no backfill.**

**And #524 had just sharpened it.** Making the cost side visible means a
wall-schedule line now shows a perfectly good cost, sits in the direct total, and
still earns nothing — the two halves of the same bid arriving from different
directions.

### Where the field lives, and where it deliberately does not

- **`LineItemCatalogEntry.costCategory`** — "5/8" Type X board" is material every
  time it is used, and saying so once is the argument for a price book.
- **`WallTypeComponent.costCategory`** — board and studs are material, the
  hang-and-finish component is labor, and **a wall type is the one place that is
  knowable up front**. Set once when the type is built; every run of W2 on every
  job inherits it.
- **`EstimateTemplateItem` gets no column.** It inherits through its catalog
  entry, which is how it already inherits price, cost, hours and rate via
  `catalogLineFields`. A template item with no entry gets null — the same as it
  gets no price today.

**Takeoff is the fourth writer and has no template to inherit from**, so each
RECIPE declares its own category in `takeoff-recipes.ts` rather than one being
inferred from a label. Every current recipe is MATERIAL, and that is not a
coincidence to lean on: a recipe turns a measurement into quantities of *stuff*,
and labor on this app lives in `laborHours`/`productionRate` on the line, not in a
line of its own. A recipe that one day produces a labor line says so in one place.

### The precedence rule, which is new

On a wall component: **the component first, its catalog entry second, null if
neither.** The component is the more specific statement — a wall type may use a
board entry for its finishing component, and the assembly is the better authority
— and it is the same order `craftClassificationId` uses one line below it in the
same literal.

`wallScheduleCostCategory.test.ts` pins it, including the disagreement case. That
writer got its own test because it produces the largest block of a framing bid,
and because `syncWallScheduleLines` takes its transaction client as a parameter —
so the test needs no database and no Prisma mock module, just an object with four
methods. The function's own design paying off.

### No backfill, and the backfill that suggests itself is the bug

Reading the description — "board" and "stud" are material, "hang" and "finish"
are labor — is exactly the guess these columns replace. It would also be wrong in
the direction nobody checks: a mis-inferred MATERIAL on a labor line applies the
material markup rate to labor, silently, on the number a bid is made from.

So an entry nobody has coded reads as uncoded, `/catalog` says **"no cost type —
won't be marked up"** on the row, and an estimator codes it once per item instead
of once per bid.

### One question answered with precedent rather than a new decision

The issue asks whether Apply should **refuse** while lines are uncoded rather
than only reporting. No — Diego answered the identical question for the
price-with-no-cost case in #524 (warn loudly, still allow Apply), and two
different answers to the same shape on the same panel would be worse than either.

### Also refused: two silent coercions

`createLineItemCatalogEntry` and `saveWallTypeComponent` both **refuse** an
unrecognised cost type rather than nulling it. That is #525's defect —
`setLineCostCategory` silently cleared a line's category on a typo and returned
success — not reintroduced in two new places on the day it was fixed in the third.
An empty string is each form's own "no cost type" and still clears.

### Rebased onto #526, which landed first and changed the enum underneath this

#526 merged while this was open: it added **EQUIPMENT** to `CostCategory` and ended
what it called the enum's "eight hand-written copies" — a ninth is what produced a
NaN bid total — by making `lib/cost-category.ts` the one list and `asCostCategory`
the one validator.

Two consequences, both good:

- **EQUIPMENT appears in both new selects for free.** They render
  `COST_CATEGORY_ORDER`, which is now `COST_CATEGORY_VALUES`, so the new cost-type
  fields on `/catalog` and `/wall-types` offer it without an edit.
- **This PR was about to add copies nine and ten.** It hand-rolled the membership
  check in `createLineItemCatalogEntry` and `saveWallTypeComponent` — on the same
  afternoon #526 removed eight of them. Both now call `asCostCategory`. The one
  thing that helper cannot do is tell a CLEARED field from a bad one (both are
  "not a category" and they need different answers), so the empty-string check
  stays and the refusal stays.

One conflict, in `FEATURE-AUDIT.md`: both PRs rewrote the cost-categorisation row.
Resolved by keeping #526's row — including its **Built** status, since EQUIPMENT
closed the gap that made it Partial, and reverting that would also desync the
sheet header #526 already corrected — and appending this PR's sentence to the same
cell.

### Checks

| | |
| --- | --- |
| suite | **8,058 pass** (495 files) |
| new tests | 8 |
| mutations | 3 run, **3 caught** |
| typecheck / lint | 0 errors |
| migration | one, additive, two nullable columns, no backfill |

| | Mutation | Result |
| --- | --- | --- |
| M1 | default to MATERIAL when neither is set | 2 red |
| M2 | reverse the precedence (entry beats component) | 1 red |
| M3 | the shared mapping stops carrying it — the original defect | 4 red, one of them the census by name |

`catalogLineWriterCensus.test.ts` from #521 already derived the writer set from
`git ls-files` and required `productionRate` in each writer's own object literal.
Extending it to a LIST of inherited fields was one edit, and it means a fifth
writer that forgets either one fails by name — which is how M3 got caught twice.
