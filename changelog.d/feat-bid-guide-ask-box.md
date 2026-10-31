### The Bid job screen's "Ask or tell me anything" box asks Ask about that job — and offers only what stays in Bid
`feat/bid-guide-ask-box`

The box at the bottom of a C Stream Bid job screen was drawn disabled with
"Asking from here is coming soon." It now posts to the same `/api/ask` the
CRM's panel uses, reads the stream with the panel's own reader (lifted into
`lib/ask/streamClient.ts`, AskPanel now calls it) and draws a command's card
with the panel's own `AskProposalCard`. So the AI switch, the server key, the
courtesy limits, the paid cap and the number-provenance guard all reach it as
the same sentences. Nothing is written on Send: an instruction ends in a card,
and the card's confirm (`confirmAskProposal`) is the write, after which the
page refreshes so the estimate shows the new line.

**Scoped to the job without a name.** `lib/ask/page-context.ts` now reads
`/bid/estimates/<id>/…` and `/bid/workspace/<id>` as a job hint (still a hint:
`resolvePageJob` scopes it to the session's company). The box sends the
canonical `/bid/estimates/<jobId>` itself, because on the Bid host the
browser's path is the rewritten `/estimates/<id>`. On Bid, an allowed command
the model gave no job name gets the page's job id.

**Bid must not link into the CRM, and Ask builds nothing but CRM links.** So the
request carries `surface: "bid"`, which can only NARROW: `askSurfaceOf` knows
one word, and `commandsForSurface` filters `commandsFor(principal)` down to
`BID_ASK_COMMANDS` — `draft_estimate_lines` and `add_catalog_line`, the two that
write in place on the estimate (an `adjust_estimate` slot is marked for the
command another branch is adding). Every other command is in
`BID_EXCLUDED_COMMANDS` with its reason; `surface.test.ts` requires every
registered command to be in exactly one list, and requires the Bid list to be
a subset of the CRM list for every job function. The same predicate is applied
where a model's tool call or a chip answer EXECUTES a command, so an invented
name is refused (`surfaceStream.test.ts`, with CRM controls). On the card and
the citations, every server-built href goes through `askHref` and anything not
under `/bid` is drawn as plain text; the answer's record buttons are dropped
server-side on Bid. `bidLinkCensus` names the new dynamic sinks.

When the company switched AI off or the server has no key, the box shows that
sentence instead of an input (`lib/bid/guide/askAccess.ts`, read in the layout).

Verified by mutation: removing `surface: "bid"` from the request, the card's
`surface="bid"`, the narrowing in `commandAllowedOn`, or the execute-time
check each turns its tests red. Not verified in a browser: the signed-in Bid
screen cannot be reached from an agent container (Clerk), so the 375px fit and
a real answer streaming in are for the click-through.
