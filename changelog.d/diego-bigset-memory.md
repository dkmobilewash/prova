### A big plan set is held in memory once, finders take turns, and code sheets stop counting as floor plans

Profiled on ELEVEN03 (342 MB, 175 sheets): the server peaked at 4–5 GB because
every reader fetched the whole file and opened its own pdfjs document. The wall
legend did it for every page it checked, four lanes at a time (139 whole-file
reads in one walk); each scale saved started a wall finder after the response
(49 at once when Confirm saved 47 scales); and the inventory opened one copy per
slice and left it for the collector. Now the first reader of a plan opens it and
every other reader borrows that one copy (`openSharedPlanPdf`); the copy closes
30 s after the last reader gives it back. Wall finders started after a scale
save run two at a time per server instance, floor plans first, and the sheet the
workspace is waiting on jumps the line.

Most of what was left was pdfjs decoding the set's embedded images, which no
reader of text or strokes uses: measured on ELEVEN03, a walk over its sheets went
from a 2.65 GB footprint to 1.0 GB with images skipped, and every sheet's stroke
count stayed the same. The shared copy skips them; the inventory borrows a copy
that decodes them only for a page with no text layer, where the scan check
counts images.

The scale step listed 80 "floor plans" on ELEVEN03 and could never finish: 51
were code, UL, ANSI, ADA, TAS and perspective sheets, which the title-block
reader had called OTHER but whose titles named nothing, so they fell through to
"floor". A page the reader calls OTHER whose title names nothing priced is now
"other": 34 floor plans, 28 of them scaled by Confirm and the printed scale.
