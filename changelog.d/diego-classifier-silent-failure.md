### "0 runs set aside" was the check failing, and it reached an estimator

Found by clicking, on a real drawing, on production. A West Herr Jaguar floor
plan (A-101, 1/8" = 1'-0"): the finder returned **216 runs**, the estimator
pressed **Check these are walls**, it thought for about a minute, and printed

> 0 run(s) set aside as casework or reference.

The overlay at that moment demonstrably held **title-block divider lines, the
company logo, five car outlines and about a dozen room-name tags** — roughly 32
runs and 323 ft of things that are not walls, 202 ft of it inside the 12" group
alone. The machine had not looked at any of it. It had returned no tool call,
and this line read that as a verdict:

```js
if (!block) return { labels: [], missing: [] };
```

A model that returns no tool call has not judged anything: it ran out of output
tokens mid-call, or declined, or answered in prose. Every one of those is a
failure, and **this product already knew how to show one** — `takeoffClassify`
marks the allowance, logs metadata and tells the estimator to judge the runs
themselves. All of it was sitting unused behind an early return.

`wallClassifyToolCall` throws instead, and the `stop_reason` rides in the
error's **name** because the action logs `err.name` and deliberately not the
message, which could carry a key.

### And the message says what to do, because "try again" is wrong here

216 runs will fail the same way every time. The estimator now gets

> The check couldn't cover 216 runs in one go — it came back with nothing rather
> than a verdict. Zoom into part of the sheet and check that, or judge these
> yourself.

`MAX_CANDIDATES` stays at 400 and is deliberately **not** lowered to a guess.
One measurement exists — 216 failed — and no measurement of what succeeds. A
cap invented from one data point is the kind of constant this repo keeps
deleting; the next real run now reports its own `stop_reason`, which is what a
defensible number would be set from.

### Verified

Four mutations red: the empty verdict restored, the stop reason dropped from the
name, another tool's output read as a verdict, and the estimator told to "try
again" instead of to zoom in.

The last of those caught a weakness in the test rather than the code — the first
version asserted that the name and the sentence appeared *somewhere* in the
file, and a mutation setting `const incomplete = false` left both in place and
stayed green. The message was present and unreachable. The assertion pins the
derivation now.

### Not in this change, and worth its own look

The finder's own caution says **"12,641 lines on this sheet also appear in the
same place on the rest of the set — the border, the title block and the logo —
so they were left out"**, and about 32 runs sit on the title block and logo
anyway. The de-duplication is not catching what it claims to. Separately: 19
thickness groups share 6 colours, so two groups on screen are both blue, and
seven groups stay collapsed behind a "Show the other 7 groups" control — a
reviewer checking the overlay cannot see what they are without pressing it.
