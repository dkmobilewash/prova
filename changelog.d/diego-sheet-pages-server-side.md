### The browser cannot read a drawing that lives in Procore (Diego)
`diego/sheet-pages-server-side`

No migration. One new function, one action rewritten, one effect deleted.

**FOUND BY DOING IT ON PRODUCTION, which is the only place it could have been
found.** #621 shipped `ensureSheetPages`, which recorded a revision's page
count and page sizes from **the pdf.js already open in the browser to display
the drawing**. The reasoning was sound and is in that PR: the data is free
there, and a server-side read would need `@napi-rs/canvas` in a second place.

It cannot work. `DrawingRevision.fileUrl` is a LINK to wherever the drawing
actually lives, and the field's own help text on the form says what that means:
*"Wherever it actually lives — Procore, Box, the GC's portal."* A browser can
only read a cross-origin PDF when the host sends `Access-Control-Allow-Origin`,
and none of those do.

Measured rather than inferred, against the probe file linked on a real
revision:

| | |
| --- | --- |
| server `fetch()` | **200**, `application/pdf`, 13,264 bytes |
| browser, cross-origin | **no `Access-Control-Allow-Origin`** — unreadable |

So the page rendered *"That drawing couldn't be opened, so its sheets couldn't
be read"* for a file the server could read perfectly well. The feature worked
only for a PDF that is **both** publicly fetchable **and** CORS-open, which is
close to no real drawing link at all.

**The server reads it now** (`readPageSizes`), where there is no CORS and where
the bytes are already being fetched for rasterising. That also deletes a
question the old version had to answer at length — what stops a client sending
wrong dimensions — because nothing comes from the client any more.

And the refusal says the actual thing instead of a shrug: *"The link has to be
one this app can open without signing in — a file behind Procore or a GC portal
cannot be read from here."*

| mutation | result |
| --- | --- |
| control | green |
| width and height swapped | **RED** |
| no pages returned | **RED** |
| (existing) raster squared, aspect destroyed | **RED** |

A third test pins the two paths together: `readPageSizes` and `rasterisePage`
must report the same dimensions for the same page. If they ever disagree every
pin on that sheet is misplaced, because `y` is a fraction of the WIDTH.

**What this does NOT fix, and it is the bigger half.** A drawing behind a login
still cannot be pinned at all — the server cannot fetch it either. The real
answer is to UPLOAD the PDF into our own blob store the way photos already are,
rather than linking to someone else's. That is a product decision (and a
Cyrus-lane one, since Drawings is his), so it is written down here rather than
decided in a bug fix.

573 files / 8927 tests, typecheck, lint and a full production build clean.
