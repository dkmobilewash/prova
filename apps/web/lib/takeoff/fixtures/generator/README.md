# Takeoff fixtures — 20 synthetic floor plans with exact answers

Every answer comes from the generator's own geometry, so it is correct by construction. Nobody measured anything by hand.

## Regenerate

```
cd takeoff/fixtures
python3 -m venv .venv
.venv/bin/pip install shapely reportlab pdfplumber Pillow pypdfium2
.venv/bin/python generate.py     # rebuilds spec/, synthetic/S01..S20, contact_sheet.png
.venv/bin/python validate.py     # pass/fail table; exits non-zero on any failure
```

Running `generate.py` twice gives byte-identical files: seeds are fixed and reportlab runs in invariant mode, with no dates or IDs in the PDFs.

Licences: shapely (BSD), reportlab (BSD), pdfplumber (MIT), Pillow (HPND), pypdfium2 (Apache-2.0 / BSD-3). PyMuPDF is not used anywhere.

## Files

| File | What it is |
| --- | --- |
| `plans.py` | The 20 plans as code: walls as centerlines with thickness and type, openings by distance along their wall, room label points. **The source of truth.** |
| `common.py` | Spec → geometry → answers, with shapely. Shared by the generator and the validator. |
| `draw.py` | Draws a spec onto a PDF sheet with reportlab. |
| `generate.py` | Builds everything below. |
| `validate.py` | Checks every plan and prints the table. |
| `spec/SXX.json` | The resolved spec for each plan, plus where it was drawn on the sheet (origin, points per foot, every dimension string). |
| `synthetic/SXX/plan.pdf` | The vector plan (S01–S17). |
| `synthetic/SXX/plan_raster.pdf` | The scanned copy (S18–S20): image only, no text layer. |
| `synthetic/SXX/expected.json` | The answer sheet. |
| `synthetic/SXX/answer_key.png` | The plan with the correct answers drawn on top. Red = exterior wall centerline, blue = interior, tint = room with its area, green dot = door, teal dot = window. |
| `synthetic/contact_sheet.png` | All 20 answer keys, five to a row. |

## Measurement rules

The answer sheets follow these exactly, and the takeoff engine is scored against the same rules.

