### Ask answered five questions with confidently wrong prose (Diego)
`diego/ask-wrong-answers-103` → closes #103

Five findings, all in `lib/ask/handlers.ts` and `tools.ts`, and the common
thread is the one rule this feature is built on: the model is told to never
do arithmetic and to say the number a tool gives it, in the tool's own
terms. Every one of these five was a tool handing over a number or a
message that could not honestly be narrated under that rule.

**1. `job_margin` handed over `percentComplete` as a raw 0..1 fraction —
MONEY-WRONG.** `/jobs/[id]` renders the identical number as
`(percentComplete * 100).toFixed(1)}%`. Told never to do arithmetic, the
model's only options were to say "0.4% complete" (the fraction itself,
misread as the percentage) or multiply it anyway — a margin figure wrong by
100x either way. `lib/wip.ts` now exports `formatPercentComplete` and
`formatCoveragePercent`, the exact functions `/jobs/[id]` renders
`percentComplete`, `estimatedCoverage` and `earnedCoverage` through, so the
tool and the page share one function per format and cannot print two
different numbers for the same fraction. `/jobs/[id]` itself was rewritten
to call them too — the same "one shared constant" shape as
`CLIENT_VISIBLE_CHANGE_ORDER_STATUS`.

**2. `compliance_status` reassured a company with nothing on file.**
`renewalAlerts` drops every CURRENT source, so a company that has never
filed a COI produces the identical empty array to one whose filings are all
current — and the old handler answered both with "every certificate,
licence, policy and bond on file is current." "Is my GL still good?" from a
company with zero compliance rows got reassurance about a fact nobody had
checked. Fixed by reusing `renewalCoverage`/a new `renewalCoverageMessage`
(`lib/compliance-expiry.ts`) — the same distinction `RenewalAlerts.tsx`
already draws on `/compliance` between NOTHING_TRACKED and ALL_CURRENT.
`RenewalAlerts.tsx` was refactored onto the same function so the page and
the tool can't tell two different stories about an empty list.

**3. A typo'd job name got company-wide good news.** `open_rfis`,
`open_punch_list`, `drawing_currency` and `material_deliveries` all filtered
their own rows (RFIs, punch items, drawing sets, orders) by job name after
the fact — a name that matched no real job produced the same empty array as
a real job with nothing open on it, so both got the same job-silent
sentence. `job_margin` already got this right by querying `Job` directly;
that check is now a shared `jobNameMismatch` helper the other four run
first, so "what RFIs are open on Rivrside?" (typo) answers "No job matches
\"Rivrside\"" instead of "No RFIs are sent and awaiting an answer."

**4. `bid_status` and `material_deliveries` truncated toward the wrong
end.** Neither capped its own query — the cap is `forModel`'s generic
40-row limit — but both ordered oldest-first with no status filter, so for
any company with real history that cap dropped the newest, most-likely-open
rows first and kept 40 decided bids or long-delivered orders instead. Fixed
two ways: both tools now accept an explicit `status` (`OUTSTANDING` for
bids means invited-or-submitted; for orders, not yet complete — there is no
stored order status, so it's derived the same way the page derives it), and
the DEFAULT order now sorts outstanding rows first regardless, so
truncation drops decided/complete rows before it drops open ones. Both also
carry a `summary` (`outstandingBidCount`/`outstandingOrderCount` alongside
the total) computed over every matching row, never the truncated list, the
same pattern `receivables` already used for exactly this reason.

**5. `drawing_currency`'s description promised an age the handler never
returned.** The tool's own description says "how old each is"; the handler
returned only issue dates and a list of labels, so the model had to
subtract the date from today itself to answer "am I building off the latest
sheet" with any age attached — arithmetic, the one thing forbidden. Fixed
by returning `currentRevisionAgeInDays` and a per-revision `daysWaiting` on
`issuedButNotReceived`, computed with `daysToReachUs`
(`components/drawingLabels.ts`) — the exact function `/drawings` already
renders through `DrawingSetRow` as "N days to reach us" / "waiting N days."

Ten new tests, one file per finding plus direct unit coverage for the two
new `lib/wip.ts` formatters and `renewalCoverageMessage`. Every fix was
hand-mutated back to its old behavior and confirmed the exact scenario the
issue describes reproduces (0.4 instead of "40.0%"; the reassurance
sentence on zero sources; the generic sentence on a typo'd job name; the
decided/complete rows sorting ahead of the outstanding ones; the missing
age fields) before being restored.

One judgment call worth flagging rather than asserting confidently:
finding 3 named only `open_rfis` and `open_punch_list` by line number, but
`drawing_currency` and `material_deliveries` had the identical
filter-after-the-fact shape, so all four got the fix rather than two.
