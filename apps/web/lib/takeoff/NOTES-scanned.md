# Scanned plans — the third lane's research notes (2026-10-27, `diego/scanned-plans`)

A scanned sheet is a bitmap: no path operators, so `sheetStrokes` returns
nothing and the wall finder has nothing to pair. This branch measures how far
the existing finder gets when the lines are read off the bitmap instead, on
the training sheets that already have answer keys. No product UI. No finder
file changed.

## 1. The test bench

The training sheets are vector, and they have keys. So each one is
RASTERISED the way a scanner would see it and scored against its own key:

| step | what | where |
| --- | --- | --- |
| render | the page at 150 / 200 / 300 dpi, 8-bit grey PGM | `realplan/scanTool.swift render` (PDFKit) |
| scan-like | skew 0.7°, speckle 0.4% of pixels, 3×3 blur, seeded | `raster/rasterDegrade.ts` |
| lines | ink pass + fill pass → segments in points | `raster/rasterLines.ts` |
| deskew | tilt from the long lines, page turned back, lines read again | `estimateSkewDegrees` + `skew` |
| text | tiled Vision OCR → `{str, x, y, width, height}` in points | `scanTool.swift ocr` |
| scale | the OCR'd caption through `printedScalesOnPage` + `scaleFromPrinted`; the key's scale as a flagged fallback | existing readers |
| detect | `detectForSheet` → `offeredCandidates`, exactly the vector path | existing |
| score | `scoreSheet` against `keyFromLabels` (accepted + traced) | `heldOutScore.ts` |

Held-out sets are refused by name (`heldOutReason`). 26 training label
sheets, 26,900 key ft. Diagonal key footage (more than 5° off an axis) is
65 ft — 0.2% — so an axis-only line pass is not what limits recall.

## 2. How the raster pass works, and what it is not

Binarise, walk every row for runs of ink longer than 0.15 in, merge runs that
sit on each other row after row into bands; same for columns. A band is one
segment from the row its ink starts on to the row it ends on — flat on a
square scan, tilted on a skewed one, which is what the tilt estimate reads. A
thick band whose rows are all full is a FILL and becomes its two faces, the
pair a drawn wall would have produced. The fill pass runs separately, on a
blurred copy at a looser threshold (245 of 255), because the ink threshold
(200) that reads lines misses light-grey poché and a threshold loose enough
for poché reads a scan's speckle as line work: measured 2,300 ft of junk on
one sheet with one threshold for both.

Not Hough, not LSD: one pass over the pixels, one threshold and one length,
and it degrades gracefully with tilt. Not a morphological closing either —
tried as gap bridging, and it merged parallel lines across their gap.