- **Wall length (LF)** is measured along the wall centerline. At an L-corner the centerlines meet at the corner point, so nothing is counted twice. At a T-intersection the branch stops at the centerline of the wall it meets.
- **Gross wall LF** ignores openings. **Net wall LF** = gross minus the widths of every door and window opening in that wall.
- **Exterior walls** form the building's outer boundary; everything else is interior.
- **Wall area (SF)** = net wall LF × ceiling height, per wall, with exterior and interior reported separately.
  - *One clarification:* a wall the spec marks **partial-height** (S14's 4'-0" stub walls) uses its own height where that is lower than the ceiling. The per-wall `height_ft` field says which height was used, and `partial_height: true` flags the wall.
- **Room area (SF)** is the net floor area measured to the inside face of the surrounding walls. A free-standing wall inside a room (S14) is subtracted from that room.
- **Room perimeter (LF)** is the perimeter of the same inside-face polygon, around its outer boundary.
- **Gross building area (SF)** is the area inside the outside face of the exterior walls.
- **Door and window width** is the clear rough-opening width as drawn: the gap in the wall.
- **Rounding:** lengths to 0.01 ft and areas to 0.01 SF in the file. The scorer applies the tolerances.

### Conventions worth knowing

- **Door gaps do not merge rooms.** Rooms are computed with every opening closed.
- **Dimension strings** run to the outside face of exterior walls and to the centerline of interior walls. Every one is checked against the drawing (see validation).
- **Metric plans (S16, S17)** are authored in millimetres. Every length is still reported in feet, as the format requires, and each wall also carries `length_m`. Room area tags print in m².
- **Curved wall (S07):** the arc length is the centerline length, r × θ. The PDF draws the arc as a fine polyline (96 segments).
- **S10** prints no scale anywhere. `scale_text` is `null` and `scale_ratio` is the true 48.
- **S11** prints `1/8" = 1'-0"` but is drawn at 1/4". `scale_text` is what is printed and `scale_ratio` is the true 48.
- **S12** shows its scale only with a graphic scale bar, and `scale_text` is `null`.
- **S15** has two views. The answers count the building once, from the 1/4" plan. `viewports` lists both views and their scales.
- **S18–S20** are rasters of S02, S08 and S13. Their answers are identical to the originals; only `id`, `file`, `kind`, `notes` and `raster` differ.

## The 20 plans

| ID | Building | Scale | Walls drawn as | Page | Kind | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | One room, 24' x 16' | 1/4" | line pairs | 11x17 | vector | baseline; 2x6 plus an 8" CMU wall |
| S02 | 2-bed cottage, 6 rooms | 1/4" | line pairs | 18x24 | vector | basic residential |
| S03 | S02 again | 1/8" | line pairs | 11x17 | vector | same answers at another scale |
| S04 | 3-bed house, 10 rooms | 1/4" | filled | 18x24 | vector | Revit-style walls, an L-shaped hall |
| S05 | L-shaped house, 9 rooms | 3/16" | line pairs | 18x24 | vector | reflex corner, CMU garage wall, 16' overhead door |
| S06 | House with a 45° wing | 1/4" | filled | 18x24 | vector | angled walls, 12" masonry wall |
| S07 | Cottage with a curved bay | 1/4" | line pairs | 18x24 | vector | arc length |
| S08 | 4-bed house, 13 rooms | 1/4" | line pairs | 24x36 | vector | heavy clutter, grid, dense dimensions, 12" masonry |
| S09 | Abbreviated labels | 1/4" | line pairs | 18x24 | vector | LIV, DIN, KIT, MSTR BDRM, MSTR BA, WIC, BDRM 2, LDRY, PWDR |
| S10 | Garden cottage | 1/4" (unstated) | line pairs | 11x17 | vector | scale from dimension strings only |
| S11 | Guest house | 1/4" (note says 1/8") | line pairs | 11x17 | vector | dimensions must override the note |
| S12 | Child-care center, 10 rooms | 1/8" | filled | 11x17 | vector | scale bar only |
| S13 | Office suite, 12 rooms | 1/8" | filled | 18x24 | vector | commercial, column grid |
| S14 | Open office | 1/8" | line pairs | 24x36 | vector | partial-height and free-standing stub walls |
| S15 | Bungalow plus enlarged bath | 1/4" + 1/2" | line pairs | 24x36 | vector | two viewports, two scales |
| S16 | Metric apartment, 7 rooms | 1:100 | filled | 11x17 | vector | mm dimensions, 300/200/115 mm walls |
| S17 | Metric retail unit, 6 rooms | 1:50 | line pairs | 18x24 | vector | metric at a larger scale |
| S18 | Scan of S02 | 1/4" | — | 18x24 | raster 300 DPI, 0.3° | clean scan |
| S19 | Scan of S08 | 1/4" | — | 24x36 | raster 150 DPI, 1.2°, noise | noisy scan |
| S20 | Scan of S13 | 1/8" | — | 18x24 | raster 300 DPI, −0.8° | scanned commercial |

Wall types across the set: 2x4 interior (4.5"), 2x6 exterior (6.5"), 8" CMU, 12" masonry, plus metric 115 mm, 200 mm block and 300 mm exterior. Every plan uses at least two.

## What validate.py checks

1. **Geometry closes.** The walls enclose exactly one room per label, and no room is unlabeled, outside the building or overlapping another.
2. **Areas add up.** Room areas plus wall footprint equal the gross building area, within 0.5% (they actually agree to 0.0000%).
3. **Openings fit.** Each opening sits on its wall's centerline, inside the wall's length, overlaps no other opening, and cuts into no other wall.
4. **Drawing matches spec.** Every wall-outline edge the spec implies is sampled every 3 inches and must have a drawn line within 0.05 ft. The lines are extracted from the PDF with pdfplumber and converted with the true scale. A wall moved 3 inches in the drawing alone fails this check; that was tested.
5. **Dimension strings are true.** Each printed string is read back from the characters on the page, including vertical ones. It must equal the length of the drawn dimension line it labels, measured off the PDF, and the spec distance.
6. **Pairs agree.** S03 is identical to S02, and S18, S19 and S20 are identical to S02, S08 and S13.
7. **Labels.** Every room has exactly one name inside it, read whole so that BEDROOM inside MASTER BEDROOM doesn't count twice, and every type is from the fixed list.
8. **Rasters are image-only.** One image, no characters, no vector paths.
