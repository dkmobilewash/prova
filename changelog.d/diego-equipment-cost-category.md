### Equipment is its own cost category, and the enum stops having eight copies (Diego)
`diego/equipment-cost-category`

**Lifts, scaffold and boom lifts were priced at the Other rate.** For a framing
or drywall sub that is a real cost centre hired by the week, and `CostCategory`
had no member for it — the Estimate tab's markup field was literally labelled
"Other / equipment markup", one rate doing two jobs. It is two fields now, with
`equipmentMarkupPercent` on `JobBidRecap` and on `CompanyBidDefaults`.

**Adding the fifth value would have shipped a NaN bid total, and that is the
reason this took a day.** `CostCategory` had EIGHT hand-written copies across
the app and exactly one of them was guarded. Proved with a probe against the
real function before changing anything — a $2,500 equipment line and $1,200 of
material returned

    byCategory: {"MATERIAL":1200,…,"EQUIPMENT":null}
    total: NaN

because `directCostByCategory` does `byCategory[category] += extended` and
`undefined + 2500` is NaN. It flows into markup, sales tax and the bid total,
and **serialises to blank rather than to anything that looks wrong** — on the
document somebody prices work from.

**What made it invisible was not the missing guard, it was the cast.** Two call
sites read a row and wrote `row.costCategory as CostCategoryValue | null`, which
asserts that the database only ever holds values this build knows — the claim
that stops being true the moment the enum grows. TypeScript had the information
and was told to ignore it. `asCostCategory` replaces the casts and NARROWS, so
an unrecognised value is null and shows as an uncategorised line, which the
screen already offers to fix.

`lib/cost-category.ts` is the one list now; the other copies re-export it. The
accumulator narrows again internally and derives its zero-initialised buckets
from that list, so it cannot be handed a key it does not have — which covers
callers in other lanes too, including Ask's.

**Three lists that could be INCOMPLETE are now total `Record`s over their
union**, and this is the transferable part. An array cannot be incomplete in a
way anything notices; it just silently omits a member. Each of these omissions
is a money bug with no error attached:

| list | what a missing member did |
| --- | --- |
| `MARKUP` (bid-recap) | that category marked up at **nothing** — a low bid |
| `RATE_LABELS` (the action) | that rate never parsed — the field **saves nothing** |
| `RATE_FIELD_SPECS` (the form) | no input — a rate **nobody can ever set** |

A `Record` over the union does not compile until every member is wired, so the
next category added stops the build instead of quietly shipping a wrong number.
Nine mutation checks, every one red and naming its own offender; the one that
removes the accumulator's narrowing fails with *"the total went NaN again"*.

**THE MIGRATION SPLITS HISTORY AND NOTHING CAN UN-SPLIT IT.** Equipment booked
before 2026-09-26 is `OTHER`, and no backfill is possible — the data does not
record which `OTHER` rows were equipment, and guessing would invent cost
attribution on real jobs. So an equipment figure is complete going forward and
understated for earlier work, and `OTHER` is correspondingly overstated.
`EQUIPMENT_SPLIT_NOTE` says exactly that on screen, shown only when an equipment
or other figure is actually present — a permanent notice is noise that teaches
people to stop reading notices.

Additive only: one enum value, two nullable columns. `ADD VALUE … BEFORE
'OTHER'` rather than a bare append, because Postgres orders an enum column by
the value's position in the type — appending would put EQUIPMENT after the
fallback in every `ORDER BY` while `jobs.prisma` declares it before, a
disagreement between the schema file and the database that nothing reports.

**No EQUIPMENT row in `QUICKBOOKS_ACCOUNT_PURPOSES`, deliberately**, with the
reason recorded there rather than left for someone to wonder about: every lookup
of that table asks for `INCOME` or `DEPOSIT`, so the four cost purposes are read
by nothing — Prova pushes invoices and payments, not costs. A fifth row would
store a value nobody reads while telling an owner, by existing, that their
equipment costs land in the account they picked. Its one live defect is fixed:
`OTHER`'s hint read "Equipment, permits, anything else." and was pointing owners
at the wrong bucket.

Two smaller things worth keeping. `costCategoryLabels.test.ts`'s anti-vacuity
count is a FLOOR now — it was `toBe(4)` and went red on a legitimate enum
addition while the real census beside it was fine. And the unknown-value test
used `"EQUIPMENT"` as the token the enum could never hold, one commit before the
enum held it; the replacement asserts its own premise, because a test whose
subject is "a value this build has never heard of" is one enum addition away
from having no subject at all.
