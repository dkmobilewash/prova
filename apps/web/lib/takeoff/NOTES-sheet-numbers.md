# Sheet numbers on a scan

Companion to `NOTES-scanned.md`, in its own file so two branches that both
append to that one do not collide. 2026-10-29.

## 1. What was wrong

A scanned sheet has no text layer, so its number can only come from OCR,
and OCR of the biggest text on the page is where Tesseract is worst. The
tiled title-block pass (`FIRST_LOOK` strips, automatic layout) over 8102
Evergreen's 106 pages produced five designations, four right, none an
A-sheet: p22 read `BUILDING D A244 1 B it` for `A241B`, p105 `S112` for
`S11.2`. The product therefore had NO name for any scanned sheet.

## 2. What was measured before building

`zzCellDebug` on p22 and p105, the bottom-right corner cut out of the
200-dpi grey, every combination of page-segmentation mode (7 single line,
6 block, 11 sparse), upscale (1x, 2x) and a designation whitelist:

| | p22 (A241B) | p105 (S11.2) |
| --- | --- | --- |
| line mode, 1x | `) A24TE \|` | `S112` |
| line mode, 2x | nothing | nothing |
| block mode, 1x / 2x | `EAST` + `2D PERMIT SET…` | `511.2` / `$11.2` |
| **sparse, 2x** | `EAST` · **`A241B`** c85 · `PERMIT SET…` · `qv` c18 | **`S11.2`** c68 |
| any mode with whitelist | same text, every confidence 0 | same |

Sparse mode at 2x reads both; the tallest confident line that matches the
designation pattern is the number. The whitelist does nothing but zero the
confidences — tesseract.js runs the LSTM engine, which ignores
`tessedit_char_whitelist` — so it is not used.

**Caveat, stated because it matters:** Evergreen is the held-out scanned
key (`diego/scanned-held-out`), and those two pages of it were looked at to
choose the mode. That is a choice of instrument, made on two pages, before
the count below was run on all 106; nothing after it was tuned on the
result. The next scanned set is the honest test of the mode.

## 3. The count

`realplan/sheetNumbers.eval.ts`, all 106 pages, against a by-eye key read
off a contact sheet of every title-block cell
(`~/Claude Folder/takeoff/answer-keys/sheet-numbers/evergreen.json`, outside
the repo). Cost: one extra Tesseract call on a 1,022 x 588 crop at 2x, about
1.5 s a page.

| | all 106 | A-sheets (49) | CS (4) | XBE (20) | S (33) |
| --- | --- | --- | --- | --- | --- |
| strips (before) | 4 | 0 | 0 | 1 | 3 |
| corner, sparse 2x (after) | **71** | **37** | 4 | 2 | 28 |

The 35 misses, so the next person does not re-read the log:

- **XBE sheets, 18 of 20 read nothing.** Their number is set in a condensed
  face (`XBE5.00`), and the read comes back with the 5 as an S — `XBES.00`
  — which has four letters and so is not a designation. The one that did
  read, `XBE.06`, lost the 5 entirely. A confusion map (S→5, O→0, I→1) in
  the digit position would catch these and would also turn `CS01D` into
  `C501D`, breaking four cover sheets that read right today; not applied,
  because deciding it on this set is tuning on the test.
- **A-sheets, 12 of 49:** a doubled glyph (`A2408B`, `AZ241A`, `A2243A`,
  `OOA501`), 5 read as S (`AS00`, `AS02`, `ASS0`), 8 as 3 (`A430`), 6 as 0
  (`A240A` for A246A), and four that read nothing (p11, p34, p40 and p53's
  neighbour).
- **S sheets, 5 of 33:** `S1`, `S8`, `S7` read nothing (two characters, one
  of them a bare digit, is little for sparse mode to anchor on); `S1.1`
  read `S11`; `S2W` read `S2`.

## 4. The snap, built and removed

The plan's third step was a set-level vocabulary: every designation-shaped
token across all of a set's pages (its cover index, its callouts, its other
title blocks), with a read within one or two edits of exactly one entry
snapped to it. Built as `sheetNumberSnap.ts`, with the guard that a target
must be named on two or more pages, and measured on the same run:
**71 → 67.** `A241B`, `A242B` and `A240B`, all read RIGHT, moved to
`A245B`, which the set names on several pages (the key plans) and which is
one edit from each. A right read has no way to defend itself against a
popular neighbour. Removed rather than tuned; the misses above are glyph
confusions inside the number, which a vocabulary cannot see either.

## 5. Where it lives in the product

- `rasterWorker.mjs` `ocrCell`: a second Tesseract worker, so the tiled
  pass's parameters and words are untouched — the walls on every one of
  Evergreen's 36 scale-read pages are what they were.
- `rasterizeSheet.ts`: `sheetNumberCell`, `sheetNumberFromStrips`, and
  `sheetNumber` = the cell read, else the strips'. `takeoffSheetVerdict`
  gets the better one, so the early stop improves with it.
- `PlanSheetRaster.sheetNumber` (migration `20261029160000_raster_sheet_number`)
  stores the read; an observation like `printedScale`, not a label.
- `workspaceLoad.ts` hands it to `sheetPickerLabel` for a scanned page that
  the inventory could not name. Nothing derived is stored.

## 6. Numbers the text-layer reader missed (2026-10-31)

Four causes, all on sheets with a text layer: a number split into items (`I` `-` `000` on HPL, `G` `−` `001` on Topeka, a real minus sign), a two-part prefix (`P-A1.1` on Riverside), the sheet's place in the set after the number (`C0.10 (2 OF 29)` on Eleven03's approved set), and a joined number must not be doubled: Murray prints every number twice over itself, which the first version of the join read as `A110A110`. A sweep of every training set against the old reader caught that.

Eleven03's p19 and p22 had read `C2` and `B3` off the page, wrongly; they now read C5.10 and C6.11.

Lettering drawn as strokes is a different class: all 26 pages of 108049 and Topeka's 34 civil sheets (`C100`). OCR is the only reader for it. The bottom-right cell does not find 108049's, because the sheet's content is turned a quarter inside an unrotated portrait page, so its number sits sideways at bottom-left.
