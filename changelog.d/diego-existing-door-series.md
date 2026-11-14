### A door series the set calls existing is set aside: E Street's E-2 to E-16 (Diego)
`diego/existing-door-series`

Round 22c's door line failed on one mechanism. E Street A2.1's 13 E-numbered doors were taken out
of its key as existing, but with no demolition plan paired they are still found. They carry printed
tags, so they scored like perfect doors. E Street's door schedule (p31) says why in its general notes:
doors with prefix "E" are existing doors that stay.

A fifth existing-door rule (`existingDoors.ts`, route `series`) sets a door aside when its own mark
(the nearest mark-shaped word within the mark reach) is a hyphenated prefix the set calls existing.
The support can be:
- a definition on the sheet;
- a definition on the door schedule page(s) the ingest read (`existingPrefixes`, `doorSchedulePagesOf`);
- a paired demolition plan that keeps at least half the series, and at least 2.

Never the letter alone: an E- series with none of those (an east wing) is left alone. Every door path
reads the schedule's words: the viewer once per document, the rooms step from the same file, and the
training table from the pages that name a door schedule. The table's version is its stand-in for the
ingest's schedule pages.

Training (Round 22c labels): E Street 13 false doors removed, 0 key doors lost; every other set
unchanged. Paired with its demolition plan, the same 13 go by the plan first. On screen (a copy of the
local database with p31 registered as E Street's door schedule): "13 existing doors set aside: 13 in a
door series the set calls existing", and with the schedule entry removed the series is left alone.
Check: `existingDoors.test.ts` (7 new cases; 8 mutations red, among them no support needed, a third
of the plan is enough, the farthest mark, a keynote read as a mark) and the wiring census (3 red).
