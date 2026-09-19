### What actually changed, in plain English (Cyrus)
`cyrus/acct-import`

A union sub running Sage 100 Contractor or Foundation Software can now
bring their existing jobs, customers and cost codes across in minutes
instead of typing them — and so can anyone whose export doesn't match
either of those, because the real deliverable here is a column-mapping
step, not a vendor integration.

**Column mapping is the primary path, and presets are the convenience
layer on top of it.** /settings/import already guessed a mapping from
header TEXT ("Client Name" reads as `client`); what it could never do is
be CORRECTED when the guess missed — an export headed "Owner/GC" or "GL
Code" had no way in short of renaming a column and re-exporting. Every
import box now shows a "Map columns" step once a file is chosen: each
target field gets a dropdown of the file's own headers, defaulting to the
existing guess (or a detected vendor preset — see below), always
overridable. Nothing about how a mapping is applied needed a second
parser: `lib/import-mapping.ts` rewrites ONLY the header line to the
field's own canonical text and hands the result to the exact same
`planClientImport`/`planJobImport`/`planCrewImport` functions that
already existed — so the 500-row cap, the whole-SSN refusals, the
Serializable re-plan on Confirm and the "Line N" numbering in every
problem message all apply to a hand-mapped file with nothing new to
drift. A required field left unmapped fails exactly the way a missing
column always has — "No Code or Name column found" — now also flagged
inline under its own dropdown.

**Cost codes are new**: a fourth import box brings a cost-code / phase-code
list in as `PhaseCode` rows (`lib/spreadsheet-import.ts`,
`planPhaseCodeImport`), matched against what the company already has by
CODE ONLY and NOT case-folded — "04112" and "04112-A" stay different
codes, the same way `PhaseCode`'s `@@unique([companyId, code])` does at
the database. No schema change: the model already fit a cost-code list
exactly (code, name, unit), so nothing was added to it.

**Presets are DATA** (`lib/import-presets.ts`), one table of
`{vendor, kind, fieldHeaders, minMatches}` — adding a vendor later is a
data edit, not a new code path. What's shipped: **verified vs generic,
stated plainly because the task asked for exactly that distinction.**
Sage 100 Contractor's own published help documentation
(help-sage100contractor.na.sage.com / sage100contractorhelp.sagecre.com,
read 2026-09-19) names "Job Name" and "Client" on the Jobs entry screen
and "Cost Code#" / "Description" / "Unit" on the cost-code screen — that
is REAL vendor field-label text, cited in the source comment on each
preset, and a file whose headers contain enough of it gets a "Detected:
looks like a Sage 100 Contractor…" banner with the mapping pre-filled,
always overridable. It documents the DATA-ENTRY FORM's own field labels,
not a byte-for-byte capture of an actual exported file (Sage's own docs
say an export "captures all the data on any grid", i.e. whatever report
is on screen), so it is the vendor's own naming, not a guaranteed export
header — that caveat is in the source comment too.

**Foundation Software got no preset, on purpose.** Eight web searches and
three page fetches (2026-09-19) could not turn up real column names —
Foundation's own screen documentation sits behind a client login
(clients.foundationsoft.com) and every public page describes FEATURES,
never actual headers. Rather than invent header text for a banner that
would claim "Detected: looks like Foundation Software" on a guess,
Foundation's export goes through the generic column-mapping UI only,
which is the path this feature exists for regardless and needs no vendor
knowledge to work.

**A latent bug found in passing, fixed because it was in a file this PR
was already editing**: `lib/spreadsheet-import.ts` carried two literal
NUL bytes as join separators (in `jobKey`/`crewKey`), present on `main`
since before this branch existed — the exact shape CLAUDE.md already
documents for `lib/coi-standing.ts`. Respelled to plain spaces; behaviour
identical. `file` reported the module as "data" instead of text, which is
also why `grep` on it silently returned nothing without `-a` while
investigating — worth knowing if it happens again.

The specific checks: `lib/spreadsheet-import.test.ts` (cost-code planning:
required columns, exact-not-folded matching, dedupe, row cap, ignored
columns), `lib/import-mapping.test.ts` and `.census.test.ts` (the engine
itself, plus a guard that every field option's label is a genuine alias of
its own field AND that the mapping UI offers exactly the fields the
parser knows — both directions, so a field can't go missing from either
side without failing the build), `lib/import-presets.test.ts` (detection
threshold, wrong-kind isolation, Foundation deliberately absent),
`lib/actions/spreadsheetImport.test.ts` (`importPhaseCodes`: tenant scope
against a second seeded company, one Serializable transaction, re-import
creates nothing, owner + MANAGE_COMPLIANCE guard). Nine guard mutations
were run (header alias removed, preset threshold loosened, mapping-choice
precedence reversed, required-column check disabled, tenant scope
dropped, dedupe check disabled, SSN sweep disabled, row cap disabled,
preset kind-isolation removed) — 9 requested, 9 returned, each turning
exactly the test written for it red, full suite (4984 tests) green after
every restore. `typecheck`, `lint` and `build` all clean; no new warnings.

No schema change, no migration. `pnpm-lock.yaml` untouched.
