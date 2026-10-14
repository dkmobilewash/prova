### Outreach links can open a lien waiver that is already started (Diego)
`claude/jolly-brahmagupta-bjy7e0`

`/lien-waiver/start?state=CA&type=cp&company=…&gc=…&ref=SD-PL-0001` now skips the state picker, pre-selects the waiver type, and puts each value in the matching blank of that state's form. The four statutes name their blanks differently -- Arizona's address is "located at" in the job description, Nevada has no owner blank, California no project name, and no state has a licence blank -- so the mapping is a small per-state table in `apps/lien-waiver/lib/prefill.ts`, and `prefill.test.ts` checks it against all sixteen forms by printing each one. A value nobody's form has a blank for is ignored.

Pre-fill only: nothing is sent on its own, the waiver-type screen and its warnings are always shown, the statutory text is untouched, and every value goes through the same checks as typing. Values are plain text (tags stripped, 120 characters, address 200); `email`, `phone` and every other unknown parameter are dropped and not even forwarded from `/start`. A link's values beat this browser's memory for the visit and reach memory only when the person sends.

`ref` never appears on screen or in the PDF. It rides along with the waiver to the server and goes on the lead: the note to diego@cstream.ai (subject and body) and the Resend contact's `ref` property. A returning browser that arrives through a link now sends the lead note too, since that is the attribution; without a ref it behaves as before. Opening a link with a ref logs `prefill_link_opened` with the code and state, nothing about the person.

**The check is a browser suite the tool did not have**: `apps/web/e2e/playwright.lien-waiver.config.ts` runs the tool's production build at 375 and 1280 in `ci.yml`'s `e2e-public` job, counted and verdict-checked like the public suite. Its no-parameter regression walk was committed and passed BEFORE pre-fill existed, then passed again after. Two mutations were run: a wrong map entry turns six unit tests red, and dropping the memory guard turns the example-link spec red.

One thing outside the code: Resend refuses a contact property it does not know, so the `ref` property has to be created in Resend once. Until then the contact is still saved, without it, and the log says so.