**Known limit, measured and left.** Lettering inside a grey room splits that
row's run, so a filled room comes out as several bands and the fill pass
draws an edge at every line of text (A100's existing wing). Letting a band
take several runs per row was tried and merged the rooms ACROSS the walls
between them — found footage fell by two thirds. The fix is a contour of the
fill rather than runs; that is production work (OpenCV `findContours`), not
a tweak.

## 3. Results (26 training sheets, 26,901 key ft; full tables in `shots/scanned/REPORT.md`)

| stack | arm | real ft | real % | junk ft | scale by OCR | median s |
| --- | --- | --- | --- | --- | --- | --- |
| — | vector finder | 23,793 | 88% | 13,014 | — | 2.4 |
| mac (PDFKit + Vision) | 150 / 200 / 300 clean | 19,435 / 20,340 / 19,839 | 72 / 76 / 74% | 33k / 29k / 28k | 22 / 22 / 20 of 26 | 2.6 / 3.5 / 5.5 |
| node (pdf.js + Tesseract) | 150 / 200 / 300 clean | 19,686 / 20,384 / 19,243 | 73 / 76 / 72% | 42k / 33k / 28k | 14 / 19 / 17 of 26 | 8.6 / 10.6 / 15.7 |
| mac | scan-like | | 65 / 63 / 64% | | 11 / 18 / 16 | |
| node | scan-like | | 58 / 62 / 71% | | 6 / 11 / 13 | |

The Linux stack reproduces the Mac numbers within two points; its OCR
reads fewer captions and takes most of the time. Contour fills raised
recall 5 points over run fills at every dpi and cut Baker A100's junk from
787 to 189 ft while moving its recall only from 607 to 679: the wing's
faces are found but sit a few pixels off the drawn line, which the finder's
thickness pairing refuses — a tolerance for the finder lane. 200 dpi is
the sweet spot. Diagonal key footage is 0.2%.

## 4. Cost and speed

Node stack per sheet: 8.6 s at 150 dpi (Tesseract 7.0), 10.6 at 200, 15.7
at 300; no model called. CPU on the ingest runner, inside its 45 s budget.
OCR of only the bottom band and title block would halve it.

## 5. Productising — the plan (2026-10-27, after the Linux stack and the contour fills)

**What runs where.** Everything in `lib/takeoff/raster/` is pure TypeScript.
The render is `pdfjs-dist` with its Node canvas (`@napi-rs/canvas`, prebuilt
for linux-x64/arm64, already in the lockfile under pdf.js) and the OCR is
`tesseract.js` (WASM, already a dependency). No native build, no Apple
framework, no new package. `scanTool.swift` stays as the research arm.

**1. Ingest knows a scan.** `PlanSheetText.hasTextLayer === false` plus
`sheetStrokes(...).pathOperators === 0` on a non-blank page is "image only".
The page inventory already records the first; the second is one read per
page the WALLS stage already does. Store nothing new: derive "scanned" from
those two at read time.

**2. A background stage, not a click.** The whole-set stage (PR D) runs
`detectWallsForCalibration` per sheet under the ingest runner; a scanned
sheet takes the raster road inside that same call: render at 150 dpi (no
gain above 200, measured), lines + deskew, Tesseract on tiles for the scale
caption, `detectForSheet`, the same `TakeoffWallProposal` rows. 150 dpi fits
the runner's 45 s budget with room (node stack: ~8 s per sheet of which
~5 s is Tesseract). The viewer's own "Find the walls" on a scanned sheet
does the same in the browser — pdf.js already renders there, Tesseract runs
in the browser — or defers to the server; decide on the first real scan.

**3. The estimator sees it.** Per sheet, a caution in the sheet picker and
over the found-walls panel: *"Scanned sheet — walls were read from the
image, not the drawing's lines. Check each group against the sheet before
adding it."* The groups list carries a `scanned` flag so the e2e and the
export can tell. No new table: the flag is derived (item 1).

**4. Scale.** Tesseract's caption through `scaleFromPrinted` first (22/26
clean sheets at 150 dpi with Vision; the Node run's count is in the report);
on a miss, the existing set-the-scale prompt. A vision-model call only if
the Tesseract miss rate on REAL scans is too high — one small call on the
title-block crop, priced from the model list at the time, never on the whole
sheet.

**5. Behind a switch, OFF**, like rooms and the export: `Company.scannedPlansOn`.

**6. What we need from a real scanned set before trusting any of this.**
Every number here is from vector sheets rendered and degraded by code. A
real scan differs in ways the bench cannot make: halftone and dither in the
greys (the fill pass reads a dither as line work), JPEG blocking, uneven
lighting, a photographed page's perspective, bleed-through from the back of
the sheet, and hand-drawn or redlined sets. The ask: five of the TRAINING
sheets that already have keys — Baker A101, ELEVEN03 A4.B.1, Camp Clark
A-101, Topeka p75, Joplin A-101 — printed and scanned on an office scanner at
150 and 300 dpi, greyscale, plus one photographed with a phone. Scored
against the same keys by the same bench (`SCAN_EVAL_STACK=node` with the
scan as the input instead of a render — a one-line change). That run is the
go/no-go for items 2 and 3.

