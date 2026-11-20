### Labelling: wall types survive the finder re-reading a sheet

On Permit-Drawings A1.01 Chrome typed four accepted walls. The saved file held none of the types, and the reopened sheet showed "Can't tell". When the finder re-reads a page whose candidate list hasn't changed (a scale save, Find again), `keepReview` rebuilds the review from the fresh reading. It kept verdicts, traces and openings, but not the types, so every type entered before the re-read was dropped. Sheets with no re-read after typing (Gen-BBQ) kept theirs on the same build.

The re-read now keeps each type whose wall is still accepted or traced, the same rule the draft restore already used. Labelling tool only; the customer product never mounts it.
