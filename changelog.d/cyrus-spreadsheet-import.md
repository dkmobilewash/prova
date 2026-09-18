### Bring your clients, jobs and crew in from a spreadsheet, with a preview before anything is saved (Cyrus)
`cyrus/spreadsheet-import`

A new contractor's records live in a spreadsheet, a QuickBooks export or
their head, and the only way into C Stream was one form per record. A sub
with forty open jobs and a twenty-five-hand crew does not do that — they
keep the spreadsheet. `/settings/import` (owner-only, linked from
`/settings`, not in the nav) takes a pasted or uploaded CSV for each of
three things — clients (`Contact`), jobs (`Job`) and crew (`CrewMember`) —
with a downloadable template and plain-English column help for each.

Nothing is written until Confirm. The preview splits every row three ways:
will be added, already in C Stream (matched by name, case-insensitively,
within this company), or a problem with its line number. Confirm re-parses
the same text on the server and re-reads what exists INSIDE one
serializable transaction, so importing the same file twice adds nothing the
second time — including on a double-click, where Postgres refuses the
overlapping one and it comes back as a sentence.

Three things it deliberately does not do, each stated on the page:

- **No contract value.** A job's value is the sum of its line items
  (ARCHITECTURE.md); a value/amount/price column is left out and named.
- **Every job comes in as an estimate**, whatever the status column says.
  Leaving Estimate is `markJobContracted`'s decision and needs line items
  plus a signed or recorded executed contract; an import that wrote
  CONTRACTED would be a second door into the billable state with no
  evidence, and would strand the job (a contracted job's lines can only be
  added by change order). The preview shows what the sheet said, per row.
- **Never more than four SSN digits.** A whole SSN — in the last-4 column,
  or an employee number shaped like one — refuses the row, and the message
  never repeats the number back.

`parseCsv` in `lib/catalog-import.ts` gained a sibling, `parseCsvRecords`,
that keeps each record's physical line number (blank lines and quoted line
breaks made record counting report the wrong line). `parseCsv` is now a
view over it and returns exactly what it did — the catalog tests pass
unchanged. That file is in the estimating lane; the change is additive.

Check: `lib/spreadsheet-import.test.ts` and
`lib/actions/spreadsheetImport.test.ts` (a fake holding two companies whose
rows would match the upload by name). Nineteen mutations — company scope on
each read, the existing-match per kind, the four-digit rule, date
validation, the transaction, the isolation level, the owner and capability
checks, the estimate-only status, line numbers, the row cap — each turned
at least one test red.
