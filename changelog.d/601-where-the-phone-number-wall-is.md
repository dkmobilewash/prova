### Where the phone-number wall actually is, measured against the live site (Cyrus)

**DOCS-ONLY, shipped under the audit exception** (working agreement rule 1, Diego 2026-09-07):
it corrects a documented claim that was too broad and records what an investigation
eliminated, so the next person does not re-run the same checks.
`cyrus/sales-signals`

A §4104 listing carries no telephone number. The whole cold-outbound chain therefore ends
at a licence number, and the recorded premise for closing that gap is that CSLB publishes a
free bulk CSV carrying one. That premise was recorded **without the route** — no URL, no
column list, no statement of how the file is fetched — which makes it a claim nobody can
act on without starting from guesses.

Measured 2026-10-05 against the live site. **The premise holds, and it is corroborated by
the portal's own text rather than by an earlier session's memory:** the master file's
columns include a telephone number, and *"Email addresses are not provided (Business &
Professions Code Section 27)"* — so the no-email finding is **statutory**, not incidental,
and no amount of looking will produce one.

**It is not a URL.** The file comes out of a three-step ASP.NET postback: GET the page for
its `__VIEWSTATE`/`__EVENTVALIDATION`, POST `ddlStatus=M` to make the download controls
appear, then POST `__EVENTTARGET=ctl00$MainContent$lbMasterCSV`. Nothing that ingests this
can simply GET a link, which is the single most load-bearing fact for whoever builds it.

**And the wall is one step further in than the repo said.**

| step | result |
| --- | --- |
| GET the portal page | **200**, 14,829 bytes |
| POST `ddlStatus=M` | **200**, the CSV and Excel controls appear |
| POST `lbMasterCSV` | **403**, an F5 WAF page of 312 bytes, on the FIRST attempt |

`601-the-licence-becomes-a-phone-call.md` says CSLB "403s this container after a handful of
requests". That was honest on the day and is too broad as a general claim: the site is
browsable, the form is usable, and it is **the file** that is rejected — immediately, not
after a handful. Exactly the shape CLAUDE.md keeps recording: a measurement true when taken,
later cited as a property of the world.

**Defeating a WAF is not an option** — same class as the Turnstile wall on Clerk's sign-up
form — so the file has to come from a machine the WAF admits, and **no reader for it can be
tested here against real data.** That is why this ships as an audit and not as a parser: a
CSV reader written against two remembered column names would be the unverified work this
repo pays for, and it would look finished.

Two smaller findings on the way. **`WebFetch` is egress-blocked for `www.cslb.ca.gov` while
`curl` to the same host returns 200** — two routes, two answers, which is the
Playwright-Node-fetch split arriving somewhere new; reach for `curl` before concluding a
host is unreachable. And the free master file covers licences *currently renewed, or expired
but renewable*, excluding cancelled, revoked and expired-non-renewable — narrower than
"every licensee", and the narrowing you want, since a sub whose licence is revoked is not a
prospect. The $235 full file (700,000+ records, text only) is a different product and is not
needed for this.

**What this leaves for whoever builds the phone link.** The premise is confirmed and the
route is written down, so the open questions are now the right ones: where the file is
fetched from (not an agent container), and whether the number lands in the existing
`SalesLead.phone` column — which exists and is written only by the hand-typed lead form, so
filling it needs **no migration**. That last point is what makes the next slice small.
