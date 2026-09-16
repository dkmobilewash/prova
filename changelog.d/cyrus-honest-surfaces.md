### Two places the app was claiming more than it does (Cyrus)
`cyrus/honest-surfaces`

Both came out of the week-long run-the-business simulation, and both are
the same defect wearing different clothes: a surface stating something the
code does not do, with nothing anywhere able to notice.

**A GC clicking a dead portal link got Next's own developer 404.**
`app/(app)/not-found.tsx` is scoped to the signed-in route group, and
neither `/portal` nor `/esign` had a `not-found.tsx` of its own — so every
`notFound()` on the only two routes an outside company can reach rendered
the stock unbranded page. Nobody signed in can see it: it appears only to
somebody holding a link that no longer opens, which is exactly the person
who has no way to tell us.

`components/PublicRouteNotFound.tsx` is now the page for both, the way
`PublicRouteError` is already the error boundary for both. It deliberately
carries **no link at all** — the app's version offers "Back to jobs" and
"Line item catalog", which for a GC are two doors into a product they have
no account for, a dead link turned into a dead end behind a login wall. The
way out of this page is a person: whoever sent the link.

The copy is vague on purpose and the test enforces it. `/portal/[token]`,
`/portal/[token]/jobs/[jobId]` and `/esign/[token]` all 404 identically for
a token that never existed, one that was revoked, a contact set INACTIVE, an
expired signature request, and a job belonging to somebody else — three
guards in three files, none of which mentions this page. A friendlier "this
link has expired" would undo all three from a file they never reference, so
`public-not-found.test.ts` asserts the word list directly.

**`/settings/export` said "Everything &lt;company&gt; has put into C Stream"
over a button reading "Download everything".** It is 18 tables out of a
93-model schema. Much of that gap is bookkeeping nobody wants — counters,
sync logs, notification rows — but a lot of it is work somebody did:
`CompanyLicense`, `CompanyBond`, `ComplianceDocument`, `RetainageRelease`,
backcharges, the wage and fringe tables certified payroll is built from,
photos, drawings, closeout, warranty, the sales pipeline. The page disclosed
three omissions, all about keys and files, and one of the three was false —
"documents appear as their metadata rows here" when `ComplianceDocument`,
`ContractDocument`, `DrawingRevision`, `DocumentIntake` and `JobMedia` are
in no dataset at all. The same three strings were also written into the
JSON bundle itself, which is the copy that outlives the account.

No datasets were added — that is a much bigger piece of work and some of the
omissions are deliberate. What changed is that the page stops claiming them.
It is titled "Export core records", the sentence and the button COUNT
`EXPORT_DATASETS` at render, and the omissions panel names the real
categories by model, in two groups: held back on purpose (credentials,
portal and signing links, which will never be exported) and not covered yet
(records you put in, which one day should be). It says plainly that counters
and sync logs are not listed and nobody wants them, because alarm is not
honesty either. The JSON bundle now derives `notIncluded` from the same
registry and its filename is `prova-export-core-records-<date>.json`.

**Why nothing caught it:** the copy made no checkable claim. A sentence with
no number in it cannot be off by any amount, and a disclosure list of three
hand-typed strings has nothing to be compared against. So the number is read
from the registry at render and the disclosure names MODELS, which the
.prisma files can contradict.

**Mutations, twelve, all red, restored and re-run green:**

| # | broke | caught by |
| --- | --- | --- |
| 1 | hardcoded `18` in the intro | the rendered number follows the registry |
| 2 | hardcoded `18` in the button label | the download button counts them too |
| 3 | dropped `<ExportOmissionsPanel />` from the page | page delegates its coverage claims |
| 4 | put "Download everything" back | no longer promises everything |
| 5 | listed `Invoice` (which IS exported) as missing | names nothing that is actually exported |
| 6 | misspelled `CompanyBond` | names models that actually exist |
| 7 | added `<a href="/dashboard">` to the 404 | renders no link of any kind |
| 8 | copy changed to "no longer valid" | does not say whether the link ever worked |
| 9 | broke the schema-parsing regex | parse size asserted a second way |
| 10 | rendered all but the first omission | renders every entry in both lists |
| 11 | emptied the portal 404 | the page is not empty |
| 12 | dropped the withheld half of `notIncluded` | the file carries the same lines as the page |

Mutation 9 is the `scratch-cleanup-order` scar copied on purpose: the model
count is asserted against a line-by-line count that cannot share a bug with
the regex, so a pattern matching nothing fails loudly instead of satisfying
every loop after it.
