### Opus reads a scan for the opposite reason to the one written down

Reading a scanned sheet is nine model calls per sheet, so it is the kind of
volume that bought Haiku for plan ingestion. `SHEET_TEXT` was set to Opus
anyway, and the comment justifying it said: a misread dimension sets the
sheet's scale, and the scale multiplies every quantity.

**That argument is weak and was weak when it was written.** The scale vote
needs THREE labels to agree, so a single misread character is outvoted rather
than believed. The eval takes `SHEET_TEXT_MODEL` precisely so the question
could be settled rather than argued, and it has been — same two scanned
fixtures, same prompt, same JPEG tiles:

| | Opus 5 | Haiku 4.5 |
| --- | --- | --- |
| printed strings read exactly | 101/101 | 89/101 (88%) |
| **placed within the 30pt the pairing allows** | **99 (98%)** | **16 (16%)** |

**Haiku can mostly read the lettering. What collapses is WHERE it says the
lettering is** — and that is the half that decides anything, because a label
more than 30 points from its line pairs with no line at all and votes on
nothing. A sheet whose labels land at 16% never gets a scale.

So the conclusion survives and the reasoning under it is replaced: **this is
bought for COORDINATES, not for characters.** Which is worth more than the
price comparison, because it says what to re-measure if a cheaper model is
ever tried again — placement, not accuracy.

**The honest bound**: the prompt was written for, and only ever tuned against,
Opus. A prompt written for a smaller model might place better and nobody has
tried. That is a different experiment, and `SHEET_TEXT_MODEL` is how it would
be shown rather than asserted.

Reading it cost one eval run. Leaving the wrong reason in place would have
cost the next person the whole argument again.

### And skipping the blank tiles would save 6%, unsafely

The other obvious way to make reading a scan cheaper: most of a drawing is
white paper, so skip the tiles with nothing on them. Measured before building,
with no model calls at all — ink counted off the render, and the words located
in the vector drawing each scan was made from:

| | |
| --- | --- |
| tiles holding no words | **2 of 33 (6%)** |
| inkiest WORDLESS tile | 0.278% ink |
| emptiest WORDED tile | **0.184% ink** |

**Two findings, and the first kills it on its own.** "Most of a drawing is
white paper" is false at tile scale: dimension strings, leaders, room tags and
notes reach almost every tile, so the ceiling on this saving is six percent
rather than the half somebody would guess.

**And the six percent is not safely reachable either.** A wordless tile
carries MORE ink than the emptiest worded one, so no ink threshold separates
them — any cut aggressive enough to skip the blank tiles also skips a tile
with words in it, and losing one dimension string can cost the sheet its
scale.

Not built. `tileSkip.eval.ts` is kept so the next person who has this idea —
it is a good idea, it just does not survive measurement — gets the answer in
five seconds instead of building it.
