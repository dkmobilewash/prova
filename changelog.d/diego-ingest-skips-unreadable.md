### The plan-set ingest reads owner-encrypted PDFs and skips a file it cannot read (Diego)
`diego/ingest-skips-unreadable`

`scripts/add-plan-sets.mjs` counted pages with a bare `PDFDocument.load`, so
one owner-encrypted PDF (print/copy restrictions, no open password) threw
"Input document to PDFDocument.load is encrypted" and ended the whole run.
Round 10's Winnipeg appendix did exactly that. The count now goes through
`scripts/plan-page-count.mjs` with `ignoreEncryption: true` (only the page
count is read). Any file still unreadable is printed as NOT READY with the
reason, before a job or plan is created for it, and the run carries on.

The check: `lib/plan-page-count.test.ts` builds a made-up encrypted PDF,
proves pdf-lib's default load refuses it, and expects a page count of 3.
Removing `ignoreEncryption` reds it, and so does removing the `continue`
after NOT READY. Run for real against a scratch database over an encrypted,
a junk and a plain PDF: 2 pages, NOT READY "No PDF header found", 1 page.
