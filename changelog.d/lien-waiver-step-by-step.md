### The lien waiver tool asks one section at a time and only ever emails the PDF (Diego)
`claude/jolly-brahmagupta-bjy7e0`

Diego asked for a step-by-step screen like the reference he sent, on phone and desktop: pick the waiver type, then the company, project, payment and last details one screen each, then read the whole form, with Back and Next in a bar pinned to the bottom. Next checks only the screen it is on, Back never blocks, and the review screen has buttons that jump straight back to any section.

**There is no download any more, and that is enforced on the server, not just hidden in the UI.** `/api/waiver` returns JSON, never the PDF bytes, because a response carrying the PDF is a download for anyone who opens the network tab. The PDF goes to the address given and nowhere else, so every waiver leaves a name and an email behind. This replaces the 2026-10-08 rule where a browser that had given an email once downloaded freely afterwards. A returning browser now gets its name and email filled in and still sends, but sends Diego no second lead note.

Two consequences, each covered by a test. If the email does not go out (a provider failure) the person is asked to try again, since there is no other way to get the PDF; the old "hand it over anyway" path is gone, so issue #747's "no lead lost silently" now holds by construction. And the per-address cap rose from 5 to 20 a day, because every waiver is now an email and a sub on a heavy pay-app day would otherwise lock themselves out.

The check: `steps.test.ts` proves every fillable blank on all sixteen forms lands on exactly one screen, and that a blank added to the catalog later cannot silently go unasked. `waiver-request.test.ts` asserts the response never contains a PDF. Statutory text, `STATE_CONTENT` and so the recorded attorney digests are untouched. The privacy page's wording changed from "download" to "ask for", which is worth showing the attorneys next time the packet goes out.
