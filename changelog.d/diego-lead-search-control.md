### Lead search had no button either, and now /pipeline can find work to bid (Diego)
`diego/lead-search-control`

The last of three AI features an audit found at 2 of 4 on 2026-10-01.
`LEAD_SEARCH` was built, gated, metered and model-routed, and it ran inside the
`find_bid_leads` Ask command and nowhere else — no page had a control, so using
it meant knowing to type a sentence at the assistant.

**Where it went.** `/pipeline`, above the chase list and collapsed behind a
button. The page's job is the chase list, two open AI panels above it would bury
it, and each press is a billed set of web searches — a form that is not open
cannot be pressed by accident. It is the other direction from the project
look-up: that one answers a question about a project somebody already named, this
one answers "what should we be bidding".

**Every field is a choice, and that is the privacy boundary showing through to
the screen.** Trades are checkboxes over the enum, the state is a two-letter
code, size is a band. `leads.ts` renders the ENTIRE outgoing query from a fixed
template over those values and refuses anything that does not fit — so there is
deliberately no free-text box anywhere on this form, because a free-text box is
the one input shape that boundary exists to exclude. The sentence under the form
says so. `bidsAfter` comes from `viewerToday()` on the server and is never taken
from the form: a browser-supplied "today" is a browser-supplied filter.

**It reuses `boundLeadFinder` rather than rebuilding the pass.** That module
already does the gate, the usage row and the log line, and its own header says it
is a module rather than a closure so the ACCOUNTING can be tested. A second copy
would be a second place for the `feature: "lead-search"` row to be forgotten —
and that file's note about the cost case for scheduling this later resting on
those rows existing is exactly what a duplicate quietly breaks. So the action is
validation plus a call, and everything about spend and switching off is shared
with Ask.

**The bid date reaches `expectedBidDate` only when the page stated a whole
calendar day**, which is what `executeFindBidLeads` has always done — see the
revision note below for how this paragraph got there, because it said the
opposite first. "October 07, 2026, 02:00 PM" fills the field; "late spring" and
"October 3" leave it blank and keep their text in the note, so nothing the page
said is silently turned into null. A day already past is also dropped.
`lib/leads/bidDay.test.ts` pins both gates.

