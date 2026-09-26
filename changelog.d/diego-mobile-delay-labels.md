### A logged delay stops changing language under the person who typed it (Diego)
`diego/mobile-delay-labels`

Issue #484, which was filed as "blocked on nothing, but only visible once
`diego/spanish` merges". That merged as #489, so the wobble it predicted has been
live on `main` since.

**What a Spanish-speaking foreman saw.** The row drawn the instant somebody logged
a delay took its words from the chips they had just tapped, which are translated.
The row that replaced it after sync took them from `/api/v1`'s `causeLabel` and
`responsibleLabel`, which are **always English**:

| moment | reads |
| --- | --- |
| just logged | `Retraso · Clima · GC` |
| after sync | `Retraso · Weather · GC` |

Both halves now word the raw enum through the screen's own `[value, stringKey]`
tables, so there is one wording and it is the reader's. **The server's label fields
are deleted from the phone's `DelayRow` rather than left unread** — a field nobody
renders is a field somebody renders again, and deleting them makes the old bug
unreachable instead of merely absent.

The same sentence fixed a second one it was hiding: `reports.delay.gcTold`
interpolated the raw enum, lowercased, so a Spanish phone read **"Se le avisó al GC
por phone"** — and `IN_PERSON` only ever read as "in person" by accident of a
`.replace("_", " ")`. It reads the method's translated label now, lowercased with
the reader's own locale because it sits mid-sentence.

**And counting the tables against the schema found a third thing nobody had
looked for.** `NotificationMethod` declares SIX members; `METHODS` had five:

| table | rows | enum | |
| --- | --- | --- | --- |
| CAUSES | 9 | `DelayCause` 9 | ✓ |
| PARTIES | 6 | `DelayResponsibleParty` 6 | ✓ |
| METHODS | **5** | `NotificationMethod` **6** | ✗ `OTHER` absent |

So "Other" could not be recorded on the phone at all — and once the row started
reading the enum, an `OTHER` stored from the web would have rendered as the raw
token. Reading that table three times did not find it; counting it did.

`lib/delay-label-census.test.ts` now holds all three to their enums, from the
SCHEMA rather than from each other — the database enforces what the migrations
wrote, and the phone renders whatever the API hands it. Both parses assert they
found something before anything is compared, and the row count is asserted against
the member count as well as the membership, so a pattern that stops matching fails
with "6 declared, 5 parsed" instead of quietly comparing a shorter list. It also
pins the two render sites, because the type no longer carrying those label fields
is not the same as the screen not reaching for them.

Six mutations, all red: `OTHER` removed again, a member pointed at a string no
dictionary has, each render site reverted, and each of the two parses broken.

287 unit and 65 screen tests pass, typecheck clean. No schema change, no migration.
