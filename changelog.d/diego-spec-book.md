### A whole spec book on a job: the trade's sections found, read for facts, checked against the wall legend, and onto the proposal

Before this, a spec section had to be uploaded as its own PDF, one at a time. Only a bid's sections could be read for cost, and only into free-text findings. The job's **Specs** page (now linked beside Proposal on every job) takes the whole project manual.

**Finding the sections is code, not a model** (`lib/specs/specBookSections.ts`). It reads:
- the "SECTION 09 21 16" heading;
- the "09 21 16 - 3" label on every page;
- END OF SECTION;
- the table of contents, for titles a heading leaves out.

It understands 2004 and 1995 numbers. It keeps this product's trades: 09 21/22/23/24/26/29, 09 51/53, 07 24 (EIFS's own number; 09 24 00 is cement plaster) and 07 81. Each becomes an ordinary `BidSpecSection` pointing at its page range in the book. The pages are sliced out when read, never copied, so the submittal reader works on them unchanged.

**Reading is behind plan reading's switch** (`PLAN_TEXT_READ`) and metered on the spec page allowance. Text goes in, one call per section (`packages/integrations/src/specTrade.ts`):
- studs, board, fire ratings, ceilings, finish levels, products and price drivers;
- every item carries its quote, and **an item whose quote is not in the section's text is dropped** before it is stored;
- the numbers (gauge, mils, spacing, thickness) are parsed by code from the printed words, never taken from the model.

**Each legend wall type is checked against the reads, by code** (`lib/specs/specTradeFacts.ts`):
- It shows what applies, e.g. `09 21 16: 5/8" Type X, Level 4, UL Design U419`.
- It flags lighter studs, wider spacing, a rated wall without Type X, and thinner board.
- Board is compared only with the board that applies to that wall. A Type X required on rated walls is not held against an unrated wall's 1/2" board, the false alarm the db test caught on its first run.

**Each price driver has Add as inclusion and Add as alternate.** Each writes a snapshot proposal clause, never twice.

Migration `20261108200000_add_spec_book`, additive only:
- new tables `SpecBook` and `SpecTradeReading`;
- three nullable columns on `BidSpecSection`.
