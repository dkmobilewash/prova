### Ask can start a change order and a purchase order, and the page's own button is still the write (Diego)
`diego/ask-change-orders-pos`

"Start a change order on Clerk for 12 extra door frames" and "make a PO to ABC
Supply for 200 sheets of 5/8 type X on Hutto" now give a card. Neither card writes:
both are HANDOFFs, like the RFI and the email. The change order card opens the job's
Estimate tab with the New change order form filled in and focused; the PO card opens
Buyout on the matching estimate line, with the vendor and quantity filled in. Start
draft and Add to draft PO are the writes, so the counter, the contracted-job rule and
the VIEW_JOB_COSTS guard are exactly what a person typing it by hand meets. A PO card
never carries a price — the row offers the vendor's quote on file or a typed one — and
issuing, sending, pricing, submitting and approving all stay page buttons, each
excluded with its reason.

A hand-off could only open a company-wide page before this (`handoffHref` got the card
id and nothing else), and both of these live on a job tab. It now also gets the card's
server-held payload, so the job id in the link is the one `resolve` wrote, never the
model's. `commands.test.ts` reads a job tab's guard off the page file, because a path
with an id is not in `ROUTE_CAPABILITY`; giving the PO card MANAGE_BILLING turns that
test red.

Dictation writes "five-eighths type ex"; estimate lines say `5/8" Type X`.
`lib/ask/spoken.ts` folds fractions, Type X/C and sheetrock/gyp board before matching a
said material against a job's lines. Matching only — a quantity still goes through the
strict parser, and deleting the five-eighths rule fails two tests.
