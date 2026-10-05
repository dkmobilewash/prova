### The deletion was right; its premise was enforced by one row of one fixture (Cyrus)
`cyrus/sales-signals`

`601-the-silence-that-swallowed-a-shared-licence.md` deleted a line from
`importSubListing`: each written claim used to be added back into the per-lead dedupe set so
two rows of one paste could not write the same sentence twice. Review proved it unreachable,
and the argument for deleting it was:

> every claim-producing branch appends `atLine`, and two rows of one paste always have
> different line numbers, so two rows can never produce a byte-identical `(kind, claim)`.

That argument is sound. **What enforced its premise was one test over one row of one fixture**
(`signals.test.ts:57`, *"carries the line number on every signal"*), and the consequence the
dedupe actually relies on — that no TWO rows collide — was asserted nowhere. A claim branch
that row does not reach could lose its `atLine` with every test in this repo green, and the
guard that would have caught the resulting collision is the one that was just removed.

So the premise is a test now, across every row of every fixture, plus the consequence as its
own case: no two rows of one document produce an identical kind-and-claim. A control requires
the corpus to reach at least five claim kinds, so no branch is exempt from the assertion by
simply never being exercised.

**The deletion still stands and this is not a retreat from it.** A guard that cannot fire
should go — that is the rule this branch has applied twice. The lesson is narrower: when the
reason it cannot fire is a property of *other* code, check the property instead of remembering
it. The guard was the expensive way to be right; the assertion is the cheap one.

**Two corrections to my own work, both found by mutation rather than by reading.**

First, this entry's docstring originally said the property was "true and unasserted". It is
asserted, for one row, and I missed it with a grep for `atLine` and `"of the listing"` —
neither of which that case uses. Emptying `atLine` reds it, which is how I found out. The
claim is corrected in place rather than quietly dropped, because "nothing asserts X" is the
kind of sentence that stops the next person looking.

Second, the mutation that drops `atLine` from a *single* branch reported **429 tests of 482**
— fewer than the baseline, so it had broken module loading and that run was about nothing
rather than a survival. Reading the total before the colour is what caught it, for the third
time on this branch. The arm that emptied `atLine` everywhere collected the full 482 and red
three cases: the pre-existing one and both new ones.

482 unit tests, from 479.
