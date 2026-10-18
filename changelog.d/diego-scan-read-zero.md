### A tile render queued behind the sheet's own, and "0 words" meant two things

The first clean run of Read this sheet on a real scan: **fifteen requests,
every one a 200, forty-seven seconds, counter climbing the whole way.** The
payload and timeout work in #803 holds — nothing was killed, nothing was
refused, no 503.

It then said *"Read 0 words off this sheet."* And with the AI switch turned
OFF it sat on *"0 of 15"* for five minutes and said nothing at all.

**ONE — a tile render queues behind the sheet's own render, forever.** pdf.js
serialises renders per PAGE, and `doc.getPage` hands back the same cached page
object the viewer is drawing with. The tester pressed the button while the
canvas still read "Drawing…", so the first tile render queued behind the
viewer's and never got its turn — which is why **not one request was ever
sent**. The loop never reached its first call.

The component already cancels its own in-flight render before starting
another; that discipline simply was not applied to these. It is now, before
the first tile.

Worth naming what this is NOT: with the switch off, a refusal was expected. It
never appeared because the gate is in the action and the action was never
reached. **A guard behind a hang is not a guard**, which is the same shape as
#803's size check sitting above the limit that actually applied.

**TWO — "Read 0 words" was one sentence for two unrelated failures.** Either
the model was handed blank or illegible tiles and correctly found nothing (a
rendering fault), or it found plenty and every box was discarded for sitting
outside the crop (a coordinate fault). Both produce the same zero, and nothing
told them apart — so the next move was a guess.

`readTextBoxes` DROPS a bad box rather than clamping it, deliberately: a
fabricated coordinate pushed back inside the crop would pair with whatever
line happened to be there. That is the right call, and it is exactly what
makes the two cases indistinguishable from outside. So the count the model
REPORTED is now carried beside the boxes that survived, and the page says
which zero it is:

| what happened | what the sheet says |
| --- | --- |
| words found and placed | "Read 41 words off this sheet." |
| found, none placeable | "…{n} pieces of writing were found but none could be placed on the drawing. This is a fault on our side." |
| nothing found at all | "No writing could be made out on this sheet." |

**5 of 5 mutations red, and two of them were green first.** Restoring the
condition to `false` left the panel test passing, because the sentence
INTERPOLATES `readReported` — the test was reading the number being printed
and calling it the branch being taken. And hard-coding `reported: 0` passed
everything, because every case exercised the counter directly and none asked
whether the function that talks to the model uses it. Both now pinned.
