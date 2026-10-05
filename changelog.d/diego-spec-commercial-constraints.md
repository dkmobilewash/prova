### The spec reader could not see a liquidated-damages clause (Diego)
`diego/spec-commercial-constraints`

The estimating audit's stage 1.3 asks the spec reader to *"scan spec books to
extract job-specific constraints (e.g. liquidated damages, working hour
restrictions, wage requirements)"*. It found none of the three, and not because
it read them badly — **it refused to read the pages they are on.** Prompt rule 8
rejected "an invitation to bid" and rule 9 rejected any division that is not
these trades, so a Division 00/01 section came back with an empty findings list
and a sentence saying which division it appeared to be.

That is the expensive kind of gap: the feature looked like it was working.

## What now gets read

Three kinds, and only three. `GENERAL` still catches everything else, because a
vocabulary that grows by guess is the defect rather than the fix.

| kind | what it is |
| --- | --- |
| `LIQUIDATED_DAMAGES` | a per-day amount for finishing late |
| `WORKING_HOURS` | restricted hours, night or weekend work, noise windows, an occupied building |
| `WAGE_REQUIREMENT` | prevailing or union scale, certified payroll, apprenticeship ratios |

New rule 9a says in as many words why these are not rule 9's problem: Division
00/01 is **not another trade's work**, it is the contract conditions that bind
every trade on the job, this subcontractor included. They are missed for one
structural reason — an estimator reading their own trade's spec never sees them.

**Rule 11 is the one that keeps this from doing harm.** A contract term costs
money differently from a material, and `whyItCosts` has to say which: *"$2,500
per calendar day"* is an exposure if the work runs late, not $2,500 of cost,
while restricted hours and prevailing wages change the RATE of every hour
worked. The reader states the mechanism and the document's own number, and never
a figure it worked out itself — it has not seen the schedule, the crew or the
wage sheet. Rule 3 already forbade saying whether the bid carries it.

**And rule 8 got tighter rather than looser**, which is the half a reader of
this entry would not expect. A document whose PURPOSE is to solicit a bid still
returns nothing, even when it mentions bonds or a completion date in passing —
those terms belong to the contract documents it points *at*, so reporting them
from there reports the same requirement twice from the weaker source. The new
`solicitation-with-terms` eval case is that boundary: an Instructions to Bidders
that name-drops liquidated damages and prevailing wage must still find nothing.
Without it, admitting Division 00/01 would have quietly turned every bid
solicitation into a findings list.

## The gap found while planning, which is worth more than the feature

`BidSpecFindingKind` was **referenced by nothing**. Declared in
`bid-specs.prisma`, `CREATE TYPE`d by migration `20261003030000`, named in one
doc comment, and used by no column — `BidSpecReading.findings` is `Json`.
Meanwhile `specs.ts` claimed in a comment to *"mirror"* it while carrying
**three separate hand-written copies** of the same list: the TS union, the
model's tool-schema enum, and `SPEC_FINDING_KINDS`. Plus the prompt's rule 5 and
`SPEC_FINDING_LABEL`. **Six places, no guard** — the "is there a second list"
trap, in a feature three weeks old.

So this does not add a fourth copy. Three of the six are now **derived** from
one array: the type is `(typeof SPEC_FINDING_KINDS)[number]`, the tool schema
spreads it, and the runtime guard already read it. That is strictly better than
a census over copies — a kind the type admits and the tool schema does not is a
finding the model *cannot report*, and nothing would have failed, because the
model would simply never have used it.

The two that cannot be derived keep a census. `specFindingKindCensus.test.ts`
asserts the Postgres enum and the TS list hold the same members, and that every
kind has a label that is not its own enum name. **Mutation-proved in both
directions:** a kind in the code and not the schema reds, and a kind in the
schema and not the code reds, each naming the offender. It parses, so it asserts
the SIZE of what it parsed against a floor that cannot drift with the pattern,
and throws on an unparsed line rather than skipping it.

That also gives the enum a job it never had. Nothing breaks when the two
disagree — not a query, not a write, not a type — so a stale enum teaches a
reviewer the wrong vocabulary silently and forever. That was the only failure
mode available here, and it is the kind this repo keeps paying for.

