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

**Independent verification before merge found four gaps the author's own
tests could not see**, each reproduced red first:

- **A whole SSN in any OTHER crew column was stored verbatim.** Only the
  last-4 and employee-number cells were checked, so `123-45-6789` in Phone,
  Address, Zip or Middle name went onto the crew record. Every stored crew
  column is now checked for the 3-2-4 shape (nine bare digits only where a
  zip+4 cannot be meant), and the message names the row by first and last
  name only, since the middle-name cell is one of those checked.
- **A paste between 1 MB of text and Next's 1 MB Server Action body limit
  died on the error page.** The action allowed 1,000,000 CHARACTERS; Next
  refuses the request body first, at 1 MB of BYTES, and production redacts
  the throw. The limit is now 900 KB in bytes, checked in the browser
  before sending and again in the action.
- **The page's owner check and company scope were untested.** Removing
  either stayed green. `app/(app)/settings/import/page.test.ts` renders the
  page against two companies.
- **The fake transaction could not see a write that escaped it.** It
  passed the same client as `prisma`, so moving a write in `importJobs` or
  `importCrew` onto the bare client stayed green. The fake now hands the
  callback a distinct transaction client and a rollback only undoes that
  client's writes; each of the three actions is asserted to write only
  through it, at Serializable.

The jobs preview now says once, above the table, how many rows the sheet
marks Contracted / In progress / Complete and that they all come in as
estimates — the per-row note is in a table that shows only 25 rows.
