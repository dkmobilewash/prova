### The furring was lost to a quarter of an inch

95% of the furring on Mesa Ridge now, against 19%. Found footage up 1,209 ft
with **not-on-a-wall unchanged**, and the same shape on the holdout.

| | before | after |
| --- | --- | --- |
| Mesa Ridge found | 63,784 (81.7%) | **64,993 (83.3%)** |
| Mesa Ridge not-on-a-wall | 3,610 | **3,610** |
| Mesa Ridge F1 furring | 298 / 1,582 (19%) | **1,508 / 1,582 (95%)** |
| holdout found | 31,907 (96.6%) | **31,998 (96.9%)** |
| holdout not-on-a-wall | 389 | **389** |
| holdout F1 furring | 71 / 307 (23%) | **162 / 307 (53%)** |

### The cause, and it was not the thickness floor

Every account of this defect so far — the scorecard's P6 row, the summary's
"furring is thinner than the minimum it accepts", `minThicknessFeet`'s own
comment — says the 2-1/2in floor refuses 1-1/2in furring. That was true and
#751 fixed it: a pair matching a scheduled thickness is admitted, and a
1-1/2in wall standing alone is found today.

What was left is a **slack collision**, reproduced in a unit test rather than
argued:

```
real sheet  [0, 7.625, 9.125]  ->  [9.13]   one wall at a thickness nobody builds
fixture     [0, 8,     9.5  ]  ->  [8]      correct
```

1-1/2in furring on 7-5/8in block is three lines. The span across both is
9.125in, and the schedule's EXT-1 is **8.875in** — exactly `KNOWN_SLACK_IN`
away. So the span looked like a type this company builds, "the widest pair the
schedule names" took it, and the finder returned one 9.13in wall where the
drawing has a block wall with furring in front of it.

**And it poisoned both halves**, which is why it cost 1,210 ft rather than the
20 ft the probe table reports: `enclosedByAScheduledWall` saw the same phantom
wall and marked the block AND the furring as layer lines of it, so each was
refused before the schedule tier could prefer either. The existing fixture hid
all of this because its schedule has nothing near 9.5in — the preference looked
like it worked.

### The rule, and the discriminator that makes it safe

A gap with a face inside it dividing it into two gaps the schedule **also**
names is two assemblies touching, not one wall. "9.125 is 7.625 plus 1.5, and
all three are on the schedule" is a coincidence of three numbers; "9.125 is
within a quarter inch of 8.875" is a coincidence of two.

**The first version of that rule broke the window-broken exterior**, and the
test that caught it says in as many words that its 6.625in stud cavity is on the
schedule deliberately so "the schedule cannot rescue this case". EXT-2's true
8.125in span decomposes too — 1.5 + 6.625, both named. Both shapes decompose, so
decomposition alone cannot separate them.

What separates them is how well the **span** matches. EXT-2's is exactly 8.125;
the furring span is a quarter inch off 8.875. A thickness sitting on the
schedule is the drawing agreeing with the legend; one at the edge of the slack
is the slack doing the work. So the decomposition only overrides a **loose**
match — `EXACT_SCHEDULE_IN`, 1/16in, tighter than a plotter's line weight.

### Verified

Four mutations red: either call site dropping the question, a loose match
treated as exact, an exact match treated as loose. **Two stay green and are
written down in the test file rather than dressed up** — the "both halves
scheduled" requirement is masked by the `bestWall` fallback everywhere a case
could be built, and the `> 6` width gate is a performance guard that would be
lying if asserted as behaviour.

Also measured and **not** shipped: letting a face serve a second wall on its
other side (the shared-face theory this was expected to need) bought 27 ft and
emitted mostly out-of-scope block; and teaching `mergeWalls` the schedule so it
stops absorbing furring into the block it leans on raised not-on-a-wall by
1,673 ft on Mesa and 1,544 on the holdout. Both reverted. The remaining
holdout furring — 145 ft, where the furring's face really is shared with the
block's — is where that idea would have to work, and it does not yet.
