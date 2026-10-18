### The button offered to add 94 subcontractors and the server refused all 94 (Cyrus)
`cyrus/sales-signals`

An import carries at most 60 subcontractors. The cap is not a performance limit — the
whole feature's claim is that a person LOOKED at these rows, and a hundred-row paste ticked
through in one click is that claim being false.

It was a private `MAX_LISTING_ROWS` in `lib/actions/sales.ts` with the refusal written
inline, so **the review screen could say nothing before the round trip**. The submit button
offered *"Add 94 subcontractors"*, the server refused all 94, and the reviewer learned the
limit from an error after waiting for it. Nothing was lost and nothing was silent — the
refusal is an `ActionResult` the form renders, not a thrown message production would redact
— but the one place that knew the rule was the one place that could not say it in time.

**The obvious fix is a `60` in the component as well, and that is the failure this repo
keeps paying for:** two numbers *and* two sentences, free to drift, with nothing comparing
them. So the cap is a **function** in the pure module both callers already import, and it
returns the sentence rather than a boolean:

```ts
export function tooManyRows(count: number): string | null
```

`null` means this many is fine. A string is the refusal — and it is the same string in both
places by construction, not because somebody keeps them in step. The screen disables submit
while it is non-null and prints it.

**Four guards, four mutations, each killed by exactly one test.**

| mutation | reds |
| --- | --- |
| the cap refuses the cap itself (`<` for `<=`) | "allows 60", the boundary case, and the server's accepts-exactly-the-cap case |
| the cap is checked only after the rows are reconciled | "refuses more than the cap, before it reconciles a single row" |
| the sentence is copied into the screen | "has the refusal sentence written in exactly one file" |
| the screen knows and does not act on it | "has the review screen import the function and gate its submit button on it" |

Two of those are worth their own note.

**The order is half of what the server-side case pins, not just the limit.** Its selection is
61 line numbers the listing does not contain, so *both* refusals apply — the cap and "does
not read the same way". It must be the cap, because the cap is the cheap check and
reconciling rows is not. Move the cap below the reconciliation and the test reds with the
other sentence.

**The last mutation is the one a sentence-count cannot see.** The number could live in
exactly one file and the component still never consult it — which is precisely the state
this change was made from. A census that the list is complete cannot tell you whether
anybody reads it; that needs its own assertion, and CLAUDE.md records the same shape one
notch out.

The boundary is asserted from both sides in one case, because a cap tested only from above
passes with `>=` and one tested only from below passes with `>`. And the census asserts it
read all three files first, since otherwise its three findings could be about empty strings.

468 unit tests (from 457) and 51 db tests (from 49), every mutation run collecting the full
totals first.
