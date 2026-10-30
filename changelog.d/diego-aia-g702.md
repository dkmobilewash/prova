### The pay application prints as a G702 and G703, with a period-to date and a PDF you can download (Diego)
`diego/aia-g702`

A GC's accounting desk reads an application for payment in one shape: the
nine numbered lines of the G702 above, the continuation sheet in columns
A–I below, and a PERIOD TO date in the header. Ours had the right figures
and none of the shape — a six-cell summary box, an eight-column table, a
warning that said "No PERIOD TO date" and told the person to write it on
a cover sheet. The warning was honest, which is how it stayed for a month.

Three things changed, and nothing about the arithmetic did:

- **`Invoice.periodTo`**, additive and nullable (migration
  `20261030210000_invoice_period_to`). The pay-application form asks for
  it, defaulting to the person's own calendar day, and the certificate
  prints it in the header; an older application prints a blank to be
  written in rather than a guessed date, and says so on screen only.
- **The page is laid out as the forms.** Lines 1–9 with their numbers,
  5a/5b as blank fields (the total is the sum of per-invoice snapshots and
  no rate is reached for to split it — see `PayAppSummaryInput`), the
  change-order summary box with the net figure filled, the contractor's
  certification, notary and architect blocks as labelled blank fields with
  NO certification wording, and the G703 with columns A–I, a percent column
  and a grand-totals row. Column I is blank because retainage here is per
  application, not per line. Line 1 is the one figure the engine never had:
  line 3 minus line 2, where line 2 is `changeOrderValueDelta` over the
  job's APPROVED change orders, so the form's own identity holds by
  construction.
- **Download G702/G703 PDF**, built in the browser with the `pdf-lib`
  the bid package already uses, nothing stored and nothing sent — where a
  sent application should live as a file is still an open decision.

**The check that proves it:** `lib/billing/g702-pdf.test.ts` builds the PDF
from a fixture run THROUGH `calculatePayAppLineItem` and
`calculatePayAppSummary`, inflates the content streams, and reads every
drawn string back out of the bytes — every G702 line, every G703 cell, the
totals, the header — and requires each to equal `money()` of the engine's
figure. It carries its own controls (a string never drawn is absent; the
scan finds more than eighty strings) and went red under four mutations:
column F from this period's delta instead of the running balance, line 1
adding instead of subtracting, the totals row skipped, line 8 drawn from
line 6. `lib/billing/g702.test.ts` pins the mapping itself and the six
labels the shoot rehearsal asserts by exact text.
