### An alert where its subject lives, not only in a list you have to visit (Diego)
`diego/alerts-where-they-live`

**No migration. No new derivation.** Web only.

**THE PROBLEM WAS DELIVERY, NOT DETECTION.** Every derived alert reached
exactly one surface: `/alerts`, behind a bell with a count. That is a list
somebody has to decide to go and read — and the kinds this was built for are
precisely the ones nobody goes looking for, because their subject is
somewhere else entirely. `lib/alerts.ts` says it about its own DAS-140
alerts: both deadlines "were computed and shown correctly on one screen each
and reached nobody who was not already looking at that job's compliance
tab."

`PageAlerts` puts them on that tab.

**IT IS THE SAME `loadAlerts` CALL THE LIST USES, not a second derivation.**
If the two ever disagreed one of them would be lying and nobody would know
which — and this app already carries the scar of a figure computed twice.
Per-principal filtering and the money strip come along for free, because
they are inside the call rather than beside it.

**It renders NOTHING when there is nothing**, deliberately. An empty state
here would be a box on every clean page announcing it has nothing to say.
`/alerts` is where "nothing outstanding" is the useful answer, because being
empty is the whole point of going there.

**Where they landed:**

| page | kinds |
| --- | --- |
| `/wip` | `WIP_VARIANCE` — a job forecast over its contract value is a fact about that very table |
| job → Compliance | `APPRENTICE_RATIO`, `CERTIFIED_PAYROLL`, `DAS140_NOTICE`, `DAS142_DISPATCH`, scoped to that job |

**`/compliance` was already doing it** and is left alone: `RenewalAlerts`
has surfaced licence, COI and bond expiries there through
`lib/compliance-expiry.ts`'s own ranking for a while. Adding a second
renewal surface to the same page would have been the duplication this entry
is arguing against.

**The job scoping is by href, not by a kind→job map.** The alert already
carries the thing it says to open, so matching on `href` needs no second
mapping — and no second mapping that could drift from the first.

547 files / 8578 tests green, typecheck and lint clean. **Not clicked:**
nobody has loaded `/wip` with a variance outstanding, or a job compliance
tab with a DAS-140 due.
