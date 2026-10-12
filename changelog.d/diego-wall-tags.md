### The panel now says what the drawing calls each wall group (Diego)
`diego/wall-tags`

The found-walls panel said "47 runs at 4-7/8in". An estimator then had to work
out which of their own assemblies a 4-7/8in wall is. The drawing already answers
that — every floor plan tags its walls `EXT-1`, `A1`, `B1` beside the runs they
label — so the panel now reads **"4-7/8in · A1 / A2 · 47 runs · 1,284 ft"**.

A thickness is what was measured; a name is what gets mapped to a wall type and
priced.

#### What was looked for first and is not there

A partition schedule naming each type and its thickness. **This set has none** —
checked rather than assumed: its A-601 sheets are a DOOR SCHEDULE and a WINDOW
SCHEDULE, and **zero thickness strings appear on any page of the document**.
There is no list of valid thicknesses to snap a measurement to, so that idea is
dead and the module records it.

#### The bigger version that was built, measured, and cut

The ambition was to group walls BY tag instead of by thickness, giving every run
its assembly directly. The pairing works — every tag sits 0.5–2.2 ft from its run
with the runner-up past 4 ft, and **zero tags are orphaned**:

| page | tags | runs | cleanly paired | ambiguous | orphaned |
| --- | --- | --- | --- | --- | --- |
| 1 | 41 | 202 | 31 | 10 | **0** |
| 28 | 30 | 151 | 26 | 4 | **0** |

It still does not work as a grouping, for a drawing convention rather than a
bug: **an architect tags representative walls, not every wall.** 41 tags against
202 runs, so tagging claimed only **25–43%** of the footage per page — 539 ft of
1,962 on page 1.

Two ways to propagate a tag to its neighbours both fail. **By thickness**: `A1`
and `A2` both measure 4.75in, so it would merge two different assemblies. **By
collinearity**: `mergeWalls` already joins collinear runs, so the 202 are
genuinely distinct walls with nothing to propagate along.

So the tags are used for what they can carry — a name on a group somebody is
already deciding about — and not for a per-wall assignment the drawing does not
contain. **This does not fix the 12% of footage at an impossible thickness**,
because most of that footage is untagged.

#### The thing the numbers said that is worth more than the feature

`A1` measured **4.75, 4.75, 4.75 and 5.00 inches across four pages**. The tags
are independent of the geometry, so that is the drawing CONFIRMING the thickness
measurement for the dominant partition. The low-count tags confirm nothing —
`EXT-1` read 6.75, 10.25 and 6.00 on three pages off two runs each — which is
why a name is offered as a name and never as a thickness.

#### Checks

- **Eight mutations, every one red** — and the eighth was found this way rather
  than by thinking. Gating the call site with `{false && …}` left every render
  test GREEN, because they render `ClusterTag` directly and so prove the
  component works while saying nothing about anybody calling it. **That is
  #665's exact shape.** A call-site census now closes it, with its own size
  assertion and comments stripped — both the test and the component's header
  print `<ClusterTag` in prose, so a raw-text search would find a call site that
  does not exist.
- The other seven: the tag pattern unanchored; reach widened so any tag claims
  any wall; the clear margin dropped so ambiguous tags are guessed; the claim
  sort removed so a contested wall goes to the earlier tag; one wall claimed
  twice; distance measured to a wall's midpoint, which orphans every long run;
  an untagged group given an empty badge.
- 23 unit tests, 10 on the screen. Preflight green. No migrations.
- An ambiguous tag is **dropped, not guessed** — 24% of them. A group labelled
  with the wrong assembly name is worse than one with no name, because the name
  is what gets mapped to a catalogue.

#### Click-list

1. Open a calibrated floor plan and press **Find the walls**.
2. At least one group should carry a grey badge — on the answer key's sheets the
   4-7/8in group reads `A1 / A2`.
3. Hover the badge: the tooltip should read "The drawing tags these A1 and A2."
4. Most groups should have **no badge at all**. That is correct, not a bug — only
   a quarter to a half of the footage is tagged on the drawing.
5. The thickness, run count and footage must all still read as they did, and
   **Add these** must still work on a badged group.

#### Also here: the thinning timing guard is deleted, after flaking twice

#688's live-cell thinning is a 51x speedup and the difference between the wall
finder answering and appearing to hang. **Two guards were written for it and
both were flakes**, each failing under `preflight.sh`, which runs the build
beside the tests:

1. a ratio against a tiny grid's run — the baseline is microseconds, so its own
   noise moved the denominator;
2. a ratio against one measured pass over an array of the same size, taken in
   the same process so load would move both sides together. **That failed too** —
   a GC pause inside the measured region is enough, and no arithmetic can see it.

A guard that fails when the machine is busy is noise, and noise gets a suite
ignored. So the property is **not tested**, said plainly in the file rather than
papered over. What is still tested is that the same ink thins to the same
skeleton — the correctness of the change is covered and only its speed is not.

A third attempt needs a signal that is not a clock: counting the cells EXAMINED
would be one, and it means `thin` reporting its own work. That is an API change
for a test, worth making deliberately rather than reaching for another stopwatch.
