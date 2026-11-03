### A change order log to send the GC (Diego)
`diego/change-order-log`

`/jobs/[id]/change-order-log`, from **Change order log →** on the change orders
card: every change order sent to the GC with its number, title, status, submitted
and decided dates, days pending and amount. Totals for executed, pending and
rejected, and the pending ones aged 0 to 30, 31 to 60 and over 60 days. Downloads
as CSV and Excel with the same rows.

Read-only and from existing data. Each amount is the one the change order's card
shows, from the same helper. Drafts are counted and not listed, because they have
not been sent. A withdrawn change order is listed and in no total.

The CSV and Excel writing the G703 export used is now one shared module, so both
files keep a credit as a number and stop a title running as a formula.
