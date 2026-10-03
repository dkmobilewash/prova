### A banner prop that could never render, and a finding that wasn't one (Diego)
`diego/mobile-today-and-dead-prop`

Mobile only. No migration, no behaviour change.

**`JobProgressBanner` took an `empty` string and a nullable `value` for the
"nothing to measure" case, and neither could be reached.** The caller gates
on `{punch ? … : null}` and `punchBreakdown` returns null when a job has no
punch rows — so the gate always fired first, `total` was never 0, and the
null branch was dead from the day it shipped. Removed: `value` is now
`number`, and the decision "there is nothing to measure" stays with the
CALLER, which renders no band at all. That is the better half anyway — a
band announcing a job has no punch items is still a box on a screen that
had nothing to report.

**AND THE PART WORTH MORE THAN THE FIX: a second "finding" from the same
device sweep was not a defect, and the test written for it is what said so.**

Home's TODAY section was seen on a real iPhone as a heading with a bare
divider and nothing under it. The reasoning looked sound — `summariseToday`
can return `[]`, and the section is not gated on length. A fix was written.

Then the regression test for it **failed with the fix in place**, because
`cachedRead` falls back rather than throwing, so `lines` was never empty.
Back to the phone: once warm, TODAY renders its three lines correctly
("Today's report isn't filed", "No hours logged today", "No photos today").
**The first screenshot had caught a cold start mid-load** — seven seconds
was not enough — and a loading state was about to be shipped as a bug fix.

The gate and its test are reverted. Recorded because the shape recurs in this
file: the instrument disagreed with the conclusion, and the instrument was
right. A test that fails when the fix is in is not a broken test; it is the
fix being wrong.

53 files / 399 tests across both mobile suites, typecheck clean.