## Verification

- **The migration's effect read back out of Postgres, not inferred from it
  applying.** Booted a throwaway cluster, applied every committed migration,
  and queried `pg_enum`: **12 members, all three new ones present.**
- **That check found a real subtlety.** `ALTER TYPE ... ADD VALUE` appends, so
  Postgres orders the new kinds AFTER `GENERAL` while the schema declares them
  before it. The census sorts before comparing, which is why it passes — a
  positional comparison would have failed on a difference that means nothing.
- The db suite with the migration applied: **64 files / 640 tests**, and the
  `Applying migration 20261005190000_add_spec_commercial_finding_kinds` line
  names it rather than reporting "up to date".
- `typecheck` 5/5, `lint` 5/5, **574 files / 8,931 unit tests**.
- Four eval cases, each failing for a different reason — one per new kind, plus
  the solicitation boundary. Proved the new cases are REACHED rather than
  ignored by mutating one to a bogus kind and watching it red by case id; the
  suite's test count does not move when cases are added, because the tests loop
  inside a single `it`, so a passing run was not evidence on its own.
- Announced in `#prova-build` before the push, per rule 4.

**`SPEC_SECTION_PROMPT_VERSION` goes `spec-section.1` → `.2`.** A reading taken
before today came from a reader that *could not* have produced these kinds, and
a re-read of the same section may now legitimately return more than it did —
without the bump that difference reads as the model being inconsistent.

## The eval was run, and all three kinds are produced

`pnpm eval:specs`, `claude-opus-5`, prompt `spec-section.2`, 10 cases in 107s.
**Every fatal counter at zero** — INVENTED 0, EAGER 0, UNQUOTED 0,
OVERCLAIMED 0:

| case | what came back |
| --- | --- |
| `liquidated-damages` | **HIGH** `LIQUIDATED_DAMAGES` — "LDs $2,500/day, passed down to subs" |
| `working-hours-occupied` | **HIGH** ×3 + MEDIUM ×1, all `WORKING_HOURS` |
| `prevailing-wage-and-apprentices` | **HIGH** ×3 `WAGE_REQUIREMENT`, the apprenticeship ratio among them |
| `solicitation-with-terms` | **nothing found**, which is the pass |

Three details worth more than the pass itself.

**The LD case did not invent a total.** `forbidden` holds `75,000` and "total
liquidated damages" — 420 days × $2,500 is the number a reader eager to be
useful would compute, and computing it would have been FATAL. It reported the
mechanism and the document's own per-day figure, which is rule 11 working.

**It found the pass-down clause**, not just the headline: "passed down to subs"
is clause B, and it is the sentence that makes an Owner-to-Contractor LD this
subcontractor's problem at all.

**The boundary held, with the reasoning quoted back.** On
`solicitation-with-terms` the reader said the mentions of liquidated damages and
prevailing wage "are pointers only … with no amounts, rates or restrictions
stated; those requirements belong to the Division 00/01 sections it points at".
And on the pre-existing `not-a-spec` case it volunteered the bid bond
specifically — "which belongs to the contract documents it points at rather
than to this notice". That was the exact risk of admitting Division 00/01, and
rule 8's new clause is what closed it.

**No regression, established from a recorded baseline rather than a second
run.** `CHANGELOG.md` records the reader shipping at *"6 of 6 with every fatal
counter at zero … One `missed`, reported and not fatal, and it is arguably the
reader being right: it declined to call Level 4 a cost driver because Level 4 is
the default a drywall estimator prices without being told."* This run reports
the same single `missed` on the same `names-and-excludes` case, for the same
reason. The four new cases added no misses and no fatals.

## Still not verified

**Nothing here measures a real spec book.** The eval's own footer says so:
*"synthetic sections, short, clean apart from one deliberately garbled page …
Nothing here measures whether the reader holds up over thirty pages with
cross-references into four other sections."* A real Division 01 is thirty pages
with an LD clause in one paragraph of one subsection, and that is the click-list
below rather than the eval.