**The eval, which queries the live web.**

    lead-search eval (lead-search.1, claude-opus-5): requested 2, returned 2
      leads: 1 over 2 cases, 5 web searches
      city-that-does-not-exist   0 lead(s), 2 search(es)
      large-metro                1 lead(s), 3 search(es)
          Las Vegas Convention Center – North Annex Renovation (ITB #100025)
          https://www.lvccdistrict.com/bids/

The invented place returned nothing after really searching, which is the promise
holding where no code rule could enforce it. `verifiedLeads` already drops a lead
whose source was never searched — but a real page about a real project that is
NOT out to bid, or is in another state, cites perfectly and passes every guard.
`leads.ts` says what that costs better than this entry can: *"a sub who calls an
owner about a job that does not exist has spent credibility he cannot get back."*

**One lead from three searches in Las Vegas is thin, and that is reported rather
than smoothed over.** The feature does not invent, and it also does not find
much. Whether that is the prompt, the search tool or the genuine state of public
bid boards is not something this run can say, and the version is what a prompt
change would move.

**The counter-metric is in the case list from the first run, on purpose** — a
searcher that returned nothing always would score perfectly against the paragraph
above. The report prints a WARNING when the metro case comes back empty, because
then the invention pass is unproven rather than clean, and `searches > 0` is
asserted for the same reason. An `invalid` result is treated as a HARNESS failure
rather than a result: an invented city name is one typo from failing
`CITY_PATTERN`, and a query refused before it was sent measures the validator
instead of the model.

**Four censuses again, and one of them was a real test I had changed under.**
`leadFinder.test.ts` pins the exact usage record, and adding `promptVersion`
broke it — correctly. It is updated to assert the exact version rather than its
presence. `action-capability-guards` wanted the module registered and the shared
"part of your job function" refusal; `commands.coverage` wanted a decision about
whether this is an Ask command, and the reason it is not is in `exclusions.ts`.
A fifth caught my own test: the note-order assertion hardcoded my guess at
`LEAD_FIELDS`' order, asserted Size before Scope, and failed — the declaration
has it the other way round. It now derives the expected order from the enum,
because a test that restates the thing under test from memory is a test that can
disagree with it.

Checked after the revision: `typecheck`, `lint`, **8,452 unit tests over 532 files**, all green.
`pnpm eval:lead-search` runs the eval by hand with a key.

**REVISED 2026-10-02 AFTER A BROWSER RUN, AND THE THREE THINGS IT FOUND WERE ALL
MINE.** None was visible to any test in this repo, and each was something the Ask
command had been doing correctly all along:

- **The panel offered "Track this as a pursuit" on a lead already on the chase
  list.** `placeAgainstKnown` has been exported from the leads command the whole
  time — it matches a lead against the company's pipeline, jobs and bids by URL,
  by name and fuzzily — and the Ask path HIDES those, saying "nothing new". This
  panel showed them raw, and `createBidPursuit` has no duplicate-name guard, so
  the tester could have made a real duplicate row. The action now places every
  lead against the same set from the same query: an exact match is dropped and
  counted, a fuzzy one gets a badge naming what it looks like. The hide/badge
  asymmetry is copied rather than reinvented, because `placeAgainstKnown`'s own
  comment calls that asymmetry the part worth a test.
- **`pursuitNoteFor` already existed, and I shipped a second one.** It was
  already exported and builds a pursuit note from the same five fields.
  `lib/lead-search.ts` was a third implementation of one rule — and this entry's
  own last section warned about duplicating #579's note builder while missing
  that a copy was already in the repo. That is "nothing is ever missing from a
  list nobody imports" with me as the author. The module and its test are
  deleted and the action calls the original.
- **The search count was dropped.** `findLeads` returns it, `boundLeadFinder`
  discarded it, and the panel printed nothing where the project look-up prints
  "Found on the web in 2 searches". Web search is billed PER SEARCH, so this
  panel was spending money with nothing on screen saying how much. `LeadFinder`
  now carries `searches` out to its caller — the Ask command ignores the field,
  which is why adding it broke nothing — and the panel prints it.

**And the bid date is now prefilled when it parses, which REVERSES this entry's
own argument.** The paragraph above said a found bid date must never reach
`expectedBidDate`, with a test pinning it. Every sentence of that reasoning is
still true, and it was still the wrong answer: `executeFindBidLeads` has been
writing `expectedBidDate: lead.bidDay` all along, guarded to "only when the
page's date read as a full calendar day". So the Ask card and this form
disagreed about one field, which is worse than either answer on its own. Diego's
call, 2026-10-02: match Ask. `bidDayFor` applies that guard plus one more — a day
already PAST is dropped, because the create form carries `min={localToday()}` and
a filled field the browser silently refuses to submit is worse than a blank one.
The raw text still goes in the note either way, so "late spring" is never
silently turned into null.

`bidDayFor` lives in `lib/leads/bidDay.ts` rather than in the action, and that is
a trap worth recording: `leadSearch.ts` is `"use server"`, where only async
functions may be exported, and a sync export from one fails at BUILD and not at
typecheck. It would have passed every check run locally and gone red in CI.

**Two follow-ups, named rather than implied.**

**Half of the note-builder duplication is closed and half is not.**
`lib/lead-search.ts` is gone and this panel uses `pursuitNoteFor`. #579's
`lib/project-lookup.ts` still has its own builder, so there are two rather than
three; unifying the last pair is a follow-up once both are on `main`, since
neither branch may be based on the other.

And the guard that would have caught this entire class — a census asserting every
`AiFeature` is reachable from a product SURFACE, the `stageReachableCensus` shape
— still cannot be written on either branch alone: `BID_RESEARCH`'s control is on
#579 and `LEAD_SEARCH`'s is here, so a census on either one fails over the other.
It lands once both are merged. Shipping it now with a "pending #579" exception
would be a claim with an expiry date, which is the thing this repo deletes.
