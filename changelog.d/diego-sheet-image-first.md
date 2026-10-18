### 46MB to look at one sheet, and range requests cannot fix it (Diego)
`diego/sheet-image-first`

No migration. An early return, an `<img>`, and a guard.

**MEASURED ON PRODUCTION AGAINST A REAL 113-SHEET SET**, which is the only
reason the size of this is known: opening ONE sheet pulled **46,337,022 bytes
in a single request lasting 138 seconds**. The whole drawing set, to draw one
page. It rendered correctly at the end of it — this is not a failure, it is the
feature being unusable in the place it is aimed at. A foreman on a tower crane
with one bar of signal is not waiting 138 seconds for sheet 47.

**THE OBVIOUS FIX DOES NOT WORK, AND IT WAS MEASURED BEFORE BEING BELIEVED.**
Range requests are the answer to "download only the page you need", and Vercel
Blob honours them: `Range: bytes=0-1023` returns `206` with exactly 1024 bytes.

| probed from the page, cross-origin | |
| --- | --- |
| range honoured at HTTP level | **yes — 206, 1024 bytes** |
| `accept-ranges` readable by JS | **null** |
| `content-range` readable by JS | **null** |
| headers JS can see | `cache-control`, `content-length`, `content-type`, `last-modified` |

Neither header is CORS-safelisted and the store sends no
`Access-Control-Expose-Headers`, so the browser hides both from JavaScript.
pdf.js decides whether to range-fetch by READING `Accept-Ranges`
(`validateRangeRequestCapabilities`), sees nothing, concludes ranges are
unsupported and streams the entire file. **`disableAutoFetch` is a no-op in
that state** — there is a guard asserting nobody adds it, because it is the
next thing anyone would reach for and it reads as obviously correct.

**So the viewer shows the PNG that "Prepare for the phone" already makes.** One
artefact, both surfaces — which is what the architecture always implied, since
the phone has no PDF renderer at all. The PDF path stays for a revision nobody
has prepared yet, and that is now the ONLY time those 46MB are pulled.

| mutation | result |
| --- | --- |
| control | green |
| **the early return deleted** (46MB a sheet returns) | **RED** |
| the image element renamed | **RED** |
| `disableAutoFetch` cargo-culted in | **RED** |

**The second of those passed on the first attempt and should not have.** The
assertion matched `/<img[\s\S]{0,200}src=/`, and `<img` is a PREFIX of `<imgX`,
so renaming the tag sailed straight through. A tag name needs its boundary
asserted — `<img\s`. The mutation found a weak test, which is the entire reason
to run mutations on a test that is already green.

Nothing else here could see any of this: no test in this repo measures a
network request, and the page renders correctly whether it pulls 46MB or 200KB.

576 files / 8940 tests, typecheck, lint, a full production build and preflight
clean. **The phone half is unchanged and still unproved on a device.**
