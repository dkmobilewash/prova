### `withCredentials` makes our own drawing unreadable, and blames the file (Diego)
`diego/blob-pdf-no-credentials`

No migration. Three lines deleted, one guard added.

**THE UPLOAD WORKED. The 113-sheet set Diego uploaded is in our store with all
113 pages recorded — the screen said "113 of 113 sheets are not ready for the
phone yet", which is the upload path working end to end.** What failed is the
step after: DISPLAYING it.

`withCredentials: true` on a pdf.js load turns the fetch into a **credentialed**
cross-origin request. A server answering one of those must name a specific
origin; `Access-Control-Allow-Origin: *` is refused by the browser, by design.
Vercel Blob serves public files with exactly `*`. So the flag takes a file that
reads perfectly and makes it unreachable.

Measured in the live page against the real uploaded drawing rather than
reasoned about:

| `credentials` | result |
| --- | --- |
| `"omit"` | **206 Partial Content** — reads fine |
| `"include"` | **TypeError: Failed to fetch** |

The file is public by construction (`access: "public"`), so there are no
credentials to send and nothing is lost by not sending them.

**THE REASON THIS COST A ROUND TRIP IS THE SENTENCE IT PRODUCES.** The catch
around the load says *"That sheet couldn't be opened. It may not be a PDF, or
the upload may not have finished."* — so a CORS refusal is reported as a bad
file, and the person goes and looks at their drawing. That is the third time in
one day that an error message here named the wrong cause, after the same defect
in `sheetPins.ts` and then in `SheetPinSurface.tsx`. The difference is that this
one is not a conflated try/catch: the message lists two guesses because the
browser genuinely does not tell the page WHY a CORS fetch failed. It is still
worth knowing that "it may not be a PDF" is the least likely of the two.

Fixed in all three components that open a PDF — the sheet viewer, the sheet
preparer, and `TakeoffPlanViewer`, which had the identical flag and would have
failed the same way the moment a takeoff plan was served from the blob store.

| mutation | result |
| --- | --- |
| control | green |
| the flag restored in the sheet viewer | **RED** |
| the flag restored in the takeoff viewer | **RED** |
| a listed component stops opening PDFs (scope) | **RED** |

The guard also asserts each site still EXPLAINS why the flag is absent. Without
that, `withCredentials` reads like something somebody deleted by accident and
gets helpfully restored — and the symptom comes back as "that drawing is
broken".

**Nothing already here could have caught this.** No test in this repo makes a
cross-origin request; typecheck, lint, 8,930 tests and a full production build
were all green with the flag set. The instrument was two `fetch` calls in the
page's own console, differing only in credentials mode.

575 files / 8937 tests, typecheck, lint, a full production build and preflight
clean.
