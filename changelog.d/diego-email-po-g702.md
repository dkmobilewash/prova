### Purchase orders and pay applications email from the app, with proof (Diego)
`diego/email-po-g702`

An issued purchase order, on Buyout, and a pay application can now be emailed
from their own pages. Diego's decisions of 2026-10-31.

The server builds the PDF from its own records, so a person cannot send a
different file from the one on record, and the words are editable first. It goes
from our verified address under the sub's company name, and a reply reaches the
person who sent it. Per-company domains come later. The date sent is pre-filled
and can be changed.

Each document then shows delivered or bounced from the provider's own events, on
the document and, for a pay application, on the Billing tab. The exact file is
kept in the database row with the message, written before the provider is
reached, so a send never exists without its copy. That is the private store: file
storage here is public to anyone with the link, and these download only when
signed in. Submittal packages are too big for this and come next, with their own
store.

Lien waivers and change orders are not emailed, by decision. A draft PO is
refused. Additive migration `20261031140000_sent_document`.
