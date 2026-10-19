### The third free tool: a T&M ticket the GC super signs on the foreman's phone (Cyrus)
`cyrus/tm-ticket`

Diego's plan (2026-10-17, section 3) puts the T&M / extra-work ticket third. It lives at
`/lien-waiver/tm-ticket`, in the same frame as the waiver and the change order request: no account,
one screen per question, a number keypad for hours and quantities, the crew as chips. The super reads
it, signs on a canvas with a finger, and types name, title and email under the signature. One email
carries the PDF to the foreman and the super together.

Reuse, not a second copy. The change order PDF's page writer became `Flow` in `lib/pdf.ts`, and both
documents use it. The change order PDF tests pass unchanged across that move. `deliverPdf` learned a
`cc`. Each address it reaches is held to the per-address daily cap, so a super's address cannot be
mailed past it by different foremen. The super is never a lead and never added to the audience. The
email's last line is written to be true for both readers.

The ticket never prices the work. It has no money field. `content.test.ts` reads the PDF and the email
back and fails on a `$`, a price/cost/rate/amount word, "paid", "payment" or "approved", on top of the
payment-promise guard the change order request already had. Mutation-checked: a `$85/hr` in the PDF,
"Approved on site" in the email, "Signing means this work will be paid" in the PDF and "guarantees you
get paid" on screen each fail it.

The ticket number is `TM-` plus the issuing second in base 32 plus 3 random characters, issued by the
browser, because the tool has no database. Within one browser it never repeats: each number's second is
forced past the last one issued there, even with the clock moved back. Across devices it is the random
part (1 in 32,768 within the same second). The code says so, and does not claim global uniqueness.

"Turn these tickets into a change order" puts only a flag in the URL. The sent tickets' hours and
quantities, kept in this browser, are added to the change order request as lines with an empty price,
which that tool refuses until the sub types a rate. The browser walk caught two real bugs here. First,
React's dev mode runs the hand-off twice and the second run lost the lines, so the merged draft is now
saved before the tickets are cleared. Second, a browser that had never made a change order started with
no company.

Not built: a photo. The app has no file storage, and a phone photo is near the function's request
limit, so the work screen says to send photos with the PDF.

### A sent change order request is finished, not a draft to come back to (Cyrus)
`cyrus/tm-ticket`

Found by clicking, before it shipped: after a send, coming back to the tool started with the whole
last request filled in (job, GC, every line, markup, days, backup) and yesterday's date, and
typing appended to the old values, so re-sending old numbers was one tap away. A sent request is
now finished, not a draft. `freshDraft` in `lib/change-order.ts` keeps only the sub's company and
today's date, the way the waiver keeps only who you are (`saveContact`: name, email, company).
The send, "Make another change order request" and "Forget them" all go through it. An unfinished
draft is still restored after a reload, but `startDraft` moves a date that is in the past up to
today. A request is dated the day it goes out, and a date picked for later is kept. "Today" is the
user's calendar (`localToday` in `lib/fills.ts`), set in an effect and never server-rendered.
