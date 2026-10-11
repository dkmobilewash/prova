### The call list, the sample WH-347 and the one-button call log — October's three (Cyrus)
`cyrus/sales-signals`

Three slices from the go-to-market plan (Google Doc "how we get customers", 7 Oct), all in
the sales lane, none touching the shared schema. The outbound columns the plan also names
are Diego's lane and were announced in #prova-build before anything; they are not here.

**1. `/sales/call-list` — every California firm in our four trades, in good standing, with
a phone and the person to ask for.** Derived from CSLB's two public files — the master
(`601-the-file-was-a-plain-get-all-along`) and the PERSONNEL file, the same plain-GET
pattern (`fName=PersonnelData`, 85.8 MB, 405,865 rows, measured 7 Oct) which names the
owner, officers and responsible managing officer per licence. Joined on licence, cached
24 h with `unstable_cache` (the joined result is ~7,000 small rows, under the data cache's
2 MB entry; the first visit of a day streams ~163 MB and `maxDuration` is 60).

**Why it is not 7,000 leads.** The obvious import would put seven thousand rows on
`/sales`, a page that derives a band for every lead on every read, and would make "a
lead" mean "a row in a government file". So the list is derived and a lead is created one
at a time by the person dialing — `addCslbLead`, idempotent on the licence because the
index is deliberately non-unique — carrying the business name, the person to ask for (into
`contactName`, the column the hand-typed form already uses), phone, city and licence.
Source OUTBOUND. Nothing inferred.

**Two things the personnel file forced.** Its association columns are PIPE-DELIMITED
LISTS aligned by position — `EMP-Titl-CDE`, `ASSN-DT`, `DIS-ASSN-DT` — and a person whose
every association carries a disassociation date has LEFT. "Ask for Bob" when Bob left in
2011 is the trust-killing mistake the calling playbook warns about, so a principal is
current only if one association has no end date, and the pick prefers the responsible
managing officer, then an officer. And `Name-TP` separates people (`Principal`) from
aliases (`Principal| AKA`) and corporate parents (`Business`); only the first is a person.

**The Spanish-surname share** on the page is a rough prior from the sixty most common
Hispanic surnames, taken over the named owner (never a company name), for one decision the
playbook leaves open — whether to offer Spanish in the first sentence. The page says it is
a prior, not a fact about anyone.

**2. `/sales/[id]/sample-wh347` — the prospect's name on a WH-347.** The calling playbook's
one differentiator with no data behind it is "show, don't tell": a certified payroll report
with THEIR name on it before they have given us anything. `lib/sample-wh347.ts` is
`buildWh347` — the filing page's own function — on the illustrative crew the landing page
already had, which moved into `components/landing/sampleCrew.ts` so one crew serves both
and cannot drift; the panel's sheet became the exported `Wh347SheetBody` with a `stamp`
prop. Real: the contractor, the project a listing named, the arithmetic. Illustrative, and
stamped so on the sheet and said again in words: the crew, the hours, the rates — the app
holds no prevailing-wage dataset and `lib/prevailing-wage.ts` says so. `fileable` is never
true for it by construction (page 2 is absent), which the test pins.

**3. One button per call.** Sixty to eighty calls a day do not get sixty summaries typed,
so nothing got logged and the connect rate was a feeling. `CallLogButtons` logs a
`SalesActivity` CALL dated the viewer's today whose summary BEGINS WITH A TAG —
`[VOICEMAIL]`, `[CONVERSATION]` — and sets the follow-up the cadence owes (a miss retried
in two days, "not now" in thirty, nothing after a wrong number or a do-not-call). The
day's scoreboard on `/sales` — dials, connects, conversations, meetings — is DERIVED from
the tags on today's rows and stored nowhere; a hand-typed summary with no tag counts as a
dial and nothing else rather than being guessed at. `DO_NOT_CALL` is a disposition rather
than a flag: the flag is coming in the announced schema, and until then
`doNotCallFrom()` reads it off the LATEST call so a later logged conversation can
override it.

**Verified by result:** 82 tests across the three (the personnel reader cuts its fixture
at byte offsets like the master reader does; the sample pins the crew to the panel's;
the scoreboard pins the playbook's counting), typecheck, lint. Not yet clicked by a person
— the local database was rebuilt from all 152 migrations for exactly that, and the click
list is in the PR.

Per the fixture rule no row of either CSLB file appears in the repo; every person in the
tests is invented and every licence is a shape `sales-licence.ts` already cites.
