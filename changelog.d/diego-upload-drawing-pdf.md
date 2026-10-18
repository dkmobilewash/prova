### The drawing goes in our own store, like a photo (Diego)
`diego/upload-drawing-pdf`

No migration. A file input, two actions, and the deletion of an entire
server-side rendering path.

**DIEGO'S CALL, AND IT RESOLVES THREE DEFECTS AT ONCE RATHER THAN FIXING THEM
IN SEQUENCE.** `DrawingRevision.fileUrl` began as a LINK to wherever the
drawing actually lived — the form still says "Procore, Box, the GC's portal" —
and that is fine for a human clicking through to read it. Pinning needs to read
the file, and a link cannot support that. Both halves were measured on
production on 2026-10-05, each after a fix for the one before:

| | |
| --- | --- |
| the BROWSER reading a linked PDF | needs `Access-Control-Allow-Origin`; Procore and friends never send it |
| the SERVER fetching a linked PDF | cannot reach anything behind a login |

So the file is UPLOADED now, into our own blob store, exactly as a site photo
already is.

**EVERYTHING THAT WAS BUILT FOR THE SERVER TO RENDER IS DELETED, which is most
of the diff.** `lib/sheet-raster.ts`, its tests, `@napi-rs/canvas`, and
`serverExternalPackages` are all gone — because **the browser doing the upload
has the bytes in its hand and has a canvas natively.** It reads the page sizes
from the `File` (no request, so no CORS), renders each page, and uploads the
PNGs.

That chain is worth writing down because every link in it was a reasonable fix
for the previous one:

```
server rasteriser  -> needs @napi-rs/canvas
@napi-rs/canvas    -> native .node, webpack cannot parse it -> build RED
serverExternalPackages -> build GREEN, and the binary is no longer traced
not traced         -> pdf.js finds nothing at runtime -> feature dead, all checks GREEN
outputFileTracingIncludes -> "invalid deployment package ... symlinked directories"
```

Five steps, each correct in isolation, ending in a feature that could not work
with a green board. The upload removes the first step and the other four stop
existing. #635 is closed rather than merged.

**What the parser refuses, and why it refuses the WHOLE list.**
`parseSheetPages` takes the page geometry the browser measured. A malformed
entry fails the whole upload rather than being skipped: a skipped page is a
sheet that silently does not exist, and a page with `widthPt` 0 puts every pin
on it at infinity, because `y` is a fraction of the WIDTH. A refusal gets
noticed; a drawing that half-uploaded does not.

| mutation | result |
| --- | --- |
| control | green |
| a page with no width accepted | **RED** |
| duplicate pages accepted | **RED** |
| a malformed entry SKIPPED instead of refused | **RED** |

**AND THE BUILD CAUGHT WHAT 8,926 TESTS COULD NOT, AGAIN.**
`export const MAX_DRAWING_BYTES` sat in a `"use server"` file, where **only
async functions may be exported**. Typecheck green, every test green, build
RED. Same family as the `export *` trap CLAUDE.md records for the actions
barrel, and the second time today that `pnpm build` was the only check that
could see a defect.

The old link field stays exactly as it was. A revision can still carry a link
for reading; what it cannot do is be pinned on until somebody uploads the file.
The empty state says that in those words rather than leaving a person to
discover it.

572 files / 8926 tests, typecheck, lint and a full production build clean.
**Not clicked yet** — the upload path needs a real PDF through a real browser,
and that is the next thing.
