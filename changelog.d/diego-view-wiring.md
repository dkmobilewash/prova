### The viewer and the evals run one detection

`detectForSheet` is the pipeline: drawings found by title or caption, text
blocks kept out, every floor on a multi-floor sheet measured at its own
scale and kept, and what the sheet shows (kept views, others, left-out)
returned from the same call. The viewer's inline copy is gone. Proved in a
real browser on Murray, Crosslines and both Baker sheets: the app's list and
the eval's list are identical, 80, 258, 33 and 82. The proof also found that
the finder returns a different list when an answer-key hook is set (Crosslines
258 against a customer's 244), which is recorded in NOTES for the finder's
owner rather than changed here.

The finder's answer no longer depends on whether an answer-key hook is
watching: a face spent on one wall is never awarded a second partner while
pairings are being collected, so the list a reviewer labels is the list a
customer sees. Faces are built from strokes in reading order, so the pairing
is independent of the order a PDF stores its lines; sorting at the finder's
door was measured and refused (it breaks the bubble and arc stages, which
read stroke sequence), and that residual is recorded for the finder's owner.
