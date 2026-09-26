### The price book learns how fast the crew works (Diego)
`diego/catalog-production-rate`

**What was wrong.** #435 gave a production rate — units per hour — to
`JobLineItem` and to `WallTypeComponent`, and the actual-productivity
back-check reads it: hours logged against a line become an achieved rate and
get compared to what the bid assumed. It never reached the catalog. So the one
artefact that ACCUMULATES a company's productivity knowledge was the only place
carrying labor that could not hold a rate, and a line priced from the price
book had nothing for the back-check to compare against. `jobs.prisma`'s own
comment on that column pointed straight at the gap.

The visible half was worse than a missing column. `LineItemCatalogEntry` had
`defaultLaborHours`, which is **flat for the whole line** — a 6 SF line and a
600 SF line built from the same entry carry identical hours. That is pinned at
two quantities by `catalog-line.test.ts`, deliberately, because a
single-quantity test cannot tell flat from per-unit and that is how the
ambiguity survived.

**What changed.** `LineItemCatalogEntry.productionRate`, `Decimal(10,4)` —
the same units and the same precision as the line's, because two spellings of
one number is how this pair got confusing in the first place. A catalog-sourced
line inherits it, from all four writers. Nullable with **no backfill**, and the
absence of a backfill is the decision: flat hours cannot be converted into a
rate without the quantity they were measured over, and nothing recorded it. So
existing entries read as "no rate", which is true, rather than as a
productivity assumption nobody made.

**The fourth writer, which is the part worth reading.** `catalogLineFields`
exists because two writers of catalog-sourced lines would drift; its own
docstring says so. There were **four**, and only one goes through it —
`draft-lines.ts` and `wall-schedule.ts` each build their own `data` literal.
Adding the rate to the shared mapping and the AI draft would have left
`syncWallScheduleLines` — a wall type's whole board, stud and track take-off,
which on a framing bid is *most* of the labor — outside the back-check while
every hand-typed line was inside it, with the full suite green, because a field
you do not write is not an error. It was found by grep.

`syncWallScheduleLines` turned out to be the case with the most in it: it
already divides quantity by the component's rate to get hours and then threw
the rate away, so the figure the back-check needs was computed and discarded.
Both branches now write it, create and update, because writing the hours
without the rate is how a line ends up priced at this month's productivity and
back-checked against last month's.

**Both figures may be set, and the flat hours win.** That precedence is
`estimatedHours()`'s, not a new one — the mapping copies the pair onto the line
and the line decides, so the catalog cannot come to mean something different
from the line it creates. A rate that loses is *inert*: it divides nothing and
still reads like the assumption a bid was built on, so `/catalog` prints
`(unused — hrs/line wins)` beside it and the form's help text says it before
anyone types.

**What this deliberately did NOT do.** `importCatalogEntries` still writes
`defaultLaborHours`. A price list's "Hours" column carries hours **per unit**
(0.012 hr/SF) and this column is units **per hour** (83.33 SF/hr) — reciprocals
— so mapping one to the other overstates labor by 1/x²: 600 SF at 0.012 read as
a rate is **50,000 hours instead of 7.2**, a ~6,900× error feeding a bid. Which
convention a given file uses is a fact about the file, and the app cannot know
it. That is its own change, with a person confirming the conversion against a
real row from their own sheet before it is applied.

**Checks.**

| | |
| --- | --- |
| suite | **7,841 pass** (488 files) |
| new tests | 15 — 5 on the pair's precedence, 10 in a writer census |
| mutations | 4 run, 4 caught — one of them only after the census was rewritten to catch it |
| typecheck / lint | 0 errors |
| migration | one additive nullable column, no backfill, nothing dropped |

`catalogLineWriterCensus.test.ts` derives the writer set from `git ls-files`,
pins it against a literal, and requires the rate in **the same object literal**
as the row. Its first version asserted only that `productionRate` appeared
somewhere in each file — and mutating `wall-schedule.ts` back to its real
pre-#514 state left all seven tests green, because that file mentions the rate
sixty lines earlier while building its inputs. A census that cannot fail on the
bug it was built from is the vacuous green this repo keeps paying for, so it
reads the literal now; the same mutation is red. Its own controls also caught a
backtracking bug in its regex (`…:\s*(?!true\b)` matches `: true`, because
`\s*` gives back the space it needs), which is the argument for writing the
control even when the pattern looks obvious.
