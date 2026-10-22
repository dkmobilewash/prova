### Answer-key mode, and the first error bar on a real drawing

Every accuracy number in this repo comes from a plan it drew itself. That is
the right way to build a bench and it cannot say what the detector does on a
sheet somebody issued — "2,099 ft on A102" has been true, unchecked and
unfalsifiable for weeks.

**The review mode.** Turn it on in the workspace and the overlay stops being a
list of findings and becomes a list of questions. Every detected wall is a
CANDIDATE, and so is every long line the detector could not pair. One press
accepts, one rejects, N moves on, H hides every overlay to read the drawing
underneath, and a drag decides a block at once — Shift to reject, which is how
a field of hatching gets dealt with in one gesture.

**Nothing is accepted until it is accepted**, and that is the whole design. The
obvious alternative — pre-accept the detection, let the reviewer delete what is
wrong — makes a key that agrees with the detector by construction, because
nobody deletes a hundred rows one at a time.

**What counts as a wall is on the screen**, not in a document: centreline,
gross through doors and windows, interior and exterior, no furniture or
casework or fixtures or curbs or grid lines or hatching. A key made under one
definition and graded under another is worse than no key.

Saving downloads a JSON file for the folder `REAL_PLAN_KEYS` points at. It
never lands in the repository, for the same reason the drawings do not. It
records who reviewed it and when — typed, not assumed, because these sessions
get driven from one laptop by whoever is sitting at it.

**The report grades any sheet with a key**: found against reviewed footage, the
signed error, every missed wall with its length, every extra one, and how many
of the key's walls the drawing showed as a PAIR versus a SINGLE LINE — the
question the 7,694 ft measurement could not answer alone.

**And the classes that measurement turns out to contain.** Before reviewing
anything, the unpaired long lines are now classified by pen weight against the
sheet's own wall pen, by company, by composition, by position and by closure,
with an overlay per class:

| sheet | unpaired | in a hatch | past the building | dashed | other |
| --- | --- | --- | --- | --- | --- |
| A102 | 7,714 ft | **7,210 (93%)** | 433 | — | 72 |
| A4.B.1 | 8,363 ft | **6,534 (78%)** | 1,345 | 484 | — |

So there is no hidden reservoir of thousands of feet of wall. Most of it is
fill.

**Two things the browser caught that no unit test could.** Turning the mode on
after a detection showed an empty rail telling the reviewer to press a button
they had just pressed. And three rails open at once squeezed the canvas to 5%
zoom — somebody deciding what is a wall, unable to see the drawing. Both found
in a screenshot; every unit test passed throughout, because each one calls the
mode the way the mode wants to be called.

Four of this repo's own design censuses caught the new UI: an invented
`ink-inverse` token that Tailwind emits nothing for (the exact failure
`CLAUDE.md` records for `text-ink-on-brand`), an unnamed input, and a clock
read now registered with its reason — a key's timestamp is genuinely an
instant, because the file is read on another machine months later to decide
whether it predates a change to the detector.
