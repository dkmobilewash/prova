### A purchase order can be issued, printed and closed, and a delivery can point at it (Diego)
`diego/po-document`

Part 1 could only draft, so Committed always read $0. **Mark as issued** on the
Buyout page takes a date a person enters, moves the order to ISSUED and locks
its lines, and from then the money shows as Committed. **Close** ends it and it
still counts, because the money was agreed. A PO closes and never deletes.

**Download PDF** builds the order in the browser: parties, job, lines, total and
blank signature fields. It writes no terms, because that is legal wording, and a
draft prints DRAFT - NOT ISSUED so it cannot pass for a commitment. Nothing is
stored or sent, per Diego.

`MaterialOrder.purchaseOrderLineId` ties a delivery to an issued line with the
same vendor on the same job. Attribution only, like `lineItemId`: `MaterialOrder`
still has no quantity or price, and the picker shows no price because that page
is open to the field.
