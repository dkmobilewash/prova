### The photo report — the arrow finally ends up on something you can hand somebody (Diego)
`claude/prova-company-cam-feature-6170v6`

A sub photographs a cracked header, drags an arrow onto it, and then has
nothing to give anyone. The marks live as rows beside the file and are never
burned into the pixels — deliberately, because a site photo is an evidence
record — so "just email them the photo" emails an unmarked photograph and
loses the point of the arrow. `FEATURE-AUDIT.md` had been carrying that as a
disclosed gap in the annotations row since the day marks shipped.

`/jobs/[id]/photo-report` closes it. One job's captures as a document, the
marks drawn over the photographs, grouped by the day they were taken,
printed with the browser's own Print / Save as PDF. Reached from the job's
photo section and from `/photos` with a job chosen; nothing in the nav links
it, because a photo report is one job's document the way WH-347 is one
week's.

**No PDF library was added, and printing is not the cheap way out — it is
the only way that works.** A flattened JPEG means drawing the photo into a
`<canvas>` and reading the pixels back with `toBlob`, and a cross-origin
image TAINTS a canvas: the read throws `SecurityError` unless the blob host
serves the CORS headers `crossOrigin="anonymous"` needs. Whether
`*.public.blob.vercel-storage.com` serves them **could not be established**,
and it is written down as unknown rather than guessed:

- the installed `@vercel/blob@2.8.0` — README and `dist` — contains no
  occurrence of `cors`, `access-control` or `crossOrigin`, and exposes no
  API to configure CORS on a store, so an app could not add the header if it
  is missing;
- Vercel's own documentation, searched through the docs tool, returns
  nothing about CORS on public blob URLs — only about client uploads and
  about adding CORS to your own functions;
- it could not be MEASURED from here. The agent egress proxy denies CONNECT
  to `public.blob.vercel-storage.com` (`connect_rejected`, gateway 403) and
  blocks `community.vercel.com` too.

So the honest position is: unknown, and shipping the canvas path on an
assumption would have failed in the worst available way. If the header is
absent, `crossOrigin="anonymous"` does not merely taint the canvas — the
image **fails to load at all**, so the bug would land on the photograph
rather than on the export, and the export itself would fail silently. **One
measurement settles it** and needs no credentials: open any site photo's
blob URL in a browser and read the response headers, or run
`fetch(url, { mode: "cors" })` from the app's own origin in the console.
Printing sidesteps the question entirely: the browser composites the `<img>`
and the SVG in its own print pipeline and never reads a pixel back.

**One `JobMediaMarks`, unmodified, now on three surfaces.** The report
renders each photograph in a 4:3 `object-contain` box, and that is
load-bearing rather than styling: a mark is stored as a fraction of the
surface it was DRAWN on, and `JobMediaAnnotator` draws on exactly that box.
Reproducing it puts the arrow on the paper where the person put it, for a
photograph of any shape, and shows the whole frame rather than the gallery
thumbnail's crop — which a document of evidence has to.

**Found while doing it, not fixed here:** the gallery card and the portal
render marks over an `object-COVER` 4:3 box, so for a photograph that is not
4:3 the marks sit over a cropped image while their coordinates came from a
letterboxed one. On screen they are slightly off; the report is the surface
where they are exactly right. Changing the two galleries is a visible
redesign of what a GC sees and wants clicking, so it is reported rather than
slipped in.

**What goes in is chosen, and the document says which.** A job's gallery
holds another trade's damage kept for a backcharge, an unsafe condition
documented defensively, and the crew's own mistake before it was put right.
So: the default with no parameter is the captures already shared with the
client; an unrecognised `?include=` falls back to that same safe default
rather than to everything (the opposite posture from `/photos`, which falls
back to no filter — on a gallery an unrecognised filter must not withhold,
on a document it must not publish); the printed header states the selection
in words, because that sentence has to survive leaving the app; and any
wider selection prints an INTERNAL banner and marks the individual pages the
client has not seen. Tags, the photographer and coordinates are excluded by
`JobPhotoReportCapture` **not having them**, the portal's enforcement for
stronger reasons — a PDF in an inbox cannot be unshared.

**Video and voice notes are listed, not dropped.** Paper cannot hold a
recording, and a document that silently omits a walk-through tells its
reader the job's record is these photographs. A GC handed one in a dispute
would reasonably say the sub disclosed everything they had.

**The specific checks.** 28 unit cases on the pure rules and 16 database
cases on the read, and thirteen deliberate mutations to prove they are not
decoration: the safe default flipped to "everything", `not-shared` made
undefined, the falsy-boolean spread written the obvious way, a coordinate
added to the projection, the internal banner narrowed, recordings dropped
instead of listed, the ordering, the day grouping, the href dropping its
other filter, the cap note silenced, the day heading computed in UTC, the
route's access decision deleted, and the page's guard swapped for another
capability. Every one went red naming the right case and every file came
back byte-identical by `sha256sum`. The UTC-day mutation initially SURVIVED
the database test because every fixture capture sat safely mid-afternoon in
both zones — a test that cannot see the bug it is for — so one capture moved
to 04:00 UTC, which is the previous evening in Los Angeles, and it fails
now. The refusal case is a MEMBER with `jobFunction: "ACCOUNTING"` read back
off a real row, with a FIELD control beside it and an OWNER case recording
why the refusal cannot be written against `role`.

No migration, no schema change, no new dependency.
