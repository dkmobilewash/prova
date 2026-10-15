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
