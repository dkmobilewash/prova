### C Stream Bid can send the proposal to a GC, and the guide's "Send" step reads done from the record (Cyrus)
`feat/bid-send-proposal`

Before this, a bid in C Stream Bid counted as "sent" only when somebody set the
invitation to SUBMITTED by hand, and nothing in Bid could send the proposal.
The proposal page opened for one GC (`?invitation=<id>`) now has a "Send the
proposal to <GC>" composer; with no GC chosen it lists one "Send to <GC>" link
per invitation.

**What is emailed, plainly:** a plain-text email — the person's editable note,
then the proposal itself as text (scope, the price in the chosen presentation at
that GC's price, the GC's alternates and unit prices, every clause). No PDF and
no link: the app generates no PDF on the server and has no public proposal
link. The document text is built by the server at send time from the rows,
never taken from the form, and the whole body is what `OutboundMessage.body`
records — so the record is the copy the GC got. A PDF still goes through the
bid package builder on the same page.

**A preview never emails a GC.** The outbound pipeline had no preview guard
(`sendEmail` sends wherever its two variables are set). This send refuses unless
`VERCEL_ENV === "production"` — `deploymentSendRefusal` in
`lib/estimating/proposal-send.ts` — checked first in the action, before any row
is read, and shown on the composer as the sentence that disables it. No escape
hatch. The existing `submitBidPackage` still has no such guard; that is not
changed here.

Two presses: "Send to <GC>" only arms; "Yes, send it" sends, and the action
refuses without it. Also refused before anything is written: no
MANAGE_ESTIMATING, sending not set up, a bid marked won/lost/declined, no price,
no address on the GC's contact, an address not on it, the price having moved
since the page loaded, the company's outbound cap.

On a send that went: the invitation moves INVITED → SUBMITTED, a blank
`bidAmount` is filled with the price sent, and the estimate check runs as it
does on a manual status change. A failed send moves nothing. No migration: the
submitted DATE is the message's own, read by the guide as `proposalSentOn`
(`lib/bid/guide/facts.ts`), so the "Send" step reads done — "Sent Oct 26" — and
Home's "Needs you" drops the ask, even if the status is later set back by hand.

Check: `bidProposalSend.test.ts` and `proposal-send.test.ts`, each guard
mutation-tested (13 mutations, all killed).
