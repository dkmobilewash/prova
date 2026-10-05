### The bulk file downloads from here in one GET, and the committed entry said it could not (Cyrus)

**DOCS-ONLY, shipped under the audit exception** (working agreement rule 1, Diego 2026-09-07):
it corrects a committed claim that is false, with the evidence, and the claim is the one
gating this whole channel.

`cyrus/sales-signals`

`601-where-the-phone-number-wall-is.md` states, in bold, **"It is not a URL"**, that the file
comes only from a three-step ASP.NET postback, that the final POST is **403**, and that this
is "the single most load-bearing fact for whoever builds it". It concludes the file "has to
come from a machine the WAF admits" and that **"no reader for it can be tested here against
real data"** — which is the stated reason that entry shipped as an audit instead of a parser.

**Measured 2026-10-05 22:07Z from this container, one request:**

    curl 'https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C'
    HTTP 200   77,643,341 bytes   content-type: text/csv

No cookie jar, no referer, no `__VIEWSTATE`, no spoofed user agent, no retry — and had it
403'd, that would have been the end of it, because defeating a WAF is not an option and that
has not changed. Confirmed a second time from a fresh cookieless process: 200, `text/csv`,
and the real header row. The server sends no `accept-ranges`, so it streams the whole file.

**THE CAUSE IS NOT THAT THE WAF RELENTED, AND THAT IS THE WHOLE LESSON.** The same session
that wrote the committed entry also wrote, in its own working notes, that
*"the master-list CSV is a plain GET with no token, no cookie and no form state — the ASP.NET
postback 302s straight to it"*, naming this exact URL, marked **"Confidence: HIGH — I called
it and read bytes out of it."*

So both arms were measured and only the failing one was committed. The POST on
`lbMasterCSV` really did 403 — that measurement is not being disputed and was **not re-tested
here**, deliberately, because hammering their WAF to decorate a document is not a reason to
send requests. The defect is the generalisation: a 403 on one route was written up as a
property of the file. **The notes that said it was possible stayed on a scratchpad; the
sentence that said it was impossible went to `main`.** That is this repo's most expensive
recurring shape, and it is worse than usual here, because a claim that a capability is
MISSING is the direction that stops anyone looking — and it came with an instruction not to
bother.

**What the file actually contains**, measured in aggregate from the download and then deleted
— no row, name, licence number or telephone was printed, stored or committed, per the fixture
rule:

| | |
| --- | --- |
| rows | 243,786 |
| columns | 52, including `BusinessPhone` |
| rows carrying a phone | 243,543 — **99.9%** |
| `PrimaryStatus` = `CLEAR` | 231,014 (94.8%) |

**Two field-name traps that would each have cost an afternoon, and the first one bit me
inside ten minutes.** "In good standing" is spelled **`CLEAR`**, not `ACTIVE`; a filter on
`ACTIVE` matches **zero of 243,786 rows**. And the classification column is literally named
`Classifications(s)`, holding codes in **both spellings at once** — 287,736 bare (`C9`,
`C10`) and 23,054 hyphenated (`C-7`) — so a join normalising only one form silently drops
about 7.4% of all classifications. Both are the "wrong scope / about nothing" family
CLAUDE.md records: my first pass returned zero for every trade, and a zero spanning every
category with 243k rows loaded is the instrument failing, not a finding.

**The callable list, which is what this channel exists to produce** (`CLEAR` and holding a
phone, normalising both code spellings):

| code | trade | callable |
| --- | --- | --- |
| C9 | drywall | 3,157 |
| C35 | lathing & plastering | 1,799 |
| C2 | insulation & acoustical | 1,167 |
| C5 | framing & rough carpentry | 1,022 |
| | **specialty-trade total** | **7,145** |

`B` (general building) adds 102,230 and is deliberately excluded: a GC is not C Stream's
customer. 7,145 is the real size of the California cold-outbound list, from a free public
file, with telephone numbers, reachable from here.

**What this unblocks, and what it does NOT.** The stated reason a reader was not built — that
it could not be tested here against real data — is gone, so the next slice is the parser and
the `SalesLead.phone` fill, which that entry already established needs **no migration**. What
this is not: an ingest. Nothing was committed, nothing stored, no screen touched, and no
decision made about how often the file is refreshed or who owns the refresh. Building it at
this hour with nobody to click it is how the unverified work in this repo's scars got made —
it is the next slice, named, not a thing quietly half-done inside an audit.

One bound, stated because it is a real one: this is reachability measured twice at one moment
from one IP. A WAF decides per request, and the earlier 403 on the postback route was real.
If a future session gets a 403 on this GET, that is not this entry being wrong — it is the
same lesson arriving from the other side, and the right response is to record the date and
the status rather than to conclude the file is ungettable.
