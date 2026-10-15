### The graphic scale bar was measured and discarded — and on real sheets it is not there

Phase 1 of the automatic-scale plan, and **its own hypothesis is refuted.** The
result is the deliverable; the code is what made it measurable.

### What prompted it

`realPlan.eval.ts` reported "0 of 5 real sheets produced an automatic scale", and
that was used to argue scale was unsolved. It measured **one** of the four
mechanisms this repo has. `scaleAudit.eval.ts`, which exists for exactly this
question, says otherwise:

| | real sets, 218pp, 4 bid sets | our own generated drawings, 80pp |
| --- | --- | --- |
| dimension reader fired | **12 (5.5%)** | 47 (59%) |
| printed scale name carried it | **94 (43%)** | 11 (14%) |
| several scales on one sheet | 21 (10%) | 6 |
| nothing at all | **91 (42%)** | 13 (16%) |
| agreement where two readings exist | **100% (12/12)** | 94% |

Two things in that table matter more than the headline. The dimension reader —
the one the code treats as primary — fires on **5.5%** of real pages against 59%
of ours, exactly the fragility `scaleAudit.ts` was written to detect. And the
printed scale name, which `scaleFromPrinted.ts` calls "a fallback only, never a
first choice", is doing **43%** of the work.

### The bar: measured and discarded

`scaleBar.ts:113` built `{at, value}` pairs along a run, confirmed they ascend
from zero, and returned a **boolean** — throwing away the one number the ladder
contains. The scale was one subtraction from code that already ran, and the bar
is the only witness immune to page scaling and the only one that works on a
single uploaded sheet.

So it was built. Then it was measured:

> **the bar reads 3 of 218 pages, and rescues 0 of the 91 pages nothing else
> could read.**

**The instrument is not the problem**, checked separately rather than assumed. Of
218 pages, 185 carry three or more bare numbers but only 57 carry a zero; 29 have
a row of three starting at zero and 3 are ladders. The near-misses are `0,0,0`,
`0,1,2`, `0,1,150`, `0,4,6,9` — sheet-number and revision fragments, not rulers
being wrongly rejected. `scaleBar.ts` predicted this in its own header: *"A bar
whose numbers were drawn as line work rather than text is not caught."*

### What ships, and what deliberately does not

- **`rulerLadder`** — the ladder is now one exported derivation with two callers.
  `wearsARuler` calls it instead of re-deriving the test inline, so the detector
  that DROPS a bar and the reader that MEASURES one can never disagree about what
  a ruler is. All 19 existing cases still pass, so the added linear fit changed
  no behaviour.
- **`scaleFromBar.ts`** — correct when a bar exists (3 of 3, zero contradictions),
  costs one pass over labels the page already extracted. **Not wired into the
  production scale picker.** A witness worth 1.4% does not belong in a consensus
  a bid is priced from.
- **The audit's fourth column**, which is what produced the number above and makes
  it repeatable on the next set without anybody rebuilding the reader.

### One finding about the code itself

The zero test — which `scaleBar.ts` calls the whole safety argument — is **not
independently load-bearing.** A mutation deleting it leaves every test green,
because the linear fit anchors at whichever end holds the smallest value and
requires it to be zero. It is kept where a reader looks for the rule, and the
redundancy is now written beside it rather than left as something the next person
discovers by deleting it.

### Verified

Preflight's four gates green, 700 test files, no production schema touched. Six
mutations red: the ladder returning a constant, the linear fit dropped,
`wearsARuler` no longer sharing the ladder, a non-standard reading accepted,
disagreeing bars picking one, and the audit reporting no bar at all — that last
one was green until the census pinned the derivation rather than the column.
