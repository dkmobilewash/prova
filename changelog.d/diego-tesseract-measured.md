### A free OCR engine was priced against the model, and cannot do this job

Reading a scanned sheet costs about fifteen Opus calls, and a contractor with
a scanned set has a lot of sheets. Tesseract is Apache-2.0, runs as WASM, and
could run IN THE BROWSER — which would cost nothing per page and would mean
the drawing never leaves the machine at all, stronger than the confidentiality
rule requires rather than weaker. It was worth measuring.

Measured on the same two scans, the same tiles, the same 30-point tolerance,
and the same answer key — the vector drawings the scans were made from:

| | Opus 5 | Tesseract |
| --- | --- | --- |
| printed strings read exactly | **101/101 (100%)** | 24/101 (24%) |
| **placed within the 30pt the pairing allows** | **99 (98%)** | **17 (17%)** |

**Not adopted.** The gap is fourfold, which is not a tuning gap.

**It was given a fair run, and the first one was not.** The app renders tiles
at about 190 dpi because that is what makes a drawing legible to a VISION
MODEL. Tesseract's own documentation asks for 300 and up, so the first
measurement — 17% read, 10% placed — was testing the harness rather than the
engine. At 384 dpi it reads 24% and places 17%. Better, and nowhere near.

**And the numbers alone would have been read wrongly.** 58 "words" found
against 28 printed could mean a misreading engine OR one that tokenises
differently — Tesseract emits words, the key holds whole strings, so
`24'-6 1/2"` arriving as three words scores zero while being perfectly read.
The eval prints both sides for that reason. They show it genuinely reading
`KITCHEN`, `102`, `BATH`, `BEDROOM`, `105`, on the larger-scale sheet — and
returning `"®)"`, `"Ont"`, `"oi"` on the denser one. It is not a tokenisation
artefact. It is thin architectural lettering inside dense line work, which is
the hard case for classic OCR and the easy case for a vision model.

**What would change the answer, and is a project rather than a tweak:** erase
the line work before OCR. Classic engines expect text on clean paper, and this
repo already has a line detector — `rasterStrokes.ts` finds exactly the
geometry that is confusing it. Subtracting detected lines from a tile and then
running Tesseract is a real experiment nobody has run.

`tesseract.eval.ts` is kept, and `tesseract.js` with it as a dev dependency,
so the question can be re-asked cheaply — it calls no model, costs nothing,
and runs in six seconds. The licence is **Apache-2.0** for both the package
and its core, which is why it could be adopted at all if it ever wins.
