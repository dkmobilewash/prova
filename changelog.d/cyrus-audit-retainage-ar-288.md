### Issue #288 was already fixed — and the guard that proves it had a hole (Cyrus)
`cyrus/audit-retainage-ar-288`

**AUDIT, docs-and-test only. No behaviour change, no schema, no migration.**
Flagged under the working agreement's audit exception, which is the point of
the flag rather than a formality.

Issue #288 — "AR aging never subtracts retainage, so withheld money ages as
overdue, and the forecast total then adds it a second time" — was filed
against `dc012ca` and is still open. It was fixed by `f39f1de` (PR #296) on
17 Sep. **Both halves verified fixed on `f969900`, by mutation rather than
by reading the comments that say so**, which is the only way to tell a fix
from a sentence about a fix:

| mutation | caught by |
| --- | --- |
| `arBalanceFor` → `amount − paidAmount` (the issue's exact defect) | 17 tests, 5 files |
| `gc-reliability` settles against gross | 5 tests |
| `summarizeArAging.retainageExcluded` → `0` | 2 tests |
| Ask `receivables` → `amount − paid` | 3 tests |
| Today receivables tile → `amount − paid` | 2 tests |
| `arBalanceFor` → plain float subtraction | 2 tests |
| **`cents()` → `value * 100`, no `Math.round`** | **nothing — survived** |

Seven requested, six caught, and the survivor is what this PR is for.

**`Math.round` in `cents()` was load-bearing and unbound.** There were
already two ways to lose that guard and a test for only one of them, because
multiplying by 100 does not remove float dust — it changes its SIGN. On the
existing fixture ($1,000.35 at 10%, GC pays the $900.31 net) the dust
cancels to exactly `0` without the rounding, so the invoice still drops out
of aging and all 44 tests stayed green with `Math.round` deleted.

$1,024.13 is the same construction with the sign the other way. The app's own
formula — `(amount * pct/100).toFixed(2)` — snapshots `102.41`, the GC pays
`921.72`, and unrounded the balance lands at `+1.4551915228366852e-13`. That
is `> 0`, so `calculateArAgingInvoice` returns a row instead of `null` and a
fully-settled invoice ages into 90+ **at a balance that renders as `$0.00`**
— issue #288's own symptom, reintroduced by dropping one `Math.round`.
Confirmed through the real exported function, not a re-implementation.

One test added, which kills that mutation and nothing else does. It asserts
the unrounded arithmetic really is positive for its fixture, so a later edit
to those three numbers cannot quietly make it vacuous — the same "assert the
size of the set you derived" rule the scratch-cleanup parser learned.

**Established and deliberately left alone**, recorded so nobody re-runs it:

- `outstandingReceivable` in `lib/company-financials.ts` is `totalBilled −
  cashCollected`, which does include retainage — but it is **rendered
  nowhere**. Computed, typed, tested, never displayed. Not a live
  double-count; a dead field.
- The Money Rail is clean: `unbilledContractValue + retainageHeld` is
  disjoint by construction, since retainage is withheld from what has
  already been billed.
- **The GC portal** (`app/portal/[token]/jobs/[jobId]/page.tsx`) and the job
  page invoice ledger both still show `Balance = amount − paid` in amber,
  unlabelled — so a **GC** is shown an amber balance for retainage they are
  contractually entitled to hold. Defensible as a ledger rather than an
  aging report (`logPayment`'s ceiling is deliberately gross, so cash that
  arrives early can always be recorded), but nothing on either screen says
  so. Left for the lane owner; not a drive-by change to a GC-facing number.
- **`seed-demo.mjs` contradicts the model the fix adopted.** Cedar bills
  `134200`, withholds `13420`, and records a Payment of the full `134200` —
  gross — while the retainage is still reported as held. Same shape on
  Riverside invoice 1. So demo and preview data assert that the GC paid the
  retainage in cash *and* is still holding it. It does not break the fix,
  but it means **the demo dataset could never have shown this bug**, which
  is a plausible reason it survived as long as it did. Not changed here:
  seed amounts cascade into AR, reliability and cash figures, and this
  session has no database to run the seed against.

The issue's own open question — whether real usage records a `Payment` gross
or net of retainage — is answered in the code rather than by preference:
`calculatePayAppSummary` already derives AIA G702 `currentPaymentDue` as
gross less retainage, so net is what the app certifies and net is what the
AR balance now assumes. The one fixture on `main` that says otherwise is the
seed above.
