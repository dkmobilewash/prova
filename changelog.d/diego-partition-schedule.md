### The partition schedule becomes wall types, with a thickness on them (Diego)

`diego/partition-schedule`

**Schema change, announced in `#prova-build` before the push:** one nullable
column, `WallType.thicknessIn Decimal(6,2)`. Migration
`20261011220000_add_wall_type_thickness`. Additive, nothing backfilled.

#### The gap this closes

The wall finder measures a wall's **thickness** off the sheet's own line work
and learns nothing else about it. The wall-type library knows the assembly, the
layers and the price, and **nothing about thickness**. So a detected group can
only be priced when the architect tagged that particular run — and an architect
tags *representative* walls, not every wall.

Measured on two pages of a real set: **25–43% of the footage carries a tag at
all.** On School-01 that leaves about 1,500 of 1,934 found feet unpriceable.

A partition schedule names every type **and its thickness** in one table. The
schedule reader already reads any table on a drawing and already knows a
partition schedule when it sees one (`kind: "PARTITION"`) — it just stopped
short of linking a row to anything, deliberately. This is the link.

#### The dangerous line, and why it is the narrowest

A partition description names several dimensions and only one is the wall:

> `3-5/8" MTL STUD, 5/8" GWB EA SIDE (4-7/8" TOTAL)`

Take the first and you get the **stud** — and the type built from it then
matches and prices every 3-5/8" group on the sheet as A1. **The footage looks
right and the assembly is wrong.**

So a dimension in free text counts **only where the schedule's own words call it
the total**. Anything else leaves the row for a person, which costs one line of
typing and cannot be wrong. A row with no readable thickness is dropped and
**counted back on screen**, because a schedule of six read as four is two wall
types quietly missing and nothing else would say so.

The first draft of the pattern read that example as **8 inches** — from a string
whose own answer is printed in it. Its own test caught it before anything else
did.

#### A new register in `action-capability-guards.test.ts`

The button sits on `/jobs/[id]/takeoff`, which withholds `VIEW_JOB_COSTS`, and
writes `WallType` rows — company data that outlives the job, guarded elsewhere
by `MANAGE_ESTIMATING`. On the page's capability an **accounting** member could
decide what A1 means for every future job.

Two existing registers refused the entry **by name**, and both were right:
`MIXED_DOORS` said *"its doors now agree"* (one page, not two);
`SECTION_DECIDED` said *"no page reaching it withholds several capabilities"*.
Every register assumed the page is at least as strict as the action.
`STRICTER_THAN_ITS_PAGE` is the shape that was missing, and its honesty cases
require the entry to still be stricter, still be reachable, and to **name the
render test that hides the control** — because a stricter guard nobody can see
is a dead button, which this repo has shipped before.

#### Checks

Preflight green. 9,980 unit tests, 4 new `.dbtest.ts` cases run against a real
Postgres with the migration applied.

**Nineteen mutations, nineteen red** — but three of them only after the tests
were fixed, and those three are the ones worth recording:

| mutation | why it was green |
| --- | --- |
| the proposal is not scoped to the company | both tenants held the **same** schedule, so the import was refused as a duplicate and the refusal looked like scoping. The other tenant now has its own marks |
| the page hands the button to everyone | `canAddWallTypes` with no value is `true` in JSX, and nothing rendered the page. A census covers it now, and says which half of the pair it is |
| a taken code is overwritten | needed a database; it is a constraint and a filter, not a value |

Two mutations stay green and are **documented as equivalent code** rather than
papered over: the alternation order inside the dimension pattern (the hyphen
rewrite upstream already settles it) and reading a height from the `size` cell
(unreachable — a cell with a foot mark never yields a thickness, so the row is
gone first).

#### What is NOT in this

No components on an imported type. A schedule says what a wall **is**; it does
not say what your supplier charges or what your crew hangs in an hour, and a
type that arrived looking priced would cost nothing real.

And nothing yet **matches** a detected group to these types by thickness — that
is the next PR, and the rule it implements is: tag first, then thickness, and
**ask** where two types share a thickness (A1 and A2 are both 4-7/8" on this
very sheet, differing by fire rating, which a floor plan cannot show).
