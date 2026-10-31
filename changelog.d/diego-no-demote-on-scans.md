### What actually changed, in plain English (Diego)
`diego/no-demote-on-scans`

**The wall model no longer greys out runs on a scanned sheet.** The model
was trained on vector sheets' rows — pen widths, layer names, exact face
geometry — and a scanned sheet's lines come off a bitmap with none of that.
On Evergreen, the one scanned set with keys, the grey-out cost 11.7 points
of recall and removed about no junk. On a page whose lines are the raster
stage's (`rasterByPage` has the page) `modelVerdicts` now returns nothing,
so every run stays on the list as the finder offered it; a vector sheet is
byte-for-byte what it was, which the test pins by comparing the two calls.
The per-company switch and labelling mode are unchanged.