**7. Not planned now.** Diagonal and curved walls (0.2% of key footage);
text other than the scale and the sheet number (room tags on scans would
need the OCR positions the room finder reads, which Tesseract gives — a
later step); the "no view kept → whole sheet" fallback in `detectForSheet`
(the original session's, coordinated in log.md).

## 6. Productized (2026-10-27, `diego/scanned-sheets` off main, switch OFF, not merged)

| piece | where |
| --- | --- |
| ingest marks a scan | `pageInventory.ts` counts path and image operators for a page with no text layer onto `PlanSheetText`; `scannedSheet.ts` derives the verdict |
| the stage | `PlanIngestStage.RASTER`, `plan-ingest/raster.ts` (`rasterWork`, `scannedPageNumbers`, `storedRasterFor`), per page `raster/rasterizeSheet.ts` at 200 dpi → `PlanSheetRaster` (lines, text, printed scale, in points) |
| the finder reads it | `detectWallsForCalibration` and the viewer's Find the walls take the stored lines and words when a page has them (`rasterByPage` from `workspaceLoad`) |
| the estimator | the viewer's caution on a read sheet; the OCR'd scale as the calibration prefill where the inventory has none, else the ordinary set-the-scale prompt; `ScannedSheetsPanel` reads the unread scans in one press |
| the switch | `Company.scannedPlansOn`, `ScannedPlansSwitch` on Settings, `saveScannedPlansSwitch` |
| tests | `scannedSheet.test.ts`, `raster/*.test.ts` (incl. a pdf-lib ARCH D sheet rendered and read with OCR stood in for), `plan-ingest/raster.test.ts`, `actions/scannedSheets.dbtest.ts` (switch, task scoping, the stored row, the page load) |

**Server budget.** One sheet per advance of the runner; the pdf is opened,
rendered and destroyed inside the task, and the canvas is dropped before
the lines are read, so nothing is held between pages. The numbers from
`realplan/rasterStage.eval.ts` on 50 pages of a training set are in §7.

**Not done, by design.** A scan with an embedded OCR text layer counts as a
drawing (it has text) and takes the vector road, which finds no strokes —
the page inventory could count operators for every page at the cost of one
operator-list read per page; left until a real set shows it matters. Room
tags on scans (the words are stored; the room finder does not read them
yet). The "no view kept → whole sheet" fallback in `detectForSheet` stays
with the original session. Validation on REAL scans waits for Diego's sets.

**Deferred e2e.** Settings switch on → the panel appears on a set with a
scan; press Read → the count climbs to done; open the sheet → the caution
shows and Find the walls offers groups; a sheet whose caption OCR read has
the one-press scale, one it did not shows the set-the-scale prompt.

## 7. Time and memory per sheet, measured (2026-10-28, `realplan/rasterStage.eval.ts`)

Baker EOC, the first 50 pages, every page read as if it were a scan, at
200 dpi with Tesseract, one page after another in ONE Node process on this
Mac, nothing else running. Raw rows in `shots/scanned-stage/{v1,v6}/`.

| | before the mitigations | after |
| --- | --- | --- |
| per sheet, median / mean | 8.8 s / 12.6 s | **6.1 s / 7.3 s** |
| per sheet, p90 / worst | 33 s / 45 s | **12.5 s / 17.4 s** (one sheet over 15 s: S2.0, dense small text) |
| Tesseract, median / worst | 7.7 s / 42 s | 4.8 s / 16 s |
| sheets whose number or title stopped OCR after the title block and bottom band | 0 | 31 of 50 |
| resident memory after a sheet, median / high-water | 846 MB / 2,027 MB | 756 MB / 1,188 MB |
| resident memory mid-sheet, worst | not sampled | 1,663 MB (A401, after the lines step) |
| lines found, per page | — | within 0.14% of before (band seams), scale read on 24 vs 26 |

**What the mitigations were.** The render draws the page in 600-px bands
into one reused canvas instead of a 138 MB full-page RGBA canvas, and the
page's pdf.js caches are dropped after it. OCR cuts its tiles straight from
the 8-bit grey into ONE reused tile canvas, never a full-page RGBA copy.
OCR reads the title block and the bottom band first, puts the sheet's own
number and title to `takeoffSheetVerdict`, and reads the rest of the page
only for a floor plan or a sheet it cannot name — a cover, a schedule, an
elevation sheet stops there with its lines kept. One Tesseract worker per
sheet, not one per pass. The lines are the same code at the same dpi, so
recall is unchanged by construction, and measured: the stage's own step
(`SCAN_EVAL_PIPELINE=stage`, region-first OCR and all) scored on the 26
training keys at 200 dpi gives 20,743 real ft (77.1%) against the bench's
full-page-OCR arm's 20,384 (75.8%), junk 32,365 against 32,806, the scale
read by OCR on 19 of 26 both times (`shots/scanned-stage/stage-arm/`).

**Tried and left out, measured:** a second pass over the title block at
half size, for the big numerals Tesseract misses — read nothing new on
Baker and cost 5–7 s a sheet. Tesseract reads the sheet number on 1 of 50
Baker pages at any size; the early stop goes by the title words it does
read ("COVER SHEET", "SCHEDULE"), which is why 31 sheets stop and the
floor plans do not.

**Memory, with one worker per sheet (2026-10-28).** The render and the
OCR now run in a `worker_threads` Worker closed with the sheet
(`SheetWorker`, `rasterWorker.mjs`), so pdf.js's decoded page, the
canvases and Tesseract's WASM heap are torn down with the isolate instead
of staying in the process. Measured on the same 50 pages, resident memory
AFTER a forced collection at the end of each sheet:

| | in one process, no isolation | worker per sheet |
| --- | --- | --- |
| after the first five sheets | 381 → 846 MB | 192, 161, 172, 289, 293 MB |
| after a sheet, median over 50 | 756 MB | 726 MB |
| after a sheet, worst | 1,188 MB | 1,471 MB |
| mid-sheet, worst | 1,663 MB | 1,629 MB |
| JS heap after collection | 116 MB | 21 MB |

So the per-sheet RESIDUE is gone — the first sheets end where the process
started, and the JS heap holds nothing — but the resident high-water mark
on THIS host did not come under 1 GB: once the dense sheets (p6 onward)
have been read, RSS sits at 0.5–0.95 GB between sheets and peaks at 1.5 GB
inside one. With 21 MB of live heap that figure is the allocator keeping
pages the isolates freed, which macOS libmalloc does; glibc on Linux
unmaps large blocks on free, so a Linux function should see the first
column's shape, and that is a claim this Mac cannot prove. Timing is
unchanged by the worker (median 6.2 s, p90 12.6 s on the uncontended run).

**The host limit assumed:** a Vercel Fluid function of 1,769 MB, with
1 GB as the design budget for one sheet so two never need to overlap.
What would settle it, in order: the same eval in a Linux container
(none on this machine), or the stage on a preview with a real scanned set
and the function's memory read off the runtime log. If Linux disagrees
with the expectation, the next step is a child PROCESS per sheet, whose
exit returns everything by construction; the worker file is the half of
that work that already exists.

**A gap the early stop opens, for the record.** A scanned sheet whose
title stopped OCR (an elevation sheet, say) has no scale caption read, so
detection never runs on it unless the estimator sets a scale by hand; if
they do, its captions were never read either, so the sheet takes the
single-drawing path and measures the elevations as walls. The cure is to
carry the OCR'd title into the sheet index so `sheetSuitability`'s own
"not a floor plan" caution and the whole-set skip apply to scans — one
field the stage already has; not wired here.

## 8. The whole-sheet fallback (2026-10-28)

`wholeSheetFallback` in `offeredCandidates.ts`, in `detectForSheet`'s
multi-view branch only: when drawings were found, none could be measured,
and none was set aside for a NAMED reason (notes, legend, schedule,
elevation, section, detail), the whole sheet is measured as one drawing and
the caution says so ("check each group against the sheet"). A drawing the
caption reader could only mark "check it", or could not scale, is not a
named reason — that is the shape OCR noise takes. Baker A201 names all its
views and stays at zero. Pure rule, four tests.

**The 31-sheet vector sweep is byte-identical** before and after
(`shots/scanned-stage/sweep/sweep-{before,after}.json`, `cmp` clean).

**It does not fire on the four bench cases, and here is why.** With the
contour fills and line-level OCR now on the branch, the zeros that named
those cases are gone or have another cause:

| case | stack | before the fallback | the view path says |
| --- | --- | --- | --- |
| Joplin A-101, 150 dpi | Tesseract / Vision | 4,887 / 4,585 ft found | views kept |
| Murray A101, 150 dpi | Vision | 126 of 1,037 ft | views 6, kept 2 ("or Plan", "1st Floor Plan") — region placement, not an unkept view |
| NG McAllen A3.2, 300 dpi | Tesseract / Vision | 759 / 1,646 ft | views kept |
| Bunkie A100, 300 dpi | Vision | **0 of 470 ft** | views 2, kept none, leftOut "Equipment: an equipment plan, not to scale" + legends — every view NAMED, so by the rule it stays at 0 |

Over all 26 training sheets at 150 and 300 dpi, clean and scan-like, on
the Mac stack: the fallback fired on none, and every arm's footage is
unchanged. Bunkie's zero is the one worth a decision: the floor plan's
caption was read as the equipment plan's, so the only drawing left is
"not to scale" and named. Treating a not-to-scale exclusion on a SCANNED
sheet as unnamed when the sheet's scale is already known would measure it
— a widening of the rule that is Diego's call, not made here.

## 9. Captions a scan can be trusted on (2026-10-28)

The scanned zeros were OCR noise read as NAMED views: a hatch read as
"ELEVATIONS", a title block as "NOTES", a caption misread into a word that
happens to be real — and `excludedViews` then set the pieces aside for
reasons that sounded like an estimator's, so nothing was measured and the
whole-sheet fallback (§8) could not fire, by its own rule.

`scannedCaptions.ts`: on a sheet whose lines came off a bitmap
(`detectForSheet({ scanned: true })`, set by the server when a
`PlanSheetRaster` row exists and by the viewer when it has one), a caption
is believed only when the OCR line behind it scored ≥ 70 AND every word of
it is a word a drawing caption uses (the classifiers' own vocabulary plus
the ordinary qualifiers; a letter outside A–Z is OCR reading a stroke). A
sheet with fewer than two believable captions takes the single-drawing
path. A vector sheet never sets the flag.

| case (Mac stack, where the zeros were) | before | after |
| --- | --- | --- |
| Bunkie A100, 300 dpi | 0 of 470 ft; views 2, "Equipment: an equipment plan, not to scale", legends | 774 found, 12 missing; views 0 → single drawing |
| Murray A101, 150 dpi | 126 of 1,037; views 6, two kept, 1,548 ft lost to placement | 2,383 found, 236 missing; views 0 |
| Joplin A-101, 150 dpi | 4,585 found | unchanged, now via the single-drawing path |
| NG McAllen A3.2, 300 dpi | 1,646 found | unchanged, same path |
| rasterized Baker A201 (elevations), 200 dpi, Tesseract | — | OCR stops at the title block ("elevations"), no scale caption read, no detection run: 0 |

**The vector sweep**: `sweep-before.json` against `sweep-after2.json`, 36
labelled sheets — every detection column (proposed, views, kept, others,
leftOut) identical on every sheet. The files are not byte-identical
because the KEY changed on 16 sheets between the two runs (another session
relabelled; `key`, `missing`, `extra` moved with it), which is why the
comparison is by column and says so.

## 10. Bunkie A100's rule widening — what it would take, and the risk (not built)

Bunkie's zero is gone by §9, so this is for the record. Had the caption
been a REAL word with high confidence — "EQUIPMENT PLAN" read off the
equipment plan, while the floor plan's own caption went unread — the sheet
would still measure nothing: one named not-a-plan view, no plan view.

What it would take: in `wholeSheetFallback`, treat a not-to-scale or
not-a-plan exclusion on a SCANNED sheet as not disqualifying when the
sheet's scale is already known (`feetPerUnit` is), so the whole sheet is
measured as one drawing; or, narrower, re-run the caption detector with the
untrusted captions removed and keep the largest region as "the plan".
Both are a few lines in the multi-view branch.

The risk is the one the rule exists to stop: a scanned sheet of eight
interior elevations, correctly captioned, would be measured as one drawing
and offer hundreds of feet of elevation lines as walls — the "worst
available answer" the comment in `detectForSheet` names. On a scan the
estimator cannot tell the two cases apart from the panel; only the caution
would say "check it". So it should wait for a real scanned set with that
shape in it, and be decided on that set's numbers.

## 11. PR-ready (2026-10-28)

- `Company.scannedPlansOn` OFF by default; nothing on the takeoff changes
  until the owner flips it under Settings.
- Migration `20261027200000_scanned_sheets`: additive only — two nullable
  counts on `PlanSheetText`, the `PlanSheetRaster` table, the `RASTER` enum
  value, one company boolean. Applied to a throwaway local Postgres for the
  db test, dropped after.
- Unit suite and db test green on the final tree (numbers in the log line).
- Not built, by design, listed in §6; the whole-sheet fallback (§8) is in
  and inert on every sheet measured so far.
- Memory: one sheet per worker, closed with the sheet (§7); the host limit
  assumed is 1 GB of a 1,769 MB Fluid function.

**E2E to run when Clerk is quiet** (none run here):

1. Settings → the owner ticks "Read scanned sheets", saves; the switch
   survives a reload. With it off, the takeoff of a set with a scanned page
   shows no "Read N scanned sheets" panel.
2. Takeoff of a set with one scanned page and the switch on: the panel
   says "1 sheet is scanned", press Read → "1 of 1 sheets — done".
3. Open that sheet: the caution "Scanned sheet: the lines were read from an
   image…" shows; Find the walls offers groups; the calibration prefill
   shows the OCR'd scale when the caption was read; with no caption read,
   the ordinary set-the-scale prompt shows and nothing else.
4. A vector sheet in the same set: no caution, Find the walls unchanged.
5. The whole-set stage (PR D) on a scanned page writes proposals from the
   stored lines (detectWallsForCalibration reads the raster row).

## 12. The first real scan, and the half-inch that hid it (2026-10-29)

8102 Evergreen BLDG D is the first set in the corpus that is a scan rather
than a vector export: 106 pages, every one a single 14,600 x 9,800 px 1-bit
image (100 CCITT G4, 6 JPEG) at 400 dpi, no paths, no text. The inventory
calls all 106 scanned; the stage rasterised all 106 and found lines on all
106; and it measured NOTHING, because it read a scale on zero pages.

**The caption was read. The page size refused it.** OCR returns
`1/8" = 1'-0"` on the plan sheets (p24, p27 at confidence 57), and
`printedScalesOnPage` hands it on. `scaleFromPrinted` then asks
`standardSheetSize` whether 2628 x 1764 pt is a sheet, with a two-percent
gate — and a scan is the paper plus the scanner's bed: 36.5 x 24.5 in, half
an inch over ARCH D on each edge, 2.1% on the short one. Refused, on every
page. A vector export never hit this because its page size IS the plot size.

The fix is one option: `standardSheetSize(w, h, { scanned: true })` admits
an inch each way in absolute terms, because a scanner's margin does not
scale with the paper. Only the raster stage passes it; a vector sheet keeps
the exact gate, so a 50% reduction is still refused where it always was.
The scale still comes only from the printed caption. Unit test pins the
Evergreen size refused as vector and accepted as scan, and a 30 x 20 in
scan still refused.

| Evergreen, 106 pages | before | after |
| --- | --- | --- |
| pages with a scale read | 0 | AFTER_SCALE |
| pages with walls found | 0 | AFTER_WALLS |
| feet found, total | 0 | AFTER_FT |
| sheet number read | 5 (all wrong) | AFTER_SHEET |

AFTER_OVERLAYS

**Sheet numbers are still not read on a scan, and that is the next defect
in this lane.** The title block's big number comes through OCR at 200 dpi
as `BUILDING D A244 1 B it` (h 39 pt, confidence 68) for the printed
`A241B` — split, with a 1→4 confusion — and `sheetNumberFrom` rightly does
not accept that. What it needs: a second pass on the title block's bottom
cell at 300 dpi, single-line mode, whitelist `A-Z0-9.-`, then a fuzzy join
against the set's own sheet index (CS01/CS02 list every number) so a read
within edit distance 2 of exactly one index entry resolves to it. Not
quick; not built.

**Label sweep, every labelled vector sheet, before and after:** `zzViewSweep` over all 36
labelled sheets (training and held-out, read only as "did it move"), from a
detached checkout of `origin/main` and from this tree: the two JSON files are
byte-identical, every sheet (`shots/scan-scale/sweep-{before,after}.json`).
A first "before" taken on a tree that predated #828/#829 differed on 29
sheets — those are the finder changes in between, not this one; the
comparison that counts is from the same base.

### Cost per page on a real scan, and what would bring it under 5 s / 1.5 GB (report only)

Measured over the 106 pages, this Mac, one process, nothing else running
(`shots/scanned-real/evergreen/run.log`):

| step | median | p90 | worst |
| --- | --- | --- | --- |
| render (pdf.js, 200 dpi, banded) | 5.4 s | 9.0 s | 27.9 s |
| lines | 0.8 s | 1.6 s | 2.4 s |
| OCR (Tesseract, tiles) | 7.6 s | 15.3 s | 58.2 s |
| **page** | **14.1 s** | **27 s** | **85 s** |
| RSS after render | 2,250 MB | 3,226 MB | 4,118 MB |
| RSS after OCR | 980 MB | 2,091 MB | 3,200 MB |
| RSS after the sheet (worker closed) | 876 MB | — | 3,042 MB |
| live V8 heap | 19 MB | | |

§7's numbers were Baker — vector sheets rendered as if scanned, so pdf.js
was rasterising paths. A real scan is a different cost: the page is one
400-dpi 1-bit image, and pdf.js decodes it to a full-resolution RGBA
picture before drawing it scaled into the band canvas. 14,600 x 9,800 x 4
is **572 MB per copy**, and the 2.2 GB median after render is that picture,
its decode buffer and the band. That is where the memory goes, and it is
also most of the render time (CCITT decode + a 143 Mpx scale-down in JS).

What would get a page under ~5 s and the peak under ~1.5 GB, in the order
it pays:

1. **Decode the scan's image directly, never through pdf.js's canvas.** The
   inventory already knows the page is one image. Read that XObject's
   stream and decode it ourselves — pdf.js exports `CCITTFaxDecoder`, and
   JPEG goes through `@napi-rs/canvas`'s `loadImage` — straight into the
   200-dpi 8-bit grey by 2 x 2 box-averaging the 1-bit rows as they
   stream. Working set ~36 MB grey + one decoded row band; no RGBA copy
   ever exists. Expected: render from 5.4 s to ~1 s, RSS after render
   from 2.2 GB to under 300 MB. This one change meets the memory target on
   its own. Needs a bench on the 6 JPEG pages too.
2. **Run the lines step inside the sheet worker as well.** It runs on the
   main thread today, over the 36 Mpx grey with its contour labels, and
   the 876 MB median left behind after every sheet (against a 19 MB live
   heap) is that step's freed-but-retained allocation. Moving it into the
   worker lets the worker's teardown return it. Nothing changes in the
   lines code.
3. **OCR: skip blank tiles, then parallelise.** A plan sheet is ~20 tiles
   of 1,600 px at 200 dpi and a third of them hold no text-sized ink —
   count dark pixels per tile before encoding it (the grey is already in
   hand) and skip the empty ones. Then two Tesseract workers instead of
   one halve the wall time on the rest; this is CPU-bound WASM, so on
   Fluid it costs the same CPU and finishes sooner. Each tile is also
   PNG-encoded and decoded again on the way in; handing Tesseract the raw
   grey tile saves that round trip (bench it; tesseract.js's Node input
   types need checking).
4. **Keep one Tesseract worker warm across sheets** — `createWorker` plus
   the language file is ~1 s per sheet. This pulls against §7's
   one-worker-per-sheet memory answer, and is only worth it once 1 and 2
   have made the sheet's own memory small.

Honest bound: render + lines can reach ~2 s. OCR on a floor plan that
needs the whole page read cannot reach 3 s single-threaded at 200 dpi;
with blank-tile skipping and two workers it plausibly can. The 43 pages
whose title block says they are not plans already stop after the first
look and would land near 3 s total.
