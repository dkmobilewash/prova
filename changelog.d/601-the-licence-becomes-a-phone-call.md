### There is no CSLB deep link, measured in a real browser, so the card stopped pretending (Cyrus)
`cyrus/sales-signals`

The register card told somebody the licence number "is the key a CSLB lookup joins on"
and gave them no way to perform that lookup — so the last step between an imported
lead and a phone call was retyping a licence into a search engine. The previous agent
deliberately shipped no link, for the right reason: *"I could not verify the current
lookup URL from this container, and a wrong link is a false claim."*

**It is verified now, and the answer is that the deep link does not exist.** Driven in
real Chromium against the live site (the proxy CA was already in the NSS store; no
`ignoreHTTPSErrors`, no `--ignore-certificate-errors`):

| request | result |
| --- | --- |
| `LicenseDetail.aspx?LicNum=<n>` — cold GET, fresh context | **302 to the search page** |
| the same number, submitted **through the search form** | 200, lands on `LicenseDetail.aspx?LicNum=<n>` |

**One number, two paths.** What differs is CSLB's own session, not the licence — and
every visitor arriving from this app is the cold case. A `LicenseDetail` href would
promise a record and hand over an empty search box.

So the card links to CSLB's **search page**, renders the number beside it to paste, and
says in as many words that it opens a search rather than the licence itself. A `tel:`
link appears only when a number is actually on file.

**The control was run and returned something stronger than expected.** The prescribed
check — does an impossible licence return the same page as a real one — came back as:
on a cold GET *every* licence number returns the search page, with innerText
byte-identical to simply visiting it. So the finding is not "the fake matches the real"
but "the real matches nothing happening at all".

**And a second trap it exposed, which would have defeated a deep link even if one had
been reachable: the detail page ECHOES any number you hand it.** Reached through the
form, an arbitrary number returns 200 and renders `License # <whatever you asked for>`
with **no data panel** — no business name, no status, no phone. So "200, and it showed
my licence number" is not evidence the licence exists.

**What was NOT established, stated rather than glossed:** no *populated* detail page was
ever seen. CSLB sits behind an F5 WAF that 403s this container after a handful of
requests and blocks the business-name search outright, so no licence CSLB itself vouches
for could be obtained. **No sentence in the card claims the lookup will yield a phone
number**, which is why that bound does not undermine it. The conclusion rests only on
one number behaving two ways.

An instrument lie caught on the way: a first reading was "one number 403s and another
302s, so the response is content-dependent". It was not — the search page itself then
began 403ing, and one of three test arms was a WAF page about to be read as a control
result. Discarded and re-run after the block cleared. **The WAF also means CI cannot be
relied on to reach CSLB**, so none of this belongs in an automated check against the
live site; the URL is pinned by tests as a STRING with the measurement in the module
header, which is the right place for a fact about somebody else's website.

`telHref` strips to digits so `"(909) 555-0134 ext 2"` cannot dial the extension, while
the DISPLAYED text stays what was typed; it returns null for prose like
`"call the office"` so no link dials nothing. The lookup is offered even on a callable
lead, because the standing sentence says the licence is then what confirms the company.

**`SalesLead.phone` is written only by the hand-typed lead form** — `importSubListing`
sets the five register columns and never `phone`, because a §4104 listing has no
telephone column. So on an imported lead the `tel:` link is absent by construction,
which is exactly the state the CSLB link exists for.

37 tests. 10 mutations, 10 killed, no survivors. Two verified independently here:
**making the whole link block render nothing reds 6 DOM assertions**, so the suite reads
the rendered container rather than a mock; and **restoring the `LicenseDetail` deep link
reds 2 named tests**, including the one that names the 302. Every identifier in the
tests is a pre-existing repo fixture value — the two real licences used to probe the
live site appear nowhere in the committed files, checked by grep.
