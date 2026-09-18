### Proving sits below Compliance & safety, and Integrations has its own button (Cyrus)
`cyrus/nav-proving`

Two sidebar changes, both Cyrus's calls.

**Proving** — the RFIs-and-submittals count — now sits directly below
Compliance & safety instead of below Financials. It is anchored to the
`staying-legal` stage key rather than a heading's text, as before. A new
Sidebar test pins it between Compliance & safety and Paper trail; it went
red with the old anchor restored.

**Integrations** gets its own button at the bottom-left, above Settings
(`NAV_FOOTER`). The page existed but was reachable only from a link inside
Settings. The button shows to the account OWNER only, because the page
says "only the account owner can manage integrations" to everyone else,
and `activeFooterHref` takes the longest match so /settings/integrations
lights Integrations and not Settings too. The page gets a four-step
walkthrough; its non-owner refusal is a step of its own.

Clicked in the browser: Proving below Compliance & safety; Integrations
opens its page with only its own button highlighted; the tour runs all
four steps on screen.
