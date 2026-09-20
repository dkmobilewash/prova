### A payroll register import, so WH-347 stops blocking on the four fields it never had (Cyrus)
`cyrus/payroll-import`

**C Stream does not run payroll and never will pretend to.** It computes no
withholding, no FICA, no net — but WH-347 columns 8 and 9 (deductions, net
wages), the worker's identifying number, and the project's sequential payroll
number all EXIST already, in whatever payroll system the contractor already
runs. Until now nothing brought them in, so every certified-payroll week
printed those four as permanently missing, no matter how complete the hours
grid was.

**The import.** Settings → Import (for an owner) or its own section there (for
anyone holding MANAGE_COMPLIANCE — deliberately NOT owner-gated like the bulk
spreadsheet importers beside it, because certified payroll is the office
manager's weekly chore) takes a pasted or uploaded payroll register. Gusto's
own documented column spellings are recognised and labelled; ADP RUN, Sage 100
Contractor and Foundation publish no fixed layout, so those — and anything
else — go through a generic column-mapped fallback with manual override
dropdowns, and the header row is FOUND (the first row answering at least three
fields) rather than assumed to be row one, because Sage and Foundation print a
report title and criteria above it. Preview writes nothing; Confirm re-plans
from the raw text inside one Serializable transaction against a fresh read.
Re-importing the same person+period UPDATES the stored row instead of
duplicating it, so a corrected register is safe to paste twice.

**The same SSN refusal the crew importer already enforces, reused rather than
reinvented.** A whole Social Security number anywhere in a row — not only the
column labelled for it — refuses that row before anything is stored, and the
number is never echoed back in the problem message. Only the last 4 is ever
written, and only into the existing `CrewMember.identifyingNumberLast4`, never
into a second column on the register row. Bank account and routing numbers,
which Gusto's report builder offers as columns, are never read at all.

**Money is integer cents, always.** `parseMoneyCents` reads `$1,234.56`,
accounting-style `(123.45)` negatives, and bare `1234` — and refuses a third
decimal place outright, because a truncated mill is a wrong number on a
federal form. Deductions come from the register's own total column when it has
one, or are derived as gross minus net when it does not, with the preview
saying which per row.

**`Wh347PayrollNumber` is issued by a counter, not `max(n)+1`** — same shape as
`InvoiceCounter`, bumped inside the same transaction as the insert, via
`issueWh347PayrollNumber`. It is a per-job, RESTRICT child of `Job` that
deleting a job's other rows does not reach, so — per the #227 scar this file
already carries — it is in three places, not one: the model,
`HANDLED_MODELS` in `scratch-scope.mjs`, and the `del()` order in BOTH
`clean-scratch-data.mjs` and `seed-demo.mjs`. `counterCensus.test.ts` names it.
Issuing is an explicit button on the WH-347 filing view, never a side effect
of a page render — a page load is not an intent to file, and a number issued
by a stray render would leave a hole in the project's sequence for a week
nobody actually filed. Numbers are never reissued and never deleted; two
clicks racing for the same week settle on `@@unique([jobId, weekStart])`, and
the loser reads the winner's number back rather than surfacing the collision.

**`CrewMember.identifyingNumberLast4` was locked from creation, which
contradicted its own schema comment** — "nullable because a crew member is
worth recording before payroll has sent the number over" describes exactly
the write the old trigger refused. The migration replaces the identity-lock
trigger function so that field is SET-ONCE instead of locked-from-creation:
`NULL -> value` is now allowed (the register import is that caller), and any
change once set is still refused — the same one-way rule `linkedUserId`
already has in the same function. A filing made while the field was NULL
printed "ID number not recorded"; filling it later completes FUTURE filings
without altering what that one said.

**What this does NOT do.** No rate engine and no payroll computation —
import only, and the register's own figures are trusted and stored verbatim,
never recalculated. It does not fix the two WH-347 bugs an audit found the
same day (mid-week fringe-rate split, hours silently dropped outside the
query window) — `cyrus/audit-fixes` (#359) owns those and this branch merges
`origin/main` to pick them up rather than duplicate the fix. It does not
build the Statement of Compliance (page 2, signed under penalty of perjury) —
`fileable` stays `false` on that alone even with a complete register and an
issued payroll number; that is a separate, larger effort already staged on
`cyrus/wh347-statement-of-compliance-2` and deliberately out of scope here,
so this PR does not make a WH-347 actually fileable end to end, only stops it
blocking on the four fields payroll data can fill.

**Tests.** Parser fixtures per format (Gusto's documented spellings, a
generic mapping, Sage/Foundation-style preamble skipping) plus the manual
override path; the SSN sweep, end to end through the action and never
echoed; cents arithmetic including the third-decimal-place refusal; unique
re-import (create vs. update vs. unchanged, and within-file dedup); tenant
scope (a same-named crew member in another company is never matched, checked
against a fake database that honours `where` by equality); nothing is
written before Confirm (checked from source, the same way
`MyCoiImport.test.ts` already does — happy-dom cannot run a Server Action, so
what matters is that no second call site exists); the payroll-number
counter's transactionality (via `counterCensus.test.ts`'s existing
transaction-client regex, which every counter in this schema is held to);
and `wh347.test.ts` now covers the register-money join, the identifying
number, a worker who ran two crafts drawing one paycheck (money on the first
line only, never doubled), and the fileability contrast this PR's scope
actually reaches — clears down to `["statementOfCompliance"]` with full
data, blocks all four without it.
