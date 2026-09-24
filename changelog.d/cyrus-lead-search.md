### Lead search, stage 1: "what should we be bidding that nobody told us about" (Cyrus)
`cyrus/lead-search`

Until now the assistant could look up a project you NAMED ("start a bid on
Maple Street in Long Beach") and come back with the owner, the GCs and a
plan-room link, each with the page it came from. It could not answer the
other question — which projects are out to bid, in your trades, near you,
that you have not heard of. `find_bid_leads` answers it: say "what drywall
and ceiling work is out to bid around Long Beach", get a card of projects
found on the public web, untick the ones you do not want, tap, and the rest
land on the Pipeline page as pursuits at Watching with the source page in
each one's note.

No new table, no migration, no schedule — on purpose. Stage 1 exists to
MEASURE before anything is decided: what a pass really costs (every pass
writes an AskUsage row under its own feature, `lead-search`, with the
search count on the log line) and how good the leads really are (the bar
proposed to Cyrus, not yet agreed: of the first 40 shown, at least 25 real,
in-trade, still open and not already known). A table and a weekly run are
a later decision made from those numbers, not from an estimate.

Four rules carried over from bid research, and the two that got stronger:

- **Only what we choose leaves the account, and it is a TYPE, not a
  prompt.** `LeadSearchInput` carries the five trades as the enum, a city
  that must fit a letters-only pattern, a two-letter state code, an
  optional size BAND, a public-works yes/no and today. The whole outgoing
  turn is rendered from a fixed template over those fields
  (`leadQueryTurn`), so it cannot contain the company's name, a job, a
  figure or a typed sentence — there is no path for one. Tested by
  rendering a hostile input (an address, a quote, an injected second
  line) and asserting it is refused, and by stapling a company name and a
  median job value onto the input object and asserting the wire carries
  neither. The trades are ASKED for, never derived from job history: a
  size band computed from the books is a low-resolution leak of the books.
  The one thing read off the Company row is the head-office city and
  state, used only when the person did not name an area, and shown on the
  card as such.
- **Nothing that comes back is trusted.** A search result is text a
  stranger wrote. A lead survives only if its source URL actually appeared
  in a `web_search_tool_result` block of that same call (`verifiedLeads`,
  pure and tested on its own, same discipline as `verifiedSuggestions`);
  one the model wrote from memory is dropped whole, not shown with a
  warning. No project name, dropped. More than eight, capped. Trade
  relevance is decided in CODE from the page's own words (`readTrade`,
  the same word list `log_bid_invitation` uses); a page that names none
  of the five goes in a "couldn't tell" group, last, never asserted as
  in-trade and never silently dropped. A bid date is compared in code
  against today and badged, never hidden.
- **Dedupe hides only on exact evidence.** Same source URL already noted
  on a pursuit, or the same normalised project name as a pursuit, job or
  logged invitation: hidden, and the card says how many. Anything fuzzier
  is BADGED ("looks like Northgate Medical, already on your pipeline") and
  shown. The two mistakes are not symmetric — a false duplicate hides a
  real job the sub never learns about, silently; a false new lead costs
  one untick — so the code refuses to do the irreversible thing quietly.
- **When the web has nothing it says so.** No padding. "The lookup is
  unavailable" and "nothing turned up" are two different sentences, as
  they are for bid research.
- **A pass never costs a person a question.** `askAllowance` counts
  `feature: "ask"` rows only; a lead pass is a `lead-search` row, shown on
  /settings/assistant under "Lead search (web)". The monthly cap is not
  claimed twice: the person asked, so the question already claimed for
  the turn is what the pass is.

Every guard was mutation-tested — the boundary, the uncited-source drop,
the cap, the newline-in-city hole (found by the test, fixed before
commit), URL and name hiding, fuzzy-never-hides, ask-before-search, the
capability, the untick, and the metering feature — each broken in turn
and each named in a red assertion before being restored.

Not done, and said so: no live pass was run from this branch (no API
egress in the build container), so the §9 cost is still the estimate the
shape implies (3 searches, up to 3 rounds, ≈$0.40) until the first real
rows land. The Pipeline page shows a pursuit's note as plain text, so the
source URL is readable there but not clickable — that page is Diego's
lane and is untouched; the card itself links to every source.
