### Ask can add two figures up — in TypeScript, from figures it was handed (Cyrus)
`cyrus/ask-arithmetic-tool`

Ask could not answer "what do Turner and Halvorsen owe us between them?".
It had both figures on the table and had to say the number was not
available, which makes the assistant look stupid about its own data.

The system prompt's "Never do arithmetic" rule is why, and it STAYS. It is
right twice over: the app already computes every figure it shows, so a
model that computes one too becomes a second source of truth that can
disagree with the screen (the #46/#97 scar, two retainage figures eighteen
inches apart); and a model's arithmetic can be correct and still
meaningless — adding two retainage balances taken at different withholding
rates is a right sum of the wrong things, and the sum does not say so.

So the fix is not to loosen the prompt. The arithmetic moved into code.

**`calculate` takes REFERENCES, never numbers.** The model names a figure
by its path in a tool result it has already been handed this turn —
`receivables.rows[0].outstanding` — and nothing it types is a number. A
calculator that accepted values would be a laundry: type `48400`, get
`48400` back with a tool's authority, and both the prompt rule and the
number-provenance guard on #462 are defeated.

The values-then-validate shape was considered and rejected for a reason
worth keeping: **a value match cannot tell you which field it matched, so
it cannot tell you the kind.** `8` is in the rows as a count of invoices, a
day of the month, 8 hours and $8.00. A validator that says "yes, 8 is in
there" has just licensed adding a count to a dollar amount — the refusal
this tool most needs to make is the one a value matcher is blind to. A path
names one field, and a field has a kind.

**It fits #462 rather than fighting it.** A calculated total appears in
exactly one place: `calculate`'s own tool result. So a derived figure is
traceable by construction, which is why this is a tool and not a
post-processing step. The two share no matching code.

**Kinds are a table, not a pattern.** Tool results are plain JSON with no
type information; the only signal is the field name somebody chose in
`handlers.ts`. A pattern was tried on paper and thrown out —
`job_labor_cost`'s summary has `hoursLogged` (hours) next to `jobsWithHours`
(a count of jobs), and any rule reading "hours" out of the first reads it
out of the second. So a figure is combinable only if it is listed by exact
tool and exact field, kind written down by someone who read the handler;
everything else refuses and says which field it refused. An unlisted field
costs an answer, a guessed kind costs a wrong number in front of a GC.

**A canonical figure always wins**, and the line is checkable rather than a
matter of taste: a sum covering EVERY row of a field that has a canonical
total is refused and names the figure that owns it — `loadRetainageHeld`'s
`companyWideStillHeld`, cash flow's `arOutstanding`, `job_labor_cost`'s own
totals. A SUBSET of those rows is not a canonical question and is the whole
reason this tool exists.

Money is added in cents and rounded once, hours in hundredths (the
`Decimal(5,2)` the column actually is), and both come out through the
formatters the pages use — so `21.1 + 14.2` is "35.3 hours" and not
`35.300000000000004`, which reached a certified-payroll form once.

**The checks, and that they can fail.** Three mutations, each restored:

- let an untraceable path resolve anyway → RED, and the refusal test came
  back holding a laundered `$30,000.00`;
- drop the `Math.round` that puts money into cents → RED on 2 of 4 sums
  (`0.07 + 0.07 + 0.07` returned `0.21000000000000005`), which is why the
  tests assert the raw value and not just the formatted string;
- break the walker that builds the figure ledger so it matches nothing →
  the SIZE assertion names it in one line ("the walk and the parser
  disagree: expected 0 to be 22"), while **every refusal test still
  passed**, because a broken walker refuses everything and refusing is what
  those tests check for. That is this repo's recurring empty-question
  failure, so the ledger's count is pinned to a count taken by
  `JSON.parse`'s own reviver — not this code, and unable to break with it.

`calculator.test.ts` also re-checks every field in the kind table against
`handlers.ts`, so a rename fails the build instead of quietly emptying the
table.
