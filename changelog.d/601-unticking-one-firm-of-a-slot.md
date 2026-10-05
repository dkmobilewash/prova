### Unticking one firm of a slot, in a browser — the half of that fix nothing could prove

The row-key fix has five db cases against a real Postgres. They cover the SERVER: that a
multi-bidder labelled form imports at all, that one column imports without the other, and
that two rows on one lead write the shared claims once.

**The screen's half had none and could have none.** `chosen[row.line]` was one boolean for
both firms of a slot, so unticking either unticked both and one "Already a lead?" applied to
both — and that state lives in the component, which nothing in this repo renders. A db test
builds the FormData itself; it can never press a checkbox.

So step 10 does the thing the aliasing made impossible: it pastes a form printing two firms
across one line, **unticks one of them**, and requires the other to keep its own state.

- both names asserted absent from `/sales` first;
- the button says **2** before the untick and **1** after — a number the product composes
  from its per-row state, singular and plural included;
- the kept row's checkbox asserted still CHECKED after the other is unticked. That is the
  regression directly: with one boolean for both it would be unchecked;
- the dropped firm asserted absent from the leads afterwards, so the untick reached the
  server rather than only the screen;
- and the kept lead's claim quotes `(line 7 of the listing)` — the line the two firms
  SHARE, which is the provenance being honest rather than inventing a line per column.

The form's second slot is present and empty because `buildingConnectedListing` dispatches
only on two "Name of Business" and two "License No." lines; a one-slot form takes the
ordinary table path and the step would be about a different reader. That is also what the
real documents look like: six slots printed, two used.

Three unit cases pin the premise so a red e2e run never has to teach it — that the two rows
really come off ONE line, that both are in our trades so the untick is the only thing
separating them, and that the summary's counts and the quoted claim are what the app's own
reader produces.

**And a correction to this entry's own first draft, which said "490 unit tests, from
487".** That conflated two configs. The three new cases are in
`e2e/lib/salesFixture.test.ts`, which is not in the scoped sub-listing-plus-censuses run
that reports 487 — so 487 is UNCHANGED and the fixture gate goes 21 → 24. The figures this
branch should be read with, each measured rather than remembered:

| suite | tests |
| --- | --- |
| `lib/sub-listing/**` | 406 |
| that plus the repo-wide censuses this branch rests on | 487 |
| `e2e/lib/salesFixture.test.ts` — the fixture gate | 24 |
| `e2e/lib/salesCoverage.test.ts` | 8 |
| the db suite | 61 |

None of those is "the unit suite" as CI counts it: `apps/web/vitest.config.mts` includes
`**/*.test.ts` across the whole app, which is thousands. A figure quoted without its config
is the shape of claim this file keeps correcting, so from here they are quoted with one.
