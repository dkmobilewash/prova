### Two exported `titleBlockText`, and a second title-block region — correcting #782

#782 shipped hours earlier. A tracking agent reading the plan against the repo
flagged it, and on checking, it was right about both defects. They are mine.

**The name was already taken.** `plan-ingest/planPdf.ts:354` exports a
`titleBlockText(page)` — same name, same folder — which returns the title block
as text in reading order *for the model*. #782 added a second exported
`titleBlockText` that nothing imported. Renamed to `sheetNumberFrom`, in
`sheetNumber.ts`, which is what it does.

**It invented a second title-block region.** `planPdf.ts` had already decided
where a title block is, and argued it better than I did:

> *"the right 40% of the width, OR the bottom 25% of the height… A filter
> assuming one convention would silently drop the sheet number on every set drawn
> the other way — and a dropped sheet number reads as the model failing, which is
> the most expensive kind of wrong."*

Mine was an **intersection** of a tighter box; theirs is a **union** of two
conventions with a whole-page fallback. **That module's warning predicted my own
miss rate** — #782 read a number on 149 of 218 real pages, and a title block
along the bottom with its number at x=0.3 is invisible to a right-hand corner.

The corner is now a first attempt that falls back to `titleBlockRegion`, and the
corner constants are declared as a **narrowing** of that module's pair, with
`CORNER_IS_INSIDE_REGION` asserting the relationship so the two cannot drift.
Two lists of the same value is the shape CLAUDE.md names; this is the guard.

### And #782's own claim was wrong

It said the change "removes a paid model call". It does not. `TITLE_BLOCK` calls
the model for the scale, the revision, the issue date and the page type as well,
so the sheet number is a **by-product of a call that happens anyway**.

What the reader is actually for, stated in the module: `effectiveSheetNumber`
returns **null when a page has no proposal row at all** (`sheetIndex.ts:63`). On
such a page `sheetSuitability` has nothing to judge and the duplicate-walls
caution — the thing that keeps 13,767 invented feet off a mechanical plan —
cannot fire. This reads the two fields that need no judgement, so that caution
works on a plan the model stage has not reached, is switched off for, or has run
out of allowance on.

### It still has no production caller, and that is said out loud

The takeoff page reads DB rows, not the PDF. The honest home is the
`PAGE_INVENTORY` stage, which already opens the PDF, calls no model, and persists
`planSheetText` and `planSheetScaleReading` — a sheet-number reading belongs
beside those. That is a schema decision (a column, or a read-time derivation off
the stored text), announced in Slack before the push, and deliberately not
smuggled into a correction.

### Verified

Preflight's four gates green, 701 test files, no production schema touched.

Five mutations red: the corner reaching outside `planPdf`'s region, the wider
fallback removed, a fallback reporting itself as a clean corner read, the corner
filter removed (which brings back the whole-page note bias), and the pattern
admitting a job number.

**Two things the mutations caught that the first version got wrong.** The subset
guard went red on my own reasoning: I asserted `CORNER_Y >= BOTTOM_FRACTION` and
0.72 is looser than 0.75 — but the region is a **union**, so anything right of
0.6 is inside it whatever its y. The assertion was wrong, not the constants.

And the rule this module is named after — largest text in the corner — is **not
load-bearing on any office measured.** A mutation replacing the type-size sort
with document order stays green, because inside the corner the pattern already
disambiguates: a job number and a date start with a digit, `PERMIT SET` has a
space, `DRAWING NUMBER` has no digit. The fixtures were reordered so the number
is never first, which ruled out the obvious artefact. The sort is kept as the
stated tiebreak and recorded as unproven, rather than a fixture being invented to
turn the mutation red — the same treatment the zero test in `scaleBar.ts` got
when the linear fit turned out to subsume it.
