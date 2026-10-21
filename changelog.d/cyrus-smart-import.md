### Bring in any old system's export: columns matched for you, the kind guessed, nothing saved until Import (Cyrus)
`cyrus/smart-import`

`/settings/import` had four fixed boxes and a per-FIELD dropdown. A
contractor holding a Sage, Foundation, QuickBooks or Jobber export had to
know which box it belonged in and hand-match every column the alias table
missed. Now there is one "Bring in what you already have" box at the top:
choose any file, C Stream guesses what it holds from the column names (and
says so, with a dropdown to change it), and every column is shown with
where it goes, how sure the match is (exact name / similar name / AI
guess), a dropdown to change it or skip it, a sample value, and a 5-row
preview with how many rows import and which are skipped and why. The four
per-kind boxes get the same review.

Two layers. `lib/import-smart-map.ts` is a synonym dictionary per field,
with vendor header sets cited (Sage 100 Contractor's help pages, verified
labels) or marked unverified (Foundation, QuickBooks Desktop, Jobber
exports — nobody here has a real file). Only the columns it can't place
can go to the model, on a button press, through `aiGate(…, "ASK")` and one
claimed assistant question: header text and at most five sample rows with
every digit masked. The model only proposes.

The bug it fixed on the way: `mapColumns` gives a field the FIRST matching
column left to right, and "job#" is a name alias, so a Sage job list
("Job#, Job Name, Client") imported the job NUMBER as the job name — and a
column a person mapped away from still got read back by its own header.
The mapper now ranks by synonym, and every unmapped column's header is
rewritten "Skipped: …" so no alias can pick it up. Still one insert path
per kind: the mapping only rewrites the header line the existing actions
re-parse.

Check: `lib/import-smart-map.test.ts` (header sets per system, kind
detection, mutation-checked — nine mutants, all killed),
`lib/actions/importSuggest.test.ts` (AI switch off = no model call and
nothing claimed), `components/SpreadsheetImport.test.ts` (the whole review
renders from a file with no action called).
