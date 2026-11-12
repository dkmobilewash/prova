### Send PO to supplier: a draft from Order materials, previewed, then emailed as a PDF on one press (Diego)
`diego/send-po`

Order materials made draft purchase orders and sent nothing. Each draft now has **Send PO to supplier**,
on the Order materials result and on Buyout. The first press only opens a preview, which does nothing
on the server: who it goes to, the subject and message, the lines and total, and the PDF itself
(**Open the PDF**). Only the press inside the preview sends it (`sendDraftPurchaseOrder`). It goes to
the supplier's email for orders, which the price-list import now reads off the list (the first address
above the table that is not a customer, bill-to, ship-to or sold-to line), shows, and stores on the
supplier. The PDF goes as ISSUED on the day sent, never as "DRAFT - NOT ISSUED". The send is logged on the
job like every document send (the message and the exact file kept), and the PO is issued only if the
email reached the provider: one that never went stays a draft to fix and send again, and one the
provider took without an id is issued, so nobody sends it twice. The Baker walk sends it to a local
test inbox only. Tests: `components/sendPurchaseOrder.test.tsx`, `lib/actions/sendDraftPurchaseOrder.dbtest.ts`,
`lib/estimating/priceList.test.ts`, `lib/actions/priceList.dbtest.ts`.
