### A signed T&M ticket starts a change order (Diego)
`diego/tm-to-change-order`

The phone has signed T&M tickets since September: the GC's representative
signs for the day's extra hours and materials on site, and the snapshot is
frozen at signing. Then nothing happened to it — the ticket sat on the crew
tab and the change order got written from memory a week later, which is the
hour this feature removes and the dispute it prevents.

**Draft change order** on each signed ticket, the same move as the delay
log's. The draft's title and description are the ticket's FROZEN snapshot
(hours per worker with pay type and craft, materials with vendor), who signed
and when on the site's clock, whether a drawn signature is on file, and how
many job photos were captured that day. The ticket links to its change order
(`TmTicket.changeOrderId`, additive and nullable) and can start only one;
the second click is refused on the real constraint, not a flag.

**NOT priced, on purpose.** How hours and materials become a sell price —
markup, labor burden, equipment — is a decision in front of Diego
(`coordination/decisions/2026-10-30-change-order-markup-and-burden.md`), and
the draft says "Not priced" in its own text rather than guessing a wage.
No proposals are created; the person prices it on the change-order form.

The check: `lib/tm-ticket-change-order.dbtest.ts` drafts from a ticket on a
job with NO time entries and asserts the hours come from the snapshot; the
Denver site's 22:12Z signature prints as 4:12 PM MDT; the photo on the work
date counts and the one after midnight does not; a second draft is refused
and the count stays one; another company's ticket is refused in the same
words as a missing one. `tm-ticket-change-order.test.ts` pins the words.
