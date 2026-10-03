### The rates got clicked, and the form was still telling people they didn't exist (Diego)
`diego/wage-rates-clicked`

No migration. One sentence of copy, one e2e spec.

**#598 SHIPPED WITH 547 FILES OF UNIT TESTS GREEN AND NOBODY HAVING TYPED A
RATE IN.** This is that typing, and it found something the whole suite could
not: the determination form, three inches above the new rate form, still read

> *"No rate is entered anywhere — the rate stays on the document."*

True when it was written and false the moment #598 merged. It is the exact
shape this repo keeps paying for — a sentence that was accurate about an
older version of its own screen, left standing, and then read as
instructions by the person using it.

**The assertion worth the file is the REFUSAL one.** `formActionCensus`
caught #598's first draft using `<form action={…}>`, which in React 19
resets the form BEFORE the action runs — so "a base wage of 0 is not a rate"
would have arrived over six emptied boxes, after somebody had copied those
figures off a government PDF. **A census can see the shape of the code; only
a browser can see that the figures are still on screen when the refusal
lands.** The spec types a 0, reads the refusal, and then asserts both inputs
still hold what was typed.

| mutation | assertion | result |
| --- | --- | --- |
| the form resets BEFORE the action (the React 19 bug) | refusal keeps your figures | **RED** |
| `PageAlerts` renders its section when empty | nothing when there is nothing | **RED** |

Both mutations were checked for VACUITY as well as colour — the harness
requires "Running 2 tests" in the output, so a build break cannot pass itself
off as a caught regression. Files restored byte-for-byte, never by
`git checkout`.

The spec also pins three decisions that are easy to "tidy" into bugs: an
unmapped classification renders **"not mapped to a craft"** rather than an
error, because the document's names are not ours; an omitted fringe renders
**an em dash, not $0.00**, because "the document does not say" and "the
document says none" are different facts a pay clerk acts on differently; and
`/wip` renders **no section at all** when nothing is outstanding, rather than
an empty box announcing it has nothing to say.

Run against a throwaway Postgres that did not exist a minute before, through
real Chromium, signed in as a real Clerk test user. 548 files / 8604 tests,
typecheck and lint clean.
