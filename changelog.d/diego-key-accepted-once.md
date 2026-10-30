### What actually changed, in plain English (Diego)
`diego/key-accepted-once`

**Two accepted lines on one wall now count once in the answer key, and the
scorecard scores a scanned sheet.** The key already folded a trace into an
accepted wall, but two accepted lines were both counted, which is what happens
when a reviewer accepts both faces of a wall. The longest is kept; a line only
partly covered stays, because the uncovered part is real wall.

The held-out eval also passed `offeredCandidates` neither the sheet's words nor
its strokes, so it scored a list no reviewer sees. It passes both now, and reads
a scanned sheet from its stored raster, which puts Evergreen on the scorecard.
