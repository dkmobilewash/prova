### Attach a file in the Ask box; "start a bid" asks first, then looks the project up on the web (Cyrus)
`cyrus/ask-upload-bid`

**A paperclip next to the mic.** You can attach a PDF, a photo (JPEG, PNG
or WebP), or a plain-text or CSV file, up to 10 MB, and ask about it: "what's
the bid date on this?", or "add these line items to the Tower TI estimate".
There is no second upload pipeline. The browser uploads through the intake
route that already exists (`/api/intake/upload`, the MANAGE_JOBS capability,
this company's `document-intake/<companyId>/` folder), and the question
carries only the blob URL. Before fetching a single byte, the server checks
three things: that the URL is our store, that it is this company's folder,
and that the type and size are allowed. It then measures the bytes that
actually arrive again. Another company's URL is never fetched, and the tests
assert that the fetch never happens, not just that an error comes back. Any
write the model proposes from the file still goes through the
confirm card. To keep the document on file, tap "File it in Document
intake", which calls the same `recordIntakeDocument` the drop zone uses.
The file goes with one question only. Its name shows on the scrollback row,
and Clear all removes it.

**"Start a bid" is still `create_estimate_job`.** Its description now says
so, and it tells the model to call the command even with nothing filled in.
If the name or the GC is missing, `resolve` asks one question that lists
every essential still missing: name, GC, location, bid due date, and our
scope. It never makes a blank job. With a name and a location, the command
makes a *separate* model call. That call sees only those two strings, with
`web_search_20250305` capped at 3 searches, and nothing else about the
company is in the request. A fact survives only if it cites a URL that
really came back from the search in that same call, so a remembered or
mis-copied source takes its fact down with it. What survives goes on the
card under "Found on the web — check before you rely on it", with its
links, and each item can be unticked. The browser can only send back the
keys to drop, so it can remove a suggestion but never add or change one.
Only what is still ticked is saved, and only on Confirm, in the new
`Job.bidResearch`. The job page shows it in a small "Bid details" block.
If web search is unavailable, the card says so and the bid is still created
from what the person gave.

**Migration `20260918150000_add_job_bid_details`**, additive: three nullable
columns on `Job` (`projectLocation`, `bidDueDate`, `bidResearch`). It has no
new table and no FK, so the cleanup-order guards are unaffected, and it was
announced in #prova-build before the push. The demo database needs the
**Migrate demo database** workflow after merge, or preview job pages will
fail with "column does not exist".

Checks: 18 mutations of the guards (company folder, our store, size cap,
type allowlist, re-measured bytes, MANAGE_JOBS on ask and on upload, file
reaching the request, sourced-facts-only, all essentials asked, due date
checked before a paid search, only name+location searched, degrade instead
of refuse, untick honoured on confirm, search cap clamp, transcript bound,
http(s)-only links). 18 were requested and 18 came back, all red. Live, 2/2
routing cases passed. A fictional project got 3 searches and 0 suggestions,
so nothing was invented. A real one came back fully sourced, and a PDF
question was answered from the file. One web lookup cost about 48k input
tokens plus 3 searches, and is recorded as its own `AskUsage` feature,
`bid-research`.
