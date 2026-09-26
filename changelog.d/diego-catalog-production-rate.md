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

**And the import stops degrading your price list.** This is the second half,
and it is the reason the column matters to anyone who did not want to type it
in by hand.

`importCatalogEntries` wrote a file's Hours column straight into
`defaultLaborHours`, which is **flat hours for a whole line**. A real price
list's Hours column is per-unit — the importer's own sample carried 0.012 for a
square foot of board — so a 600 SF line imported that way priced **0.012 hours**
of labor instead of 7.2, and `Decimal(8,2)` rounded it to 0.01 on the way in.
Two errors stacked, both silent, on the number that decides whether a bid makes
money.

**#514's own prescription was to map that column into the rate, and that is
worse.** They are reciprocals, so `hoursFromRate` computes `600 / 0.012` =
**50,000 hours** — wrong by 1/x², about 6,900× here. Inverting unconditionally
is no better: a list that genuinely says `60 SF/hr` inverts to 0.0167 and 600 SF
reads as **36,000 hours**. Both blind rules are catastrophic, in opposite
directions, and which convention a file uses is a fact about the file that no
code can derive.

**So the import asks — as a consequence, not as a unit.** "Is this hours per
unit or units per hour?" is a question a good estimator can read the wrong way
round at 6pm, and a misread question is worse than no question because it
produces a confident answer. The preview names a row out of their own file and
prices all three readings on it:

    5/8" Type X board reads 0.012 in the Hours column, per SF.
    So 100 SF would take:
      1.2 hrs      — hours per unit, the usual price-list column
      8333.33 hrs  — units per hour, a production rate
      0.01 hrs     — flat hours for the line, the same at any quantity

**Nobody in this trade picks 8,333 hours.** That is a check a foreman can make
in two seconds without knowing what a reciprocal is — the same move as a
takeoff calibration readback, which proves a scale by stating what it implies
rather than by naming the ratio.

Three details carry more than they look. Each figure is computed from the
number that would actually be **stored**, not the raw cell — `1/0.012` is
83.333… and the column holds four decimals, so quoting hours off the unrounded
value would promise something the product does not compute; it also makes the
flat reading's own loss visible as `0.01` rather than as a footnote. The
magnitudes **pre-select** only when they are decisive (all under 1, or all over
10) and otherwise select nothing and say the numbers do not settle it — the
band in between holds the real ambiguity, where a door assembly's `1.5` is as
plausibly hours-per-door as doors-per-hour. And the action **refuses** an
unanswered import rather than falling back, because every available fallback is
a guess about a labor figure.

**Checks.**

| | |
| --- | --- |
| suite | **7,900 pass** (490 files) |
| new tests | 59 — 5 on the pair's precedence, 10 in a writer census, 32 on the three readings, 8 on what the action writes and refuses |
| mutations | 8 run, 8 caught — one only after the census was rewritten to catch it |
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

### The mutations, because two of them are the fix's own worst version

| | Mutation | Result |
| --- | --- | --- |
| M1 | drop the rate from `catalogLineFields` | 4 red |
| M2 | flip `estimatedHours` precedence | 1 red |
| M3 | `wall-schedule.ts` back to pre-#514 | green → **rewrote the census** → 1 red |
| M4 | add a fourth writer of catalog-sourced lines | 1 red, names the file |
| M5 | import falls back to `FLAT` instead of refusing | 2 red |
| M6 | map the Hours column straight into the rate (**#514's literal prescription**) | 6 red |
| M7 | widen the lean to cover the 1–10 band | 1 red — the door-assembly case |
| M8 | write both labor columns on one row | 6 red |

M6 is the one worth keeping: the change the issue asked for is now a
six-assertion failure across the pure module and the action, so it cannot be
re-applied by somebody reading the issue instead of the code.

### Corrected along the way, because each would have been false on merge

Four sentences asserted the open question this closes, and one asserted a
column width wrong:

- `catalog-line.ts` said the two writers of `defaultLaborHours` "disagree with
  each other" — true for three weeks, and fixed by changing the import rather
  than that line, so nothing already estimated was re-scaled;
- `catalog-line.test.ts`'s header said it was "deliberately not an endorsement"
  of flat hours. It is one now;
- `/catalog`'s form comment called it "an open question recorded in
  changelog.d/…". The answer was *both, in two columns*;
- `CatalogImport`'s own copy told people to **leave the Hours column out of the
  file**. That was an honest description of a defect; it now says to keep it in,
  and the sample has the column back at the 0.012 / 0.03 / 0.02 a real drywall
  list carries;
- `hoursRenderCensus`'s exemption for the catalog's hours said `Decimal(5,2)`;
  the column has always been `(8,2)`. The argument is unaffected, which is
  exactly why nobody noticed.

The bounds on a production rate are now shared between the typed field and the
importer instead of being literals in each — a typed rate and an imported one
land in the same column and are read by the same function, so a bound that
applies to one and not the other is a hole shaped exactly like the bulk path
nobody checks by hand.
