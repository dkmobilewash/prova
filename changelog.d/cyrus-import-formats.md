### What actually changed, in plain English (Cyrus)
`cyrus/import-formats`

A brand-new tester gets their people and jobs in without knowing what a
CSV is. The /settings/import boxes (clients, jobs, crew, myCOI) now take
an Excel file (.xlsx) exactly as it comes out of Excel, and the Clients
box also takes the contacts file a phone exports (.vcf, vCard) — the
"Export contacts" file from an iPhone or Android.

**Why the Excel path is a conversion, not a second importer.** Every
import here is "the browser parses for preview, Confirm sends the raw
TEXT, the server parses the same text again inside the transaction". The
.xlsx is converted IN THE BROWSER (SheetJS `xlsx`, pinned to 0.20.3 from
SheetJS's own CDN — the npm registry copy stopped at 0.18.5 with known
advisories — and loaded only at the moment a workbook is picked, never in
a page bundle) to the same CSV text a paste would be. So the 900 KB byte
cap under Next's Server Action body limit, the whole-SSN refusals, the
500-row cap and the idempotent replan all apply to a workbook with no
second implementation to drift — proven by tests that build REAL .xlsx
bytes and run them through the untouched planners
(`lib/xlsx-import.test.ts`). Excel dates are serials (45123, not a date);
date-formatted cells come out as `YYYY-MM-DD` — the test pins 45123 →
2023-07-16, and pins that the serial itself never appears. The old binary
.xls is refused with a sentence pointing at Save As → .xlsx.

**The vCard path keeps the app's own contact shape** rather than
inventing one: a card WITH a company creates or matches that company's
`Contact` and attaches the person to it as a `ContactPerson`
(crm.prisma: the GC is the Contact; the people there are ContactPerson
rows); a card without one becomes a Contact named after the person,
exactly the row the clients spreadsheet importer would create. Same
preview-then-Confirm, same Serializable re-plan on the server
(`importVcfContacts`), same name-key idempotency — the same file twice
adds nothing, held by test. No client type is guessed from a phone
export; `accountType` stays unset, and the preview says so. The parser is
dependency-free and covers what phones actually write: RFC folding, 2.1
quoted-printable with soft breaks (old Android), 3.0, 4.0 `tel:` URIs,
multiple cards per file. A card mentioning a whole SSN anywhere — a NOTE
is the real case — is refused whole without the number being repeated.

The specific checks: `lib/xlsx-import.test.ts` and
`lib/vcf-import.test.ts`, 26 tests, all on real workbook bytes or real
vCard text through the full planners. Seven guard mutations were run
(quoting off, serial dates raw, SSN refusal off, card cap off, dedupe
off, .xls refusal off, size cap off) — 7 requested, 7 returned, each
turning exactly the test written for it red, suite green after restore.

`pnpm-lock.yaml` changed (the pinned `xlsx` dependency). No schema
change, no migration.
