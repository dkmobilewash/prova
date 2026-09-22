### Type the percent, get the dollars (Diego)
`diego/pay-app-percent`

A sub reports progress as a percentage — "we're at 60% on framing, 35% on
board, 10% on tape, nothing on ACT yet". Column E of a G703 wants dollars.
Somebody has been converting by hand, per line, every month, on a calculator
that does not know what was billed last period — which is the half that goes
wrong. 60% of the line is $120,000, but $75,000 went out in September, so
this period is $45,000. Bill $120,000 again and the line reads 97.5%
complete on a job that is 60% built.

The pay application form grows a **% complete** box per line. Type 60, and
This period fills with the figure that takes the line to 60%.

THE DOLLARS ARE STILL WHAT IS BILLED. The percent box has no `name`, so it
never reaches FormData and `submitPayApplication` never sees it. That is not
tidiness: the G703 that leaves this company carries dollars,
`payAppEntryError` validates dollars, and a percent travelling beside them
would be a second source of truth free to disagree on the document itself.
It writes through a ref rather than by controlling This period, which is
deliberately uncontrolled — `reset()` clears it on success and #414's
history is written around what that box does and does not refuse.

`thisPeriodForPercentComplete` is the inverse of `percentOfScheduledValue`,
and the tests pin THAT rather than the arithmetic: feed the result back into
`calculatePayAppLineItem` and column G reads back the percent that was
asked for. Asserting 60% of $200,000 is $120,000 only re-states the
expression and would pass just as happily if the figure disagreed with the
form it feeds.

Three behaviours worth knowing before clicking it:

- COMPLETED TO DATE INCLUDES STORED MATERIALS, because that is what column G
  means. Reaching 60% on a line carrying $40,000 in the yard bills $80,000
  of work, not $120,000. Said out loud this is the surprising one — "we're
  60% done" usually means work in place — so it is a paragraph in the source
  and a test.
- A PERCENT BELOW WHAT WAS BILLED RETURNS A NEGATIVE. That is the downward
  correction `payAppEntryError` already documents as the only route back on
  an over-billed line. The conversion does not re-police the bound; the gate
  every entry passes through owns it, and two rules free to disagree is
  worse than one.
- IT REFUSES ONLY WHAT THAT GATE CANNOT SEE: over 100% (named in the words
  it was said in — the gate would report a dollar figure nobody typed), a
  negative percent, and a line with no contract value to take a percent of.

The box reads through `parseNumericInput` rather than a sixteenth parser, so
it takes `60`, `60%` and `60 %`, and refuses `12,50` and `1e5` with that
module's own sentences. It converts on blur and Enter, NOT on every
keystroke: "6" on the way to "60" is a valid percent and would rewrite the
money box mid-type.

The result carries where the line LANDS as well as the figure, and the form
shows it. That is the one mistake the type cannot prevent: the function
takes 0-100, and a 0-1 ratio passed in is a valid, tiny, plausible-looking
percentage. $1,200 on a $200,000 line does not look wrong; "takes this line
to 0.6% complete" does.

VERIFICATION, AND THE LIMIT OF IT. This container cannot install — main pins
`xlsx` to `cdn.sheetjs.com`, which the egress proxy denies by organization
policy — so vitest, typecheck and build could not be run here. What was run:
the two pure modules were transpiled out of their real source by the
TypeScript compiler and driven through 21 assertions, all passing; three
mutations of the conversion were caught (dropping stored materials, dropping
previously billed — which also trips the existing over-billing gate — and
treating the percent as a ratio); the parser-plus-converter composition was
run over thirteen typed inputs; and all three changed files were parsed by
the TypeScript compiler for syntax. NOT run: type resolution across the
component's imports, lint, and the form in a browser. CI is the first real
check, and the click list in the PR is the second.

No schema change, no migration.
