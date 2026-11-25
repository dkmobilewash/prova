### The scanned-sheet worker ships every Tesseract core, because Tesseract does not pick the one it is asked for

**What happened in production.** #1255's proof (2026-11-25, 17:17:10Z, dpl_D4mdMAhd) got pdf.js loading in the worker
for the first time. Tesseract then died with `Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd'`.
- tesseract.js 7.0.0's thread calls `getCore(lstmOnly, …)` with a boolean.
- Its Node `getCore` compares that to the OEM numbers, so in Node it always loads a **non-LSTM** core.
- #1255 shipped only the LSTM cores.
- The CI check agreed with that mistake, because it called `getCore(1, …)`, the value assumed, instead of what the
  thread really passes.

**What changes.**
- Every `tesseract-core*` file is included.
- The check loads **every core the package ships**, through the thread's own `require` inside the traced function. The
  list is read from the installed package, never from the function being judged.
- An opt-in step, `RASTER_TRACE_OCR=1`, runs a real OCR through the worker. It downloads Tesseract's language data
  from its CDN, so it is not on every CI build. It passes only when Tesseract reads back a title printed as a picture,
  the way a scan carries it.

**Checks.**
- On main's includes, the check fails naming the production module (`tesseract-core-relaxedsimd`) and two more.
- With every core included it passes: 6 cores.
- `RASTER_TRACE_OCR=1` reads "FLOOR PLAN" back inside the traced function.
